const DATA_KEY = "personalflow-data";
const RECOVERY_KEY = "personalflow-recovery";
const DATA_VERSION = 1;
const MAX_RECOVERY_COPIES = 3;
const MAX_CATEGORY_LENGTH = 30;
const MAX_SUBTASK_LENGTH = 200;
const MAX_LINKS = 10;
const MAX_DONE_DATES = 200;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COLOR_RE = /^#[0-9a-f]{6}$/i;

// Keep in sync with js/tasks.js
const PRIORITIES = ["high", "medium", "low"];
const REPEATS = ["daily", "weekdays", "weekly", "monthly"];

// Bug tracker (used from Step 3)
const BUG_STATUSES = ["todo", "progress", "testing", "solved"];
const BUG_SEVERITIES = ["low", "medium", "high", "critical"];

function emptyData() {
  return {
    version: DATA_VERSION,
    updatedAt: new Date().toISOString(),
    tasks: [],
    bugs: [],
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

/* ---------- Small cleaners ---------- */

const str = (v, fallback = "") => (typeof v === "string" && v ? v : fallback);
const isIso = (v) => typeof v === "string" && v !== "" && !Number.isNaN(Date.parse(v));

function cleanCategory(value) {
  if (typeof value !== "string") return "Other";
  const clean = value.replace(/\s+/g, " ").trim().slice(0, MAX_CATEGORY_LENGTH);
  return clean || "Other";
}

// Keeps only valid http(s) links
function cleanLinks(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  for (const link of value) {
    if (typeof link !== "string") continue;
    const text = link.trim().slice(0, 500);
    if (/^https?:\/\/\S+$/i.test(text) && !result.includes(text)) result.push(text);
    if (result.length >= MAX_LINKS) break;
  }
  return result;
}

// One subtask, sub-subtask or checklist item: { id, title, done }, or null if malformed
function cleanItem(s) {
  if (!s || typeof s !== "object") return null;
  if (typeof s.id !== "string" || !s.id) return null;
  if (typeof s.title !== "string" || !s.title.trim()) return null;
  return { id: s.id, title: s.title.trim().slice(0, MAX_SUBTASK_LENGTH), done: s.done === true };
}

// Returns a clean subtask list (each may have "children"), or null if the list is malformed
function cleanSubtasks(value) {
  if (value === undefined || value === null) return []; // older data without subtasks
  if (!Array.isArray(value)) return null;

  const result = [];
  for (const s of value) {
    const item = cleanItem(s);
    if (!item) return null;

    if (s.children !== undefined && s.children !== null) {
      if (!Array.isArray(s.children)) return null;
      const children = [];
      for (const c of s.children) {
        const child = cleanItem(c);
        if (!child) return null;
        children.push(child);
      }
      if (children.length) {
        item.children = children;
        item.done = children.every((c) => c.done); // a parent follows its children
      }
    }
    result.push(item);
  }
  return result;
}

// A flat checklist (used by bugs), or null if malformed
function cleanChecklist(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const result = [];
  for (const s of value) {
    const item = cleanItem(s);
    if (!item) return null;
    result.push(item);
  }
  return result;
}

// Returns a clean bug list, or null if anything is malformed
function cleanBugs(value, now) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;

  const result = [];
  for (const b of value) {
    if (!b || typeof b !== "object") return null;
    if (typeof b.id !== "string" || !b.id) return null;
    if (typeof b.title !== "string" || !b.title.trim()) return null;
    const checklist = cleanChecklist(b.checklist);
    if (!checklist) return null;

    const createdAt = isIso(b.createdAt) ? b.createdAt : now;
    const status = BUG_STATUSES.includes(b.status) ? b.status : "todo";
    result.push({
      id: b.id,
      title: b.title.trim().slice(0, 200),
      description: str(b.description).slice(0, 5000),
      steps: str(b.steps).slice(0, 5000),
      project: str(b.project).replace(/\s+/g, " ").trim().slice(0, 40),
      status,
      severity: BUG_SEVERITIES.includes(b.severity) ? b.severity : "medium",
      checklist,
      links: cleanLinks(b.links),
      createdAt,
      updatedAt: isIso(b.updatedAt) ? b.updatedAt : createdAt,
      resolvedAt: status === "solved" && isIso(b.resolvedAt) ? b.resolvedAt : "",
    });
  }
  return result;
}

/**
 * Validates data coming from outside (Google Drive, JSON import).
 * Returns a clean data object, or null if anything is malformed.
 * Rejects the WHOLE document rather than silently dropping tasks.
 * Older data without the newer optional fields is fine.
 */
export function validateData(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.tasks)) return null;
  if (typeof raw.version === "number" && raw.version > DATA_VERSION) return null; // newer format

  const now = new Date().toISOString();
  const tasks = [];

  for (const t of raw.tasks) {
    if (!t || typeof t !== "object") return null;
    if (typeof t.id !== "string" || !t.id) return null;
    if (typeof t.title !== "string" || !t.title.trim()) return null;

    const subtasks = cleanSubtasks(t.subtasks);
    if (!subtasks) return null;

    const createdAt = str(t.createdAt, now);
    const dueDate = typeof t.dueDate === "string" && DATE_RE.test(t.dueDate) ? t.dueDate : "";

    tasks.push({
      id: t.id,
      title: t.title.trim(),
      description: typeof t.description === "string" ? t.description : "",
      priority: PRIORITIES.includes(t.priority) ? t.priority : "medium",
      category: cleanCategory(t.category), // custom categories are allowed
      color: typeof t.color === "string" && COLOR_RE.test(t.color) ? t.color.toLowerCase() : "",
      links: cleanLinks(t.links),
      dueDate,
      dueTime: dueDate && typeof t.dueTime === "string" && TIME_RE.test(t.dueTime) ? t.dueTime : "",
      repeat: dueDate && REPEATS.includes(t.repeat) ? t.repeat : "", // repeating needs a date
      completedCount: Number.isInteger(t.completedCount) && t.completedCount > 0 ? t.completedCount : 0,
      focusMinutes: Number.isInteger(t.focusMinutes) && t.focusMinutes > 0 ? t.focusMinutes : 0,
      focusDate: typeof t.focusDate === "string" && DATE_RE.test(t.focusDate) ? t.focusDate : "",
      starred: t.starred === true,
      subtasks,
      // With subtasks, "completed" always follows them
      completed: subtasks.length ? subtasks.every((s) => s.done) : t.completed === true,
      completedAt: isIso(t.completedAt) ? t.completedAt : "",
      doneDates: Array.isArray(t.doneDates)
        ? t.doneDates.filter((d) => typeof d === "string" && DATE_RE.test(d)).slice(-MAX_DONE_DATES)
        : [],
      createdAt,
      updatedAt: str(t.updatedAt, createdAt),
    });
  }

  const bugs = cleanBugs(raw.bugs, now);
  if (!bugs) return null;

  return {
    version: DATA_VERSION,
    updatedAt: str(raw.updatedAt, now),
    tasks,
    bugs,
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