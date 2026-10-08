import { isGoogleConfigured, requestAccessToken, hasAccessToken, revokeAccess } from "./google-auth.js";
import { findDataFile, readDataFile, createDataFile, updateDataFile } from "./google-drive.js";
import { getData, replaceData, subscribe } from "./state.js";
import { validateData, saveRecoveryCopy } from "./storage.js";

const META_KEY = "personalflow-sync";
const $ = (id) => document.getElementById(id);

// CSS ke mobile breakpoint ke barabar rakho (@media max-width: 760px)
const MOBILE_QUERY = "(max-width: 760px)";
// Mobile par auto sync band, sirf button dabane par sync hoga
const isMobile = () => window.matchMedia(MOBILE_QUERY).matches;

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

let syncing = false;
let timer = null;
let lastIssue = null; // { kind: "auth" | "error" | "decision", state, message, retryOnOnline? }
let suppressChange = false;

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

function renderUI() {
  const meta = loadMeta();
  const connected = Boolean(meta.connected);
  const state = STATES[currentState()];

  $("syncStatus").dataset.state = state.dot;
  $("syncStatusLabel").textContent = state.label;

  $("connectBtn").hidden = connected;
  $("syncNowBtn").hidden = !connected;
  $("disconnectBtn").hidden = !connected;
  ["connectBtn", "syncNowBtn", "disconnectBtn"].forEach((id) => {
    $(id).disabled = syncing;
  });

  $("cloudStatusText").textContent = lastIssue ? lastIssue.message : state.message;
  $("cloudLastSynced").textContent = meta.lastSyncedAt
    ? `Last synced: ${formatWhen(meta.lastSyncedAt)}`
    : "";
}

function formatWhen(iso) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
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
    // Edits made while syncing still need uploading (scheduleSync mobile par kuch nahi karta)
    if (!lastIssue && loadMeta().connected && pendingChanges()) scheduleSync(500);
  }
}

// Auto sync sirf desktop par. Mobile par yahin se return, to koi bhi trigger sync nahi chalayega.
function scheduleSync(delay = 2000) {
  clearTimeout(timer);
  if (isMobile()) return;
  if (!loadMeta().connected || lastIssue) return;
  timer = setTimeout(() => runSync({ interactive: false }), delay);
}

function onDataChange() {
  if (suppressChange) return;
  if (lastIssue && lastIssue.kind === "error") lastIssue = null; // retry after a transient failure
  renderUI();
  scheduleSync(); // mobile par ye skip ho jayega
}

function disconnect() {
  if (!confirm("Disconnect Google Drive? Your tasks stay on this device and in your Drive file.")) return;
  clearTimeout(timer);
  revokeAccess();
  saveMeta({});
  lastIssue = null;
  renderUI();
}

export function initSync() {
  // Buttons: har jagah manual sync (mobile aur desktop dono)
  $("connectBtn").addEventListener("click", () => runSync({ interactive: true }));
  $("syncNowBtn").addEventListener("click", () => runSync({ interactive: true }));
  $("disconnectBtn").addEventListener("click", disconnect);

  subscribe(onDataChange);

  window.addEventListener("online", () => {
    if (lastIssue && lastIssue.retryOnOnline) lastIssue = null;
    renderUI();
    scheduleSync(500); // mobile par skip
  });
  window.addEventListener("offline", renderUI);

  // Tab par wapas aane par sync: sirf desktop (mobile par ye baar-baar fire hota tha)
  document.addEventListener("visibilitychange", () => {
    if (isMobile()) return;
    if (document.visibilityState === "visible" && hasAccessToken()) scheduleSync(300);
  });

  // Screen size badalne par (rotate/resize) sirf status refresh, sync nahi
  window.matchMedia(MOBILE_QUERY).addEventListener("change", () => {
    clearTimeout(timer);
    renderUI();
  });

  renderUI();

  // Page load par auto sync: sirf desktop
  if (loadMeta().connected && !isMobile()) runSync({ interactive: false });
}