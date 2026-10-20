export const LIMITS = Object.freeze({
  fileBytes: 2 * 1024 * 1024,
  files: 200,
  batchBytes: 64 * 1024 * 1024,
  headerBytes: 64 * 1024,
  headers: 200,
  headerLineChars: 8192,
  bodyChars: 200000,
  mimeDepth: 20,
  mimeParts: 200,
  recipients: 100,
  subjectChars: 512,
  addressChars: 320
});

const fail = (message) => { throw new Error(message); };

function decodeBytes(bytes, charset = "utf-8") {
  try {
    return new TextDecoder(charset, { fatal: false }).decode(bytes);
  } catch {
    fail("Unsupported or invalid character encoding.");
  }
}

function decodeQuotedPrintable(input) {
  const normalized = input.replace(/=\r?\n/g, "");
  const bytes = [];
  for (let i = 0; i < normalized.length; i++) {
    if (normalized[i] === "=" && /^[0-9a-f]{2}$/i.test(normalized.slice(i + 1, i + 3))) {
      bytes.push(parseInt(normalized.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      const code = normalized.charCodeAt(i);
      if (code <= 255) bytes.push(code);
      else bytes.push(...new TextEncoder().encode(normalized[i]));
    }
  }
  return new Uint8Array(bytes);
}

function decodeTransfer(body, encoding, charset) {
  const method = (encoding || "").trim().toLowerCase();
  if (method === "base64") {
    const compact = body.replace(/[\t\n\r ]/g, "");
    if (!/^[a-z0-9+/]*={0,2}$/i.test(compact) || compact.length % 4 === 1) {
      fail("Malformed base64 content.");
    }
    try {
      const binary = atob(compact);
      const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
      return decodeBytes(bytes, charset);
    } catch {
      fail("Malformed base64 content.");
    }
  }
  if (method === "quoted-printable") return decodeBytes(decodeQuotedPrintable(body), charset);
  if (method && method !== "7bit" && method !== "8bit" && method !== "binary") {
    fail("Unsupported content-transfer-encoding.");
  }
  return decodeBytes(new TextEncoder().encode(body), charset);
}

function splitHeaderBlock(source) {
  const separator = source.search(/\r?\n\r?\n/);
  if (separator < 0) fail("Missing header/body separator.");
  const headerText = source.slice(0, separator);
  const bodyStart = separator + (source.startsWith("\r\n\r\n", separator) ? 4 : 2);
  if (headerText.length > LIMITS.headerBytes) fail("Headers exceed 64 KiB.");
  const physical = headerText.split(/\r?\n/);
  if (physical.length > LIMITS.headers) fail("Too many headers.");
  const lines = [];
  for (const line of physical) {
    if (/^[ \t]/.test(line)) {
      if (!lines.length) fail("Header continuation without a preceding header.");
      lines[lines.length - 1] += " " + line.trim();
    } else {
      lines.push(line);
    }
    if (lines[lines.length - 1].length > LIMITS.headerLineChars) fail("A header exceeds 8 KiB.");
  }
  const headers = new Map();
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon <= 0) fail("Malformed email header.");
    const name = line.slice(0, colon).trim().toLowerCase();
    if (!/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(name)) fail("Invalid email header name.");
    const value = line.slice(colon + 1).trim();
    if (!headers.has(name)) headers.set(name, []);
    headers.get(name).push(value);
  }
  return { headers, body: source.slice(bodyStart) };
}

function header(headers, name) {
  return headers.get(name)?.[0] || "";
}

function parameter(value, key) {
  const escaped = key.replace(/[.*+?^{}()|[\]\\]/g, "\\$&");
  const match = value.match(new RegExp("(?:^|;)\\s*" + escaped + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^;\\s]*))", "i"));
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
}

function contentType(headers) {
  const raw = header(headers, "content-type") || "text/plain; charset=utf-8";
  return { raw, type: (raw.split(";")[0] || "text/plain").trim().toLowerCase(),
    charset: parameter(raw, "charset") || "utf-8", boundary: parameter(raw, "boundary") };
}

function splitMultipart(body, boundary) {
  if (!boundary || boundary.length > 200) fail("Invalid MIME multipart boundary.");
  const marker = "--" + boundary;
  const chunks = body.split(marker);
  if (chunks.length < 3) fail("Malformed MIME multipart body.");
  const result = [];
  for (let chunk of chunks.slice(1)) {
    if (/^--/.test(chunk)) break;
    chunk = chunk.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
    if (chunk) result.push(chunk);
  }
  return result;
}

function htmlToText(html) {
  return html
    .replace(/<\s*(script|style|head|noscript|svg|iframe)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/(p|div|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Math.min(0x10ffff, Number(n))))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Math.min(0x10ffff, parseInt(n, 16))))
    .replace(/[\t ]+\n/g, "\n").replace(/\n[\t ]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
}

