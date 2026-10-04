import { getData, replaceData } from "./state.js";
import { validateData, saveRecoveryCopy, getRecoveryCopies } from "./storage.js";
import { confirmAction } from "./dialogs.js";

// localStorage keys owned by storage.js and sync.js
const DATA_KEY = "personalflow-data";
const SYNC_KEY = "personalflow-sync";

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const CSV_COLUMNS = [
  "id", "title", "description", "priority", "category",
  "dueDate", "dueTime", "completed", "createdAt", "updatedAt",
];

const $ = (id) => document.getElementById(id);

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
    settings: { theme: localStorage.getItem("personalflow-theme") || "system" },
  };
}

function exportJson() {
  const payload = backupPayload();
  download(`personalflow-backup-${dateStamp()}.json`, JSON.stringify(payload, null, 2), "application/json");
  say(`Exported ${payload.tasks.length} tasks to JSON.`);
}

function csvCell(value) {
  let text = String(value ?? "");
  // Stop spreadsheet apps from running text as a formula
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function exportCsv() {
  const tasks = getData().tasks;
  const rows = [
    CSV_COLUMNS.join(","),
    ...tasks.map((t) => CSV_COLUMNS.map((col) => csvCell(t[col])).join(",")),
  ];
  // BOM so Excel reads UTF-8 correctly
  download(`personalflow-tasks-${dateStamp()}.csv`, `\uFEFF${rows.join("\r\n")}`, "text/csv;charset=utf-8");
  say(`Exported ${tasks.length} tasks to CSV.`);
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
  const ok = await confirmAction({
    title: "Import backup?",
    text:
      `This file has ${data.tasks.length} tasks. Importing replaces the ${current.tasks.length} tasks on this device. ` +
      "Your current data is saved as a recovery copy first. If Google Drive sync is on, the imported data will sync to Drive.",
    confirmLabel: "Import",
  });
  if (!ok) {
    say("Import cancelled. Nothing was changed.");
    return;
  }

  if (current.tasks.length) saveRecoveryCopy("This device, before importing a backup", current);
  replaceData({ ...data, updatedAt: new Date().toISOString() });
  say(`Imported ${data.tasks.length} tasks.`);
}

/* ---------- Clear local data ---------- */

async function clearLocalData() {
  const ok = await confirmAction({
    title: "Clear local data?",
    text:
      "This removes all tasks from this device and disconnects Google Drive here. " +
      "Your Google Drive file is NOT deleted, and you can reconnect later to load it back. " +
      "A recovery copy is saved first.",
    confirmLabel: "Clear local data",
    danger: true,
  });
  if (!ok) return;

  const current = getData();
  if (current.tasks.length) saveRecoveryCopy("This device, before clearing local data", current);

  // Removing the sync link too means an empty list can never be uploaded over the cloud file
  localStorage.removeItem(DATA_KEY);
  localStorage.removeItem(SYNC_KEY);
  location.reload();
}

/* ---------- Init ---------- */

export function initBackup() {
  $("exportJsonBtn").addEventListener("click", exportJson);
  $("exportCsvBtn").addEventListener("click", exportCsv);
  $("exportRecoveryBtn").addEventListener("click", exportRecovery);
  $("clearDataBtn").addEventListener("click", clearLocalData);

  $("importJsonBtn").addEventListener("click", () => $("importFile").click());
  $("importFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = ""; // allow picking the same file again
    if (file) await importJson(file);
  });
}