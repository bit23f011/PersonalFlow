const KEY = "personalflow-lock"; // per device
const DEFAULT = {
  method: "", // "" (off) | "pin" | "fingerprint"
  salt: "",
  hash: "",
  credentialId: "",
  lockAfter: 60, // seconds away from the app before it locks again (0 = immediately)
  fails: 0,
  until: 0,
};

const MAX_FAILS = 5;
const LOCKOUT_MS = 30_000;
const MAX_LOCKOUT_MS = 300_000;
const PBKDF2_ITERATIONS = 100_000;

// Just enough to cover the page at once, before css/lock.css has loaded
const CRITICAL_STYLE =
  "position:fixed;inset:0;width:100%;height:100%;max-width:none;max-height:none;margin:0;border:0;padding:24px;background:var(--bg);color:var(--text);";

const $ = (id) => document.getElementById(id);
const enc = new TextEncoder();
const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

let locked = false;
let busy = false; // a fingerprint or PIN check is in progress
let hiddenAt = 0;

/* ---------- Saved lock settings ---------- */

function load() {
  try {
    return { ...DEFAULT, ...(JSON.parse(localStorage.getItem(KEY)) || {}) };
  } catch {
    return { ...DEFAULT };
  }
}

function save(lock) {
  try {
    localStorage.setItem(KEY, JSON.stringify(lock));
  } catch (err) {
    console.error("App lock: could not save.", err);
  }
}

/* ---------- PIN ---------- */

async function hashPin(pin, saltB64) {
  const key = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: fromB64(saltB64), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    key,
    256
  );
  return toB64(bits);
}

// Checks a PIN, with a growing wait after too many wrong tries
async function checkPin(pin) {
  const lock = load();
  const wait = lock.until - Date.now();
  if (wait > 0) {
    return { ok: false, message: `Too many attempts. Try again in ${Math.ceil(wait / 1000)} seconds.` };
  }

  if ((await hashPin(pin, lock.salt)) === lock.hash) return { ok: true };

  lock.fails = (lock.fails || 0) + 1;
  let message = "Wrong PIN.";
  if (lock.fails >= MAX_FAILS) {
    const waitMs = Math.min(LOCKOUT_MS * 2 ** (lock.fails - MAX_FAILS), MAX_LOCKOUT_MS);
    lock.until = Date.now() + waitMs;
    message = `Wrong PIN. Try again in ${Math.ceil(waitMs / 1000)} seconds.`;
  }
  save(lock);
  return { ok: false, message };
}

/* ---------- Fingerprint (the phone's own biometric check, through WebAuthn) ---------- */

const isMobile = () =>
  /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (window.matchMedia("(pointer: coarse)").matches && navigator.maxTouchPoints > 0);

async function fingerprintSupported() {
  try {
    return (
      Boolean(window.PublicKeyCredential) &&
      window.isSecureContext &&
      (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())
    );
  } catch {
    return false;
  }
}

async function registerFingerprint() {
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: randomBytes(32),
      rp: { name: "PersonalFlow" },
      user: { id: randomBytes(16), name: "personalflow", displayName: "PersonalFlow" },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "discouraged",
      },
      timeout: 60000,
      attestation: "none",
    },
  });
  return toB64(credential.rawId);
}

// true only if the phone confirms the user (fingerprint or screen lock)
async function verifyFingerprint(credentialId) {
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32),
      allowCredentials: [{ type: "public-key", id: fromB64(credentialId), transports: ["internal"] }],
      userVerification: "required",
      timeout: 60000,
    },
  });
  if (!assertion) return false;
  const flags = new Uint8Array(assertion.response.authenticatorData)[32];
  return (flags & 0x04) !== 0; // "user verified" flag
}

/* ---------- Page elements ---------- */

function loadStyles() {
  // This module brings its own stylesheet
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "css/lock.css";
  document.head.appendChild(link);
}

