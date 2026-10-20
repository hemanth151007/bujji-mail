import { LIMITS, parseFileBytes } from "./eml.js";

const $ = (selector) => document.querySelector(selector);
const fileInput = $("#file-input");
const dropZone = $("#drop-zone");
const status = $("#import-status");
const clearButton = $("#clear-button");
const resultsSection = $("#results-section");
const messageList = $("#message-list");
const filterSelect = $("#filter-select");
const searchInput = $("#search-input");
const rejectedSection = $("#rejected-section");
const rejectedList = $("#rejected-list");
let messages = [];
let rejected = [];

function safeText(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = value;
  return element;
}

function prettyDate(value) {
  if (!value) return "Date unavailable";
  try { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
  catch { return value; }
}

function renderMessage(message) {
  const details = document.createElement("details");
  details.className = "message-card";
  const summary = document.createElement("summary");
  summary.className = "message-summary";
  const topline = document.createElement("div");
  topline.className = "message-topline";
  if (message.action) topline.append(safeText("span", "badge badge-action", "ACTION CUE"));
  if (message.urgent) topline.append(safeText("span", "badge badge-urgent", "URGENCY CUE"));
  if (!message.action && !message.urgent) topline.append(safeText("span", "badge", "NO CUE DETECTED"));
  const title = safeText("div", "message-title", message.subject);
  const sender = safeText("div", "message-meta", message.from + " · " + prettyDate(message.date));
  const preview = safeText("p", "message-preview", message.body.slice(0, 190).replace(/\s+/g, " ") || "No readable body text found.");
  summary.append(topline, title, sender, preview);
  const content = document.createElement("div");
  content.className = "message-body";
  const dl = document.createElement("dl");
  dl.className = "detail-grid";
  for (const [label, value] of [["File", message.filename], ["From", message.from], ["To / Cc", message.to.join(", ") || "Not provided"], ["Date", prettyDate(message.date)]]) {
    dl.append(safeText("dt", "", label), safeText("dd", "", value));
  }
  content.append(dl);
  if (message.warnings.length) {
    const warnings = safeText("p", "message-meta", "Notes: " + message.warnings.join(" "));
    content.append(warnings);
  }
  content.append(safeText("pre", "body-text", message.body || "No supported text body was found."));
  details.append(summary, content);
  return details;
}

function render() {
  const filter = filterSelect.value;
  const query = searchInput.value.trim().toLowerCase();
  const filtered = messages.filter(message => {
    if (filter === "action" && !message.action) return false;
    if (filter === "urgent" && !message.urgent) return false;
    return !query || [message.subject, message.from, message.body, message.filename].some(value => value.toLowerCase().includes(query));
  });
  $("#stat-loaded").textContent = String(messages.length);
  $("#stat-actions").textContent = String(messages.filter(message => message.action).length);
  $("#stat-urgent").textContent = String(messages.filter(message => message.urgent).length);
  $("#result-count").textContent = messages.length + (messages.length === 1 ? " message" : " messages");
  messageList.replaceChildren();
  if (!filtered.length) messageList.append(safeText("p", "status-line", "No messages match this filter."));
  else filtered.forEach(message => messageList.append(renderMessage(message)));
  rejectedList.replaceChildren();
  rejected.forEach(item => rejectedList.append(safeText("li", "", item)));
  rejectedSection.hidden = rejected.length === 0;
  resultsSection.hidden = messages.length === 0 && rejected.length === 0;
  clearButton.disabled = messages.length === 0 && rejected.length === 0;
}

async function loadFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  if (files.length > LIMITS.files) {
    status.textContent = "Choose no more than 200 files per import. No files from this batch were processed.";
    return;
  }
  const batchBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (batchBytes > LIMITS.batchBytes) {
    status.textContent = "This batch exceeds 64 MiB. No files from this batch were processed.";
    return;
  }
  let loaded = 0;
  let added = 0;
  for (const file of files) {
    if (file.size > LIMITS.fileBytes) {
      rejected.push(file.name + ": exceeds the 2 MiB per-file limit.");
      continue;
    }
    if (!/\.eml$/i.test(file.name) || /[\\/]/.test(file.name)) {
      rejected.push(file.name + ": only .eml files are supported.");
      continue;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.byteLength !== file.size) throw new Error("File size changed while reading.");
      const parsed = parseFileBytes(bytes, file.name);
      messages.push(parsed);
      added += 1;
      loaded += bytes.byteLength;
    } catch (error) {
      rejected.push(file.name + ": " + (error instanceof Error ? error.message : "Could not parse this file."));
    }
  }
  status.textContent = "Import finished: " + added + " email(s) loaded; " + rejected.length + " file(s) rejected or skipped. Data remains in this tab only.";
  render();
}

fileInput.addEventListener("change", async () => {
  await loadFiles(fileInput.files);
  fileInput.value = "";
});
for (const eventName of ["dragenter", "dragover"]) {
  dropZone.addEventListener(eventName, event => {
    event.preventDefault();
    dropZone.classList.add("dragging");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  dropZone.addEventListener(eventName, event => {
    event.preventDefault();
    dropZone.classList.remove("dragging");
  });
}
dropZone.addEventListener("drop", event => loadFiles(event.dataTransfer?.files));
clearButton.addEventListener("click", () => {
  messages = [];
  rejected = [];
  filterSelect.value = "all";
  searchInput.value = "";
  status.textContent = "Session cleared. Imported emails have been removed from the app's in-memory state.";
  render();
});
filterSelect.addEventListener("change", render);
searchInput.addEventListener("input", render);

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {
      status.textContent = "Offline install support is unavailable in this browser; local email processing still works.";
    });
  });
}
