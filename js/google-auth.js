import { GOOGLE_CLIENT_ID, DRIVE_SCOPE } from "./config.js";

let tokenClient = null;
let pending = null; // { resolve, reject } for the sign-in currently in progress
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

async function getTokenClient() {
  await loadGisScript();
  if (!tokenClient) {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: (resp) => {
        if (!pending) return;
        const p = pending;
        pending = null;
        if (resp.error) return p.reject(authError(resp.error));
        accessToken = resp.access_token;
        expiresAt = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
        p.resolve(accessToken);
      },
      error_callback: (err) => {
        if (!pending) return;
        const p = pending;
        pending = null;
        p.reject(authError((err && err.type) || "unknown"));
      },
    });
  }
  return tokenClient;
}

/**
 * Returns a valid access token.
 * interactive: true  -> may open Google's sign-in popup (call from a button click)
 * interactive: false -> never shows UI; fails if sign-in is needed
 */
export async function requestAccessToken({ interactive = true } = {}) {
  if (hasAccessToken()) return accessToken;
  if (pending) throw authError("busy");

  const client = await getTokenClient();
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    client.requestAccessToken({ prompt: interactive ? "" : "none" });
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