function buildUI() {
  document.body.insertAdjacentHTML(
    "beforeend",
    `
    <dialog class="lock-screen" id="lockScreen" aria-label="PersonalFlow is locked" style="${CRITICAL_STYLE}">
      <div class="lock-card">
        <img class="lock-logo" src="assets/favicon1.png" alt="" width="64" height="64" />
        <h1 class="lock-title">PersonalFlow is locked</h1>
        <form class="lock-form" id="lockPinForm" autocomplete="off" hidden>
          <input class="input lock-pin" id="lockPinInput" type="password" inputmode="numeric"
            autocomplete="off" maxlength="8" placeholder="Enter PIN" aria-label="PIN" />
          <button class="btn btn-primary" type="submit">Unlock</button>
        </form>
        <button class="btn btn-primary" id="lockBioBtn" type="button" hidden>Unlock with fingerprint</button>
        <p class="lock-error" id="lockError" role="alert"></p>
        <p class="muted lock-hint">Forgot it? Clear this site's data in your browser settings. Tasks synced with Google Drive come back after you reconnect.</p>
      </div>
    </dialog>

    <dialog class="modal" id="pinDialog" aria-labelledby="pinTitle">
      <form class="modal-form" id="pinForm" novalidate>
        <h2 id="pinTitle">Set PIN</h2>
        <p class="muted" id="pinText"></p>
        <div class="field">
          <label for="pinInput">PIN (4 to 8 digits)</label>
          <input class="input" id="pinInput" type="password" inputmode="numeric" autocomplete="off" maxlength="8" />
        </div>
        <div class="field" id="pinConfirmField">
          <label for="pinConfirm">Repeat PIN</label>
          <input class="input" id="pinConfirm" type="password" inputmode="numeric" autocomplete="off" maxlength="8" />
        </div>
        <p class="field-error" id="pinError" hidden></p>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="pinCancel" type="button">Cancel</button>
          <button class="btn btn-primary" id="pinOk" type="submit">Save</button>
        </div>
      </form>
    </dialog>`
  );
}

// Adds the "App lock" row to Settings, below Reminders
function buildSettingsRow() {
  $("notifyToggleBtn")
    .closest(".setting-row")
    .insertAdjacentHTML(
      "afterend",
      `
      <div class="setting-row" id="lockRow">
        <div>
          <p class="setting-title">App lock</p>
          <p class="muted" id="lockInfo"></p>
          <p class="muted" id="lockNotice" aria-live="polite"></p>
        </div>
        <div class="setting-actions" id="lockActions"></div>
      </div>`
    );
}

const notice = (text) => {
  $("lockNotice").textContent = text;
};

/* ---------- PIN dialog ---------- */

// Resolves with the typed PIN, or null if cancelled
function promptPin({ title, text, confirm = false, okLabel = "Save" }) {
  return new Promise((resolve) => {
    const dialog = $("pinDialog");
    const error = $("pinError");
    $("pinTitle").textContent = title;
    $("pinText").textContent = text;
    $("pinOk").textContent = okLabel;
    $("pinConfirmField").hidden = !confirm;
    $("pinInput").value = "";
    $("pinConfirm").value = "";
    error.hidden = true;

    let result = null;
    const fail = (message) => {
      error.textContent = message;
      error.hidden = false;
    };

    $("pinForm").onsubmit = (e) => {
      e.preventDefault();
      const pin = $("pinInput").value.trim();
      if (!/^\d{4,8}$/.test(pin)) return fail("Use 4 to 8 digits.");
      if (confirm && pin !== $("pinConfirm").value.trim()) return fail("The two PINs don't match.");
      result = pin;
      dialog.close();
    };
    $("pinCancel").onclick = () => dialog.close();
    dialog.addEventListener(
      "close",
      () => {
        $("pinInput").value = "";
        $("pinConfirm").value = "";
        resolve(result);
      },
      { once: true }
    );

    dialog.showModal();
    $("pinInput").focus();
  });
}

