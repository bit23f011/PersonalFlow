import { isGoogleConfigured, requestAccessToken, hasAccessToken, revokeAccess } from "./google-auth.js";
import { findDataFile, readDataFile, createDataFile, updateDataFile } from "./google-drive.js";
import { getData, replaceData, subscribe } from "./state.js";
import { validateData, saveRecoveryCopy } from "./storage.js";

const META_KEY = "personalflow-sync";
const MODE_KEY = "personalflow-sync-mode"; // "manual" (default) or "auto", per device
const AUTO_DELAY_MS = 30_000; // automatic mode: wait this long after the last change

const $ = (id) => document.getElementById(id);

const SYNC_ICON =
  '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>';

// Errors that mean "Google sign-in is needed"
const AUTH_CODES = new Set([
  "popup_closed", "popup_failed_to_open", "access_denied", "interaction_required",
  "consent_required", "login_required", "immediate_failed", "auth", "busy", "unknown",
]);

const STATES = {
  local: { dot: "local", label: "Local only", message: "Not connected. Your tasks are stored on this device only." },
  synced: { dot: "synced", label: "Synced", message: "Everything is synced with Google Drive." },
  syncing: { dot: "syncing", label: "Syncing...", message: "Syncing with Google Drive..." },
  pending: { dot: "pending", label: "Changes pending", message: "You have changes that haven't been uploaded yet." },
  offline: { dot: "offline", label: "Offline", message: "You're offline. Changes are saved on this device and will sync when you're back online." },
  error: { dot: "error", label: "Sync failed", message: "Sync failed. Your local changes are safe." },
  reconnect: { dot: "pending", label: "Sign in to sync", message: "Sign in again to sync. Your changes are saved on this device." },
};

const PILL_LABEL = { syncing: "Syncing…", reconnect: "Sign in to sync", error: "Retry sync", pending: "Sync" };

let syncing = false;
let timer = null;
let lastIssue = null; // { kind: "auth" | "error" | "decision", state, message, retryOnOnline? }
let suppressChange = false;

/* ---------- Sync mode ---------- */

function autoSyncEnabled() {
  try {
    return localStorage.getItem(MODE_KEY) === "auto";
  } catch {
    return false;
  }
}

function setMode(mode) {
  try {
    localStorage.setItem(MODE_KEY, mode === "auto" ? "auto" : "manual");
  } catch (err) {
    console.error("Could not save the sync mode", err);
  }
  clearTimeout(timer);
  if (autoSyncEnabled()) scheduleSync(2000); // switching to automatic: sync soon
  renderUI();
}

/* ---------- Saved sync info (separate from task data) ---------- */

function loadMeta() {
  try {
    return JSON.parse(localStorage.getItem(META_KEY)) || {};
  } catch {
    return {};
  }
}

function saveMeta(meta) {
  localStorage.setItem(META_KEY, JSON.stringify(meta));
}

function markSynced(fileId, updatedAt) {
  saveMeta({
    ...loadMeta(),
    connected: true,
    fileId,
    syncedUpdatedAt: updatedAt,
    lastSyncedAt: new Date().toISOString(),
  });
}

function pendingChanges() {
  return getData().updatedAt !== loadMeta().syncedUpdatedAt;
}

/* ---------- Status UI ---------- */

function currentState() {
  if (!loadMeta().connected) return "local";
  if (syncing) return "syncing";
  if (lastIssue) return lastIssue.state;
  if (!navigator.onLine) return "offline";
  return pendingChanges() ? "pending" : "synced";
}

