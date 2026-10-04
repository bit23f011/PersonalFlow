import { DRIVE_FILE_NAME } from "./config.js";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";

export class DriveError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request(token, url, options = {}) {
  let res;
  try {
    res = await fetch(url, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) },
    });
  } catch (err) {
    console.error("Drive network error", err);
    throw new DriveError("Network error", "network");
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("Drive error", res.status, body);
    const code =
      res.status === 401 ? "auth" :
      res.status === 403 ? "forbidden" :
      res.status === 404 ? "not_found" : "http";
    throw new DriveError(`Drive request failed (${res.status})`, code, res.status);
  }
  return res;
}

// Finds the app's data file (drive.file scope only sees files this app created)
export async function findDataFile(token) {
  const params = new URLSearchParams({
    q: `name='${DRIVE_FILE_NAME}' and trashed=false`,
    fields: "files(id,name,modifiedTime)",
    orderBy: "modifiedTime desc",
    pageSize: "1",
    spaces: "drive",
  });
  const res = await request(token, `${API}/files?${params}`);
  const body = await res.json();
  return body.files && body.files.length ? body.files[0] : null;
}

export async function readDataFile(token, fileId) {
  const res = await request(token, `${API}/files/${fileId}?alt=media`);
  try {
    return await res.json();
  } catch (err) {
    console.error("Cloud file is not valid JSON", err);
    throw new DriveError("Cloud file is not valid JSON", "invalid_json");
  }
}

export async function createDataFile(token, data) {
  const boundary = `pf${Math.random().toString(36).slice(2)}`;
  const metadata = { name: DRIVE_FILE_NAME, mimeType: "application/json" };
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(data)}\r\n` +
    `--${boundary}--`;

  const res = await request(token, `${UPLOAD}/files?uploadType=multipart&fields=id,modifiedTime`, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  return res.json();
}

export async function updateDataFile(token, fileId, data) {
  const res = await request(token, `${UPLOAD}/files/${fileId}?uploadType=media&fields=id,modifiedTime`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return res.json();
}