import { GOOGLE_CLIENT_ID, DRIVE_SCOPE } from "./config.js";

const SIGN_IN_TIMEOUT_MS = 120_000; // a sign-in popup that never answers is dropped after this long

let tokenClient = null;
let pending = null; // { resolve, reject, timer } for the sign-in currently in progress
let accessToken = null;
let expiresAt = 0;

function authError(code) {
  const err = new Error(`Google auth error: ${code}`);
  err.code = code;
  return err;
}

export function isGoogleConfigured() {
  return Boolean(GOOGLE_CLIENT_ID) && !GOOGLE_CLIENT_ID.startsWith("PASTE_");
}

export function hasAccessToken() {
  return Boolean(accessToken) && Date.now() < expiresAt - 60_000;
}

function loadGisScript() {
  if (window.google && window.google.accounts && window.google.accounts.oauth2) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = resolve;
    script.onerror = () => {
      script.remove();
      reject(authError("network"));
    };
    document.head.appendChild(script);
  });
}

// Takes the sign-in that is in progress (if any) and stops its timer
function takePending() {
  if (!pending) return null;
  const p = pending;
  pending = null;
  clearTimeout(p.timer);
  return p;
}

async function getTokenClient() {
  await loadGisScript();
  if (!tokenClient) {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: (resp) => {
        const p = takePending();
        if (!p) return;
        if (resp.error) return p.reject(authError(resp.error));
        accessToken = resp.access_token;
        expiresAt = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
        p.resolve(accessToken);
      },
      error_callback: (err) => {
        const p = takePending();
        if (p) p.reject(authError((err && err.type) || "unknown"));
      },
    });
  }
  return tokenClient;
}

/**
 * Returns a valid access token.
 * interactive: true  -> may open Google's sign-in popup (call it from a button tap)
 * interactive: false -> never opens anything; fails if there is no valid token.
 *   (A silent attempt makes the popup flash open and closed on phones, so background
 *   work never tries it: signing in always needs a tap.)
 */
export async function requestAccessToken({ interactive = true } = {}) {
  if (hasAccessToken()) return accessToken;
  if (!interactive) throw authError("interaction_required");
  if (pending) throw authError("busy");

  const client = await getTokenClient();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pending && pending.timer === timer) {
        pending = null;
        reject(authError("popup_closed"));
      }
    }, SIGN_IN_TIMEOUT_MS);

    pending = { resolve, reject, timer };
    client.requestAccessToken({ prompt: "" });
  });
}

export function revokeAccess() {
  const token = accessToken;
  accessToken = null;
  expiresAt = 0;
  if (token && window.google && window.google.accounts) {
    window.google.accounts.oauth2.revoke(token, () => {});
  }
}