function formatWhen(iso) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function renderUI() {
  const meta = loadMeta();
  const connected = Boolean(meta.connected);
  const key = currentState();
  const state = STATES[key];

  // Sidebar status (also works as a sync button)
  const status = $("syncStatus");
  status.dataset.state = state.dot;
  status.classList.toggle("is-clickable", connected);
  status.setAttribute("aria-disabled", String(!connected));
  status.title = connected ? "Click to sync now" : "";
  $("syncStatusLabel").textContent = state.label;

  // Settings
  $("connectBtn").hidden = connected;
  $("syncNowBtn").hidden = !connected;
  $("disconnectBtn").hidden = !connected;
  ["connectBtn", "syncNowBtn", "disconnectBtn"].forEach((id) => {
    $(id).disabled = syncing;
  });

  let message = lastIssue ? lastIssue.message : state.message;
  if (!lastIssue && key === "pending" && !autoSyncEnabled()) message += " Press Sync Now to upload them.";
  $("cloudStatusText").textContent = message;
  $("cloudLastSynced").textContent = meta.lastSyncedAt ? `Last synced: ${formatWhen(meta.lastSyncedAt)}` : "";

  $("syncModeInfo").textContent = autoSyncEnabled()
    ? "Changes upload about 30 seconds after your last edit, and again when you come back online."
    : "Nothing is uploaded until you press Sync Now, tap the Sync button, or tap the sync status in the sidebar.";

  // Quick sync button for phones: only when there is something to do
  const pill = $("syncPill");
  pill.hidden = !(connected && ["pending", "reconnect", "error", "syncing"].includes(key));
  pill.dataset.state = state.dot;
  pill.disabled = syncing;
  pill.classList.toggle("is-syncing", syncing);
  $("syncPillLabel").textContent = PILL_LABEL[key] || "Sync";
}

/* ---------- Errors ---------- */

function describeError(err) {
  switch (err && err.code) {
    case "popup_closed": return "Sign-in was cancelled.";
    case "popup_failed_to_open": return "The sign-in popup was blocked. Allow popups for this site and try again.";
    case "access_denied": return "Access was denied in the Google sign-in.";
    case "network": return "Unable to reach Google Drive. Check your internet connection. Your local changes are safe.";
    case "auth": return "Your Google session expired. Press Sync Now to sign in again.";
    case "forbidden": return "Google refused the request. Check that the Google Drive API is enabled in your Google Cloud project.";
    default: return "Google Drive connection failed. Your local changes are safe.";
  }
}

function handleError(err, interactive) {
  console.error("Sync failed", err);
  const code = err && err.code;

  if (AUTH_CODES.has(code)) {
    lastIssue = {
      kind: "auth",
      state: "reconnect",
      message: interactive ? describeError(err) : STATES.reconnect.message,
    };
  } else if (code === "network") {
    lastIssue = { kind: "error", state: "error", message: describeError(err), retryOnOnline: true };
  } else {
    lastIssue = { kind: "error", state: "error", message: describeError(err) };
  }
}

/* ---------- Decision dialog ---------- */

function askDecision(title, text, choices) {
  return new Promise((resolve) => {
    const dialog = $("syncDialog");
    $("syncDialogTitle").textContent = title;
    $("syncDialogText").textContent = text;

    const box = $("syncDialogActions");
    box.innerHTML = "";
    let answer = "later"; // closing with Esc = decide later

    choices.forEach((choice) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `btn ${choice.primary ? "btn-primary" : "btn-ghost"}`;
      btn.textContent = choice.label;
      btn.addEventListener("click", () => {
        answer = choice.id;
        dialog.close();
      });
      box.appendChild(btn);
    });

    dialog.addEventListener("close", () => resolve(answer), { once: true });
    dialog.showModal();
  });
}

function deferDecision() {
  lastIssue = {
    kind: "decision",
    state: "pending",
    message: "Sync is waiting for your decision. Press Sync Now to choose.",
  };
}

/* ---------- Sync core ---------- */

function buildPayload() {
  const d = getData();
  return {
    version: d.version,
    updatedAt: d.updatedAt,
    tasks: d.tasks,
    settings: { theme: localStorage.getItem("personalflow-theme") || "system" },
  };
}

// Reads the cloud file. { data } if valid, { invalid: true } if unreadable/malformed.
async function readCloud(token, fileId) {
  try {
    const raw = await readDataFile(token, fileId);
    const data = validateData(raw);
    return data ? { data } : { invalid: true, raw };
  } catch (err) {
    if (err.code === "invalid_json") return { invalid: true, raw: null };
    throw err;
  }
}

async function uploadLocal(token, fileId) {
  const payload = buildPayload();
  await updateDataFile(token, fileId, payload);
  markSynced(fileId, payload.updatedAt);
}