function collectText(source, depth, state) {
  if (depth > LIMITS.mimeDepth) fail("MIME nesting exceeds the depth limit.");
  state.parts += 1;
  if (state.parts > LIMITS.mimeParts) fail("MIME part count exceeds the limit.");
  const { headers, body } = splitHeaderBlock(source);
  const ct = contentType(headers);
  if (ct.type.startsWith("multipart/")) {
    const parts = splitMultipart(body, ct.boundary);
    const candidates = [];
    for (const part of parts) {
      const found = collectText(part, depth + 1, state);
      if (found) candidates.push(found);
    }
    return candidates.find(item => item.kind === "text/plain") ||
      candidates.find(item => item.kind === "text/html") || null;
  }
  if (ct.type === "message/rfc822") return null;
  if (ct.type !== "text/plain" && ct.type !== "text/html") return null;
  if (header(headers, "content-disposition").toLowerCase().startsWith("attachment")) return null;
  const text = decodeTransfer(body, header(headers, "content-transfer-encoding"), ct.charset);
  return { kind: ct.type, text: ct.type === "text/html" ? htmlToText(text) : text };
}

function cleanHeader(value, maxLength) {
  return String(value || "").replace(/[\r\n\0]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function parseAddressList(value) {
  if (!value.trim()) return [];
  const pieces = value.match(/(?:"[^"]*"|[^,])+/g) || [];
  return pieces.map(item => cleanHeader(item.replace(/^\s+|\s+$/g, ""), LIMITS.addressChars)).filter(Boolean);
}

function classify(subject, body) {
  const text = (subject + "\n" + body).toLowerCase();
  const actionPatterns = [
    /\bplease\s+(?:send|submit|complete|review|confirm|approve|reply|respond|sign|provide|share|upload|pay|schedule|attend|finish|return|contact|call|update)\b/,
    /\b(?:action required|your action|response required|please respond|please reply|awaiting your response|follow[- ]up required)\b/,
    /\b(?:submit|complete|sign|send|provide|review|confirm|approve|reply|respond|upload|pay)\b.{0,80}\b(?:by|before|deadline|today|tomorrow|friday|monday|tuesday|wednesday|thursday|saturday|sunday)\b/,
    /\b(?:could you|can you|would you|please let me know|let me know if you can)\b/
  ];
  const urgencyPatterns = [
    /\b(?:urgent|urgently|asap|immediately|time[- ]sensitive|critical priority|high priority|emergency)\b/,
    /\b(?:deadline is today|due today|expires today|final reminder|last chance|overdue)\b/
  ];
  const action = actionPatterns.some(pattern => pattern.test(text));
  const urgent = urgencyPatterns.some(pattern => pattern.test(text));
  return { action, urgent };
}

export function parseEml(input, filename = "email.eml") {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength > LIMITS.fileBytes) fail("File exceeds the 2 MiB limit.");
  if (!bytes.byteLength) fail("File is empty.");
  let source = decodeBytes(bytes, "utf-8");
  source = source.replace(/^\uFEFF/, "");
  const root = splitHeaderBlock(source);
  const subject = cleanHeader(header(root.headers, "subject"), LIMITS.subjectChars) || "(No subject)";
  const from = cleanHeader(header(root.headers, "from"), LIMITS.addressChars) || "(Unknown sender)";
  const to = [...parseAddressList(header(root.headers, "to")), ...parseAddressList(header(root.headers, "cc"))].slice(0, LIMITS.recipients);
  const rawDate = header(root.headers, "date");
  const timestamp = rawDate ? Date.parse(rawDate) : NaN;
  const date = Number.isFinite(timestamp) && timestamp >= Date.UTC(1970,0,1) && timestamp <= Date.UTC(2100,11,31,23,59,59,999)
    ? new Date(timestamp).toISOString() : null;
  const content = collectText(source, 0, { parts: 0 });
  const body = cleanHeader("", 0) + (content?.text || "");
  const boundedBody = body.slice(0, LIMITS.bodyChars);
  const cues = classify(subject, boundedBody);
  return Object.freeze({
    id: filename + ":" + subject + ":" + (date || ""),
    filename: cleanHeader(filename, 255),
    subject,
    from,
    to: Object.freeze(to),
    date,
    body: boundedBody,
    action: cues.action,
    urgent: cues.urgent,
    warnings: Object.freeze([
      !rawDate ? "Date header missing." : !date ? "Date header is invalid or outside the supported range." : null,
      content?.text && content.text.length > LIMITS.bodyChars ? "Message body was truncated to 200,000 characters." : null,
      !content?.text ? "No supported plain-text or HTML body was found." : null
    ].filter(Boolean))
  });
}

export function parseFileBytes(bytes, filename) {
  if (!/\.eml$/i.test(filename) || /[\\/]/.test(filename) || filename === "." || filename === "..") {
    fail("Only direct .eml filenames are accepted.");
  }
  return parseEml(bytes, filename);
}