async function setPin(changing) {
  if (!window.crypto || !crypto.subtle) {
    notice("A PIN lock needs a secure page (https or localhost).");
    return false;
  }
  const pin = await promptPin({
    title: changing ? "New PIN" : "Set PIN",
    text: "Choose 4 to 8 digits. The PIN is stored on this computer only and cannot be recovered. Keep a backup (Export JSON) or Google Drive sync on.",
    confirm: true,
  });
  if (!pin) return false;

  const salt = toB64(randomBytes(16));
  const hash = await hashPin(pin, salt);
  save({ ...load(), method: "pin", salt, hash, credentialId: "", fails: 0, until: 0 });
  return true;
}

// Asks for the PIN or the fingerprint before a sensitive change
async function verifyOwner() {
  const lock = load();

  if (lock.method === "fingerprint") {
    busy = true;
    try {
      return await verifyFingerprint(lock.credentialId);
    } catch (err) {
      console.error("Fingerprint check failed", err);
      notice("Couldn't verify your fingerprint.");
      return false;
    } finally {
      busy = false;
    }
  }

  const pin = await promptPin({ title: "Enter your PIN", text: "Confirm that it's you.", okLabel: "Continue" });
  if (!pin) return false;
  const result = await checkPin(pin);
  if (!result.ok) notice(result.message);
  return result.ok;
}

/* ---------- Lock screen ---------- */

function showLock() {
  const lock = load();
  if (!lock.method) return;

  // A dialog that is open would stay above the lock screen: close them
  document.querySelectorAll("dialog[open]").forEach((d) => {
    if (d.id !== "lockScreen") d.close();
  });

  locked = true;
  $("lockPinForm").hidden = lock.method !== "pin";
  $("lockBioBtn").hidden = lock.method !== "fingerprint";
  $("lockError").textContent = "";
  $("lockPinInput").value = "";
  if (!$("lockScreen").open) $("lockScreen").showModal();

  if (document.visibilityState !== "visible") return;
  if (lock.method === "pin") $("lockPinInput").focus();
  else tryFingerprint(true);
}

function unlock() {
  locked = false;
  hiddenAt = 0;
  const lock = load();
  lock.fails = 0;
  lock.until = 0;
  save(lock);
  $("lockScreen").close();
}

async function tryFingerprint(auto = false) {
  if (busy) return;
  busy = true;
  $("lockError").textContent = "";
  try {
    if (await verifyFingerprint(load().credentialId)) unlock();
    else if (!auto) $("lockError").textContent = "Fingerprint not recognised. Try again.";
  } catch (err) {
    console.error("Fingerprint unlock failed", err);
    if (!auto) $("lockError").textContent = "Couldn't verify. Try again.";
  } finally {
    busy = false;
  }
}

function onVisibility() {
  const lock = load();
  if (!lock.method || busy) return;

  if (document.visibilityState === "hidden") {
    if (!locked) {
      hiddenAt = Date.now();
      // lock right away so the app switcher shows the lock screen, not your tasks
      if (lock.lockAfter === 0) showLock();
    }
    return;
  }

  // visible again
  if (!locked && hiddenAt && Date.now() - hiddenAt >= lock.lockAfter * 1000) {
    showLock();
  } else if (locked) {
    if (lock.method === "fingerprint") tryFingerprint(true);
    else $("lockPinInput").focus();
  }
  if (!locked) hiddenAt = 0;
}

/* ---------- Settings row ---------- */

