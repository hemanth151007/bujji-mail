import test from "node:test";
import assert from "node:assert/strict";
import { parseEml, parseFileBytes, LIMITS } from "../eml.js";

const make = (text) => new TextEncoder().encode(text);
const basic = (body = "Hello there.") =>
  "From: Taylor <taylor@example.com>\r\nTo: b@example.com\r\nCc: c@example.com\r\nSubject: Weekly update\r\nDate: Tue, 20 Oct 2026 10:00:00 +0000\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n" + body;

test("parses basic headers and plain text without losing the message body", () => {
  const result = parseEml(make(basic()), "weekly.eml");
  assert.equal(result.subject, "Weekly update");
  assert.equal(result.from, "Taylor <taylor@example.com>");
  assert.deepEqual(result.to, ["b@example.com", "c@example.com"]);
  assert.equal(result.body, "Hello there.");
  assert.equal(result.date, "2026-10-20T10:00:00.000Z");
});

test("detects action language even when the sentence begins with a negation", () => {
  const result = parseEml(make(basic("No action is required, but please submit the new form by Friday.")), "mixed.eml");
  assert.equal(result.action, true);
});

test("detects urgency phrases without asserting an email is malicious", () => {
  const result = parseEml(make(basic("This is urgent. Please review today.")), "urgent.eml");
  assert.equal(result.urgent, true);
  assert.equal(result.action, true);
});

test("unfolds headers and selects first subject header", () => {
  const result = parseEml(make("Subject: First\r\nSubject: Second\r\nX-Note: first\r\n second line\r\n\r\nBody"), "headers.eml");
  assert.equal(result.subject, "First");
});

test("extracts a text/plain MIME part and ignores attachment text", () => {
  const mail = "From: a@example.com\r\nSubject: Multipart\r\nContent-Type: multipart/mixed; boundary=\"part-1\"\r\n\r\n--part-1\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nSafe body\r\n--part-1\r\nContent-Type: text/plain\r\nContent-Disposition: attachment; filename=\"note.txt\"\r\n\r\nsecret attachment\r\n--part-1--\r\n";
  const result = parseEml(make(mail), "multi.eml");
  assert.match(result.body, /Safe body/);
  assert.doesNotMatch(result.body, /secret attachment/);
});

test("converts basic HTML content to text and removes script contents", () => {
  const mail = "Subject: HTML\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Hello <b>world</b></p><script>doBadThing()</script>";
  const result = parseEml(make(mail), "html.eml");
  assert.match(result.body, /Hello/);
  assert.doesNotMatch(result.body, /doBadThing/);
});

test("rejects oversized input and invalid file names", () => {
  assert.throws(() => parseEml(new Uint8Array(LIMITS.fileBytes + 1), "big.eml"), /2 MiB/);
  assert.throws(() => parseFileBytes(make(basic()), "../secret.eml"), /direct .eml/);
  assert.throws(() => parseFileBytes(make(basic()), "mail.txt"), /direct .eml/);
});

test("rejects malformed header block and malformed multipart", () => {
  assert.throws(() => parseEml(make("not a header"), "bad.eml"), /separator/);
  assert.throws(() => parseEml(make("Subject: x\r\nContent-Type: multipart/mixed; boundary=\"missing\"\r\n\r\nno delimiter"), "badmulti.eml"), /multipart/);
});

test("bounds dates and gives warning for invalid or missing dates", () => {
  const result = parseEml(make("Date: Fri, 01 Jan 1800 00:00:00 +0000\r\nSubject: Date\r\n\r\nBody"), "date.eml");
  assert.equal(result.date, null);
  assert.ok(result.warnings.some(item => item.includes("outside the supported range")));
});

test("does not mark neutral mail as action or urgent", () => {
  const result = parseEml(make(basic("Here is the monthly newsletter. Enjoy your weekend.")), "neutral.eml");
  assert.equal(result.action, false);
  assert.equal(result.urgent, false);
});