function useCloud(cloudData, fileId) {
  const local = getData();
  if (local.tasks.length) saveRecoveryCopy("This device, before loading Google Drive data", local);

  suppressChange = true;
  try {
    replaceData(cloudData);
  } finally {
    suppressChange = false;
  }
  markSynced(fileId, cloudData.updatedAt);
}

async function reconcile(token) {
  const meta = loadMeta();
  const local = getData();

  // 1. Locate the cloud file
  let fileId = meta.fileId || null;
  let cloud = null;

  if (fileId) {
    try {
      cloud = await readCloud(token, fileId);
    } catch (err) {
      if (err.code === "not_found") fileId = null;
      else throw err;
    }
  }
  if (!fileId) {
    const found = await findDataFile(token);
    if (found) {
      fileId = found.id;
      cloud = await readCloud(token, fileId);
    }
  }

  // 2. No cloud file yet: create it from local data
  if (!fileId) {
    const payload = buildPayload();
    const created = await createDataFile(token, payload);
    markSynced(created.id, payload.updatedAt);
    return;
  }

  // 3. Cloud file unreadable: never load it, offer to replace it
  if (cloud.invalid) {
    const choice = await askDecision(
      "Cloud file can't be read",
      "The data file in Google Drive isn't a valid PersonalFlow file, so it was not loaded. Your data on this device is untouched. Replace the cloud file with this device's data?",
      [
        { id: "upload", label: "Replace cloud file with this device's data", primary: true },
        { id: "later", label: "Not now" },
      ]
    );
    if (choice === "upload") {
      if (cloud.raw) saveRecoveryCopy("Unreadable Google Drive file (replaced)", cloud.raw);
      await uploadLocal(token, fileId);
    } else {
      deferDecision();
    }
    return;
  }

  // 4. Compare versions
  const cloudData = cloud.data;
  if (cloudData.updatedAt === local.updatedAt) {
    markSynced(fileId, local.updatedAt);
    return;
  }

  const base = meta.syncedUpdatedAt || null; // document timestamp at the last successful sync
  const localChanged = base ? local.updatedAt !== base : local.tasks.length > 0;
  const cloudChanged = base ? cloudData.updatedAt !== base : true;

  // Only this device changed: cloud is not newer, safe to upload
  if (localChanged && !cloudChanged) {
    await uploadLocal(token, fileId);
    return;
  }

  // Only the cloud changed: ask before loading it
  if (!localChanged && cloudChanged) {
    const choice = await askDecision(
      "Newer data in Google Drive",
      `Google Drive has ${cloudData.tasks.length} tasks (saved ${formatWhen(cloudData.updatedAt)}). Load it onto this device? Your current data here is kept as a recovery copy.`,
      [
        { id: "cloud", label: "Load Google Drive data", primary: true },
        { id: "later", label: "Not now" },
      ]
    );
    if (choice === "cloud") useCloud(cloudData, fileId);
    else deferDecision();
    return;
  }

  // Both changed: the user decides
  const cloudNewer = cloudData.updatedAt > local.updatedAt;
  const choice = await askDecision(
    "Sync conflict",
    `This device has ${local.tasks.length} tasks (edited ${formatWhen(local.updatedAt)}). ` +
      `Google Drive has ${cloudData.tasks.length} tasks (edited ${formatWhen(cloudData.updatedAt)}). ` +
      `${cloudNewer ? "The Google Drive version is newer." : "This device's version is newer."} ` +
      `The version you don't choose is kept as a recovery copy on this device.`,
    [
      { id: "cloud", label: "Use Google Drive version", primary: cloudNewer },
      { id: "local", label: "Keep this device's version", primary: !cloudNewer },
      { id: "later", label: "Decide later" },
    ]
  );

  if (choice === "cloud") {
    useCloud(cloudData, fileId);
  } else if (choice === "local") {
    saveRecoveryCopy("Google Drive version, replaced by this device", cloudData);
    await uploadLocal(token, fileId);
  } else {
    deferDecision();
  }
}

