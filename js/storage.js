const DATA_KEY = "personalflow-data";
const RECOVERY_KEY = "personalflow-recovery";
const DATA_VERSION = 1;
const MAX_RECOVERY_COPIES = 3;

// Keep these lists in sync with js/tasks.js
const PRIORITIES = ["high", "medium", "low"];
const CATEGORIES = ["Personal", "Projects", "Learning", "Work", "Other"];

function emptyData() {
  return {
    version: DATA_VERSION,
    updatedAt: new Date().toISOString(),
    tasks: [],
    settings: {},
  };
}

export function loadData() {
  const raw = localStorage.getItem(DATA_KEY);
  if (!raw) return emptyData();

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.tasks)) throw new Error("Unexpected data shape");
    return { ...emptyData(), ...parsed };
  } catch (err) {
    // Never lose data: keep a copy of the unreadable value before starting fresh
    console.error("PersonalFlow: saved data unreadable, backup kept.", err);
    try {
      localStorage.setItem(`${DATA_KEY}-backup-${Date.now()}`, raw);
    } catch (backupErr) {
      console.error(backupErr);
    }
    return emptyData();
  }
}

export function saveData(data) {
  try {
    localStorage.setItem(DATA_KEY, JSON.stringify(data));
    return true;
  } catch (err) {
    console.error("PersonalFlow: could not save data.", err);
    return false;
  }
}

/**
 * Validates data coming from outside (Google Drive now, JSON import later).
 * Returns a clean data object, or null if anything is malformed.
 * Rejects the WHOLE document rather than silently dropping tasks.
 */
export function validateData(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.tasks)) return null;
  if (typeof raw.version === "number" && raw.version > DATA_VERSION) return null; // newer format

  const now = new Date().toISOString();
  const str = (v, fallback) => (typeof v === "string" && v ? v : fallback);
  const tasks = [];

  for (const t of raw.tasks) {
    if (!t || typeof t !== "object") return null;
    if (typeof t.id !== "string" || !t.id) return null;
    if (typeof t.title !== "string" || !t.title.trim()) return null;

    const createdAt = str(t.createdAt, now);
    tasks.push({
      id: t.id,
      title: t.title.trim(),
      description: typeof t.description === "string" ? t.description : "",
      priority: PRIORITIES.includes(t.priority) ? t.priority : "medium",
      category: CATEGORIES.includes(t.category) ? t.category : "Other",
      dueDate: typeof t.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.dueDate) ? t.dueDate : "",
      completed: t.completed === true,
      createdAt,
      updatedAt: str(t.updatedAt, createdAt),
    });
  }

  return {
    version: DATA_VERSION,
    updatedAt: str(raw.updatedAt, now),
    tasks,
    settings: raw.settings && typeof raw.settings === "object" ? raw.settings : {},
  };
}

/* ---------- Recovery copies (last few versions replaced by a sync decision) ---------- */

export function getRecoveryCopies() {
  try {
    const list = JSON.parse(localStorage.getItem(RECOVERY_KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveRecoveryCopy(label, data) {
  try {
    const list = getRecoveryCopies();
    list.unshift({ label, savedAt: new Date().toISOString(), data });
    localStorage.setItem(RECOVERY_KEY, JSON.stringify(list.slice(0, MAX_RECOVERY_COPIES)));
  } catch (err) {
    console.error("PersonalFlow: could not save recovery copy.", err);
  }
}