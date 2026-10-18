import { getData, replaceData } from "./state.js";
import { validateData, saveRecoveryCopy, getRecoveryCopies } from "./storage.js";
import { confirmAction } from "./dialogs.js";

// localStorage keys owned by storage.js and sync.js
const DATA_KEY = "personalflow-data";
const SYNC_KEY = "personalflow-sync";

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const CSV_COLUMNS = [
  "id", "title", "description", "priority", "category",
  "dueDate", "dueTime", "completed", "progress", "subtasks",
  "createdAt", "updatedAt",
];
const BUG_CSV_COLUMNS = [
  "id", "title", "project", "severity", "status", "progress",
  "description", "steps", "checklist", "links", "createdAt", "resolvedAt",
];
const STATUS_LABEL = { todo: "To do", progress: "In progress", testing: "Testing", solved: "Solved" };

const $ = (id) => document.getElementById(id);

const bugsOf = (data) => (Array.isArray(data.bugs) ? data.bugs : []);
const hasContent = (data) => data.tasks.length > 0 || bugsOf(data).length > 0;

function say(text, isError = false) {
  const el = $("dataMessage");
  el.textContent = text;
  el.classList.toggle("is-error", isError);
}

function dateStamp() {
  return new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in local time
}

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- Export ---------- */

function backupPayload() {
  const d = getData();
  return {
    version: d.version,
    updatedAt: d.updatedAt,
    tasks: d.tasks,
    bugs: bugsOf(d),
    settings: { theme: localStorage.getItem("personalflow-theme") || "system" },
  };
}

function exportJson() {
  const payload = backupPayload();
  download(`personalflow-backup-${dateStamp()}.json`, JSON.stringify(payload, null, 2), "application/json");
  const bugs = payload.bugs.length;
  say(`Exported ${payload.tasks.length} tasks${bugs ? ` and ${bugs} bugs` : ""} to JSON.`);
}