async function renderRow() {
  const lock = load();
  const info = $("lockInfo");
  const actions = $("lockActions");

  if (lock.method) {
    const what = lock.method === "fingerprint" ? "your fingerprint (or phone screen lock)" : "a PIN";
    info.textContent = `Locked with ${what} on this device. It also locks again when you come back after being away.`;
    actions.innerHTML = `
      <select class="input" id="lockAfter" aria-label="Lock after leaving the app">
        <option value="0">Lock immediately</option>
        <option value="60">After 1 minute</option>
        <option value="300">After 5 minutes</option>
        <option value="900">After 15 minutes</option>
      </select>
      <button class="btn btn-ghost" type="button" data-lock="now">Lock now</button>
      ${lock.method === "pin" ? '<button class="btn btn-ghost" type="button" data-lock="change">Change PIN</button>' : ""}
      <button class="btn btn-outline-danger" type="button" data-lock="off">Turn off</button>`;
    $("lockAfter").value = String(lock.lockAfter);
    return;
  }

  if (isMobile()) {
    if (!(await fingerprintSupported())) {
      info.textContent =
        "Fingerprint lock isn't available here. It needs a fingerprint or screen lock set up on this phone, and a secure (https) page.";
      actions.innerHTML = "";
      return;
    }
    info.textContent = "Lock the app with your fingerprint. This works on this phone only.";
    actions.innerHTML = '<button class="btn btn-primary" type="button" data-lock="on-fingerprint">Turn on fingerprint lock</button>';
  } else {
    info.textContent = "Lock the app with a PIN on this computer. This works on this computer only.";
    actions.innerHTML = '<button class="btn btn-primary" type="button" data-lock="on-pin">Set PIN</button>';
  }
}

async function enableFingerprint() {
  busy = true;
  try {
    const credentialId = await registerFingerprint();
    save({ ...load(), method: "fingerprint", credentialId, salt: "", hash: "", fails: 0, until: 0 });
    notice("Fingerprint lock is on.");
  } catch (err) {
    console.error("Fingerprint setup failed", err);
    notice("Couldn't set up fingerprint lock. Make sure this phone has a fingerprint or screen lock set up.");
  } finally {
    busy = false;
  }
}

async function onAction(action) {
  notice("");
  try {
    if (action === "on-fingerprint") {
      await enableFingerprint();
    } else if (action === "on-pin") {
      if (await setPin(false)) notice("PIN lock is on.");
    } else if (action === "change") {
      if ((await verifyOwner()) && (await setPin(true))) notice("PIN changed.");
    } else if (action === "off") {
      if (await verifyOwner()) {
        save({ ...DEFAULT, lockAfter: load().lockAfter });
        notice("App lock is off.");
      }
    } else if (action === "now") {
      showLock();
    }
  } catch (err) {
    console.error("App lock action failed", err);
    notice("Something went wrong. Please try again.");
  }
  renderRow();
}

/* ---------- Start-up ---------- */

export function initLock() {
  loadStyles();
  buildUI();

  // Lock first, before anything else is set up
  if (load().method) showLock();

  const screen = $("lockScreen");
  screen.addEventListener("cancel", (e) => e.preventDefault()); // Escape does not unlock
  screen.addEventListener("close", () => {
    if (locked) screen.showModal(); // still locked: it cannot be dismissed
  });

  $("lockBioBtn").addEventListener("click", () => tryFingerprint(false));
  $("lockPinForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pin = $("lockPinInput").value.trim();
    $("lockPinInput").value = "";
    if (!pin) return;
    try {
      const result = await checkPin(pin);
      if (result.ok) unlock();
      else $("lockError").textContent = result.message;
    } catch (err) {
      console.error("PIN check failed", err);
      $("lockError").textContent = "Couldn't check the PIN. This needs a secure page (https or localhost).";
    }
  });

  buildSettingsRow();
  $("lockRow").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-lock]");
    if (btn) onAction(btn.dataset.lock);
  });
  $("lockRow").addEventListener("change", (e) => {
    if (e.target.id !== "lockAfter") return;
    const lock = load();
    lock.lockAfter = Number(e.target.value);
    save(lock);
  });
  renderRow();

  document.addEventListener("visibilitychange", onVisibility);
}