async function runSync({ interactive = false } = {}) {
  if (syncing) return;
  const wasConnected = Boolean(loadMeta().connected);
  if (!wasConnected && !interactive) return;

  if (!isGoogleConfigured()) {
    lastIssue = { kind: "error", state: "error", message: "Add your Google Client ID in js/config.js first." };
    renderUI();
    return;
  }

  if (!navigator.onLine) {
    if (!wasConnected) {
      lastIssue = { kind: "error", state: "error", message: describeError({ code: "network" }) };
    }
    renderUI();
    return;
  }

  syncing = true;
  lastIssue = null;
  renderUI();

  try {
    const token = await requestAccessToken({ interactive });
    if (!wasConnected) saveMeta({ ...loadMeta(), connected: true });
    await reconcile(token);
  } catch (err) {
    handleError(err, interactive);
  } finally {
    syncing = false;
    renderUI();
    // Automatic mode only: edits made while syncing still need uploading
    if (!lastIssue && loadMeta().connected && pendingChanges()) scheduleSync(5000);
  }
}

// Automatic mode only. In manual mode nothing is ever scheduled.
function scheduleSync(delay = AUTO_DELAY_MS) {
  clearTimeout(timer);
  if (!autoSyncEnabled() || !loadMeta().connected || lastIssue) return;
  timer = setTimeout(() => runSync({ interactive: false }), delay);
}

function onDataChange() {
  if (suppressChange) return;
  if (lastIssue && lastIssue.kind === "error") lastIssue = null; // retry after a transient failure
  renderUI(); // shows "Changes pending"
  scheduleSync(); // does nothing in manual mode
}

function disconnect() {
  if (!confirm("Disconnect Google Drive? Your tasks stay on this device and in your Drive file.")) return;
  clearTimeout(timer);
  revokeAccess();
  saveMeta({});
  lastIssue = null;
  renderUI();
}

/* ---------- Extra page elements ---------- */

function buildExtras() {
  // Quick sync button for phones (bottom left, only shown when there is something to sync)
  document.body.insertAdjacentHTML(
    "beforeend",
    `<button class="sync-pill" id="syncPill" type="button" hidden>${SYNC_ICON}<span id="syncPillLabel">Sync</span></button>`
  );
  $("syncPill").addEventListener("click", () => runSync({ interactive: true }));

  // The sidebar status doubles as a sync button
  const status = $("syncStatus");
  status.setAttribute("role", "button");
  status.tabIndex = 0;
  const trigger = () => {
    if (loadMeta().connected) runSync({ interactive: true });
  };
  status.addEventListener("click", trigger);
  status.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      trigger();
    }
  });

  // "Sync mode" row in Settings, under Cloud Sync
  $("connectBtn")
    .closest(".setting-row")
    .insertAdjacentHTML(
      "afterend",
      `
      <div class="setting-row" id="syncModeRow">
        <div>
          <p class="setting-title">Sync mode</p>
          <p class="muted" id="syncModeInfo"></p>
        </div>
        <div class="setting-actions">
          <select class="input" id="syncMode" aria-label="Sync mode">
            <option value="manual">Manual (only when I sync)</option>
            <option value="auto">Automatic (30 seconds after changes)</option>
          </select>
        </div>
      </div>`
    );
  $("syncMode").value = autoSyncEnabled() ? "auto" : "manual";
  $("syncMode").addEventListener("change", (e) => setMode(e.target.value));
}

export function initSync() {
  buildExtras();

  $("connectBtn").addEventListener("click", () => runSync({ interactive: true }));
  $("syncNowBtn").addEventListener("click", () => runSync({ interactive: true }));
  $("disconnectBtn").addEventListener("click", disconnect);

  subscribe(onDataChange);

  window.addEventListener("online", () => {
    if (lastIssue && lastIssue.retryOnOnline) lastIssue = null;
    renderUI();
    scheduleSync(2000); // automatic mode only
  });
  window.addEventListener("offline", renderUI);

  // Automatic mode only: pick up changes from another device when returning to the tab
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && hasAccessToken()) scheduleSync(2000);
  });

  renderUI();
  if (loadMeta().connected && autoSyncEnabled()) runSync({ interactive: false });
}