function csvCell(value) {
  let text = String(value ?? "");
  // Stop spreadsheet apps from running text as a formula
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

// Plain task fields, plus two computed columns for subtasks
function csvValue(task, column) {
  const subs = Array.isArray(task.subtasks) ? task.subtasks : [];

  if (column === "progress") {
    if (!subs.length) return "";
    const done = subs.filter((s) => s.done).length;
    return `${Math.round((done / subs.length) * 100)}%`;
  }
  if (column === "subtasks") {
    return subs.map((s) => `${s.done ? "[x]" : "[ ]"} ${s.title}`).join("\n");
  }
  return task[column];
}

function bugCsvValue(bug, column) {
  const list = Array.isArray(bug.checklist) ? bug.checklist : [];

  if (column === "status") return STATUS_LABEL[bug.status] || bug.status;
  if (column === "progress") {
    if (bug.status === "solved") return "100%";
    if (list.length) return `${Math.round((list.filter((i) => i.done).length / list.length) * 100)}%`;
    return `${{ todo: 0, progress: 40, testing: 80 }[bug.status] || 0}%`;
  }
  if (column === "checklist") return list.map((i) => `${i.done ? "[x]" : "[ ]"} ${i.title}`).join("\n");
  if (column === "links") return (Array.isArray(bug.links) ? bug.links : []).join("\n");
  return bug[column];
}

function exportCsv() {
  const tasks = getData().tasks;
  const rows = [
    CSV_COLUMNS.join(","),
    ...tasks.map((t) => CSV_COLUMNS.map((col) => csvCell(csvValue(t, col))).join(",")),
  ];
  // BOM so Excel reads UTF-8 correctly
  download(`personalflow-tasks-${dateStamp()}.csv`, `\uFEFF${rows.join("\r\n")}`, "text/csv;charset=utf-8");
  say(`Exported ${tasks.length} tasks to CSV.`);
}

function exportBugsCsv() {
  const bugs = bugsOf(getData());
  if (!bugs.length) {
    say("There are no bugs to export yet.");
    return;
  }
  const rows = [
    BUG_CSV_COLUMNS.join(","),
    ...bugs.map((b) => BUG_CSV_COLUMNS.map((col) => csvCell(bugCsvValue(b, col))).join(",")),
  ];
  download(`personalflow-bugs-${dateStamp()}.csv`, `\uFEFF${rows.join("\r\n")}`, "text/csv;charset=utf-8");
  say(`Exported ${bugs.length} bugs to CSV.`);
}

function exportRecovery() {
  const latest = getRecoveryCopies()[0];
  if (!latest) {
    say("No recovery copies saved yet.");
    return;
  }
  download(`personalflow-recovery-${dateStamp()}.json`, JSON.stringify(latest.data, null, 2), "application/json");
  say(`Downloaded recovery copy: ${latest.label} (${new Date(latest.savedAt).toLocaleString()}). Restore it with Import JSON.`);
}

/* ---------- Import ---------- */

async function importJson(file) {
  if (file.size > MAX_IMPORT_BYTES) {
    say("Invalid backup file (too large). Nothing was changed.", true);
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch (err) {
    console.error("Import: not valid JSON", err);
    say("Invalid backup file. Nothing was changed.", true);
    return;
  }

  const data = validateData(parsed);
  if (!data) {
    say("Invalid backup file. Nothing was changed.", true);
    return;
  }

  const current = getData();
  const fileBugs = bugsOf(data).length;
  const ok = await confirmAction({
    title: "Import backup?",
    text:
      `This file has ${data.tasks.length} tasks${fileBugs ? ` and ${fileBugs} bugs` : ""}. ` +
      `Importing replaces the ${current.tasks.length} tasks${bugsOf(current).length ? ` and ${bugsOf(current).length} bugs` : ""} on this device. ` +
      "Your current data is saved as a recovery copy first. If Google Drive sync is on, the imported data will sync to Drive.",
    confirmLabel: "Import",
  });
  if (!ok) {
    say("Import cancelled. Nothing was changed.");
    return;
  }

  if (hasContent(current)) saveRecoveryCopy("This device, before importing a backup", current);
  replaceData({ ...data, updatedAt: new Date().toISOString() });
  say(`Imported ${data.tasks.length} tasks${fileBugs ? ` and ${fileBugs} bugs` : ""}.`);
}

/* ---------- Clear local data ---------- */

async function clearLocalData() {
  const ok = await confirmAction({
    title: "Clear local data?",
    text:
      "This removes all tasks and bugs from this device and disconnects Google Drive here. " +
      "Your Google Drive file is NOT deleted, and you can reconnect later to load it back. " +
      "A recovery copy is saved first.",
    confirmLabel: "Clear local data",
    danger: true,
  });
  if (!ok) return;

  const current = getData();
  if (hasContent(current)) saveRecoveryCopy("This device, before clearing local data", current);

  // Removing the sync link too means an empty list can never be uploaded over the cloud file
  localStorage.removeItem(DATA_KEY);
  localStorage.removeItem(SYNC_KEY);
  location.reload();
}

/* ---------- Init ---------- */

export function initBackup() {
  // A separate export for the bug tracker, next to "Export CSV"
  $("exportCsvBtn").insertAdjacentHTML(
    "afterend",
    '<button class="btn btn-ghost" id="exportBugsBtn" type="button">Export bugs CSV</button>'
  );

  $("exportJsonBtn").addEventListener("click", exportJson);
  $("exportCsvBtn").addEventListener("click", exportCsv);
  $("exportBugsBtn").addEventListener("click", exportBugsCsv);
  $("exportRecoveryBtn").addEventListener("click", exportRecovery);
  $("clearDataBtn").addEventListener("click", clearLocalData);

  $("importJsonBtn").addEventListener("click", () => $("importFile").click());
  $("importFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = ""; // allow picking the same file again
    if (file) await importJson(file);
  });
}