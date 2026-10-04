import { getTasks, commitTasks } from "./state.js";

export const PRIORITIES = ["high", "medium", "low"];
export const BUILTIN_CATEGORIES = ["Personal", "Projects", "Learning", "Work", "Other"];
const MAX_CATEGORY_LENGTH = 30;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

/* ---------- Dates (local time, "YYYY-MM-DD") ---------- */

const pad = (n) => String(n).padStart(2, "0");

function toDateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayStr() {
  return toDateStr(new Date());
}

export function tomorrowStr() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return toDateStr(d);
}

/* ---------- Categories ---------- */

// Built-in categories first, then custom ones (any category used by a task), A-Z
export function getCategories() {
  const custom = new Set();
  getTasks().forEach((t) => {
    if (!BUILTIN_CATEGORIES.includes(t.category)) custom.add(t.category);
  });
  return [...BUILTIN_CATEGORIES, ...[...custom].sort((a, b) => a.localeCompare(b))];
}

// Cleans a typed name and reuses an existing category with the same name (ignoring case)
export function resolveCategory(name) {
  const clean = String(name || "").replace(/\s+/g, " ").trim().slice(0, MAX_CATEGORY_LENGTH);
  if (!clean) return "Other";
  const existing = getCategories().find((c) => c.toLowerCase() === clean.toLowerCase());
  return existing || clean;
}

/* ---------- CRUD ---------- */

function newId() {
  return crypto.randomUUID
    ? `task-${crypto.randomUUID()}`
    : `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalize(fields) {
  const dueDate = fields.dueDate || "";
  return {
    title: (fields.title || "").trim(),
    description: (fields.description || "").trim(),
    priority: PRIORITIES.includes(fields.priority) ? fields.priority : "medium",
    category: resolveCategory(fields.category),
    dueDate,
    // A time only makes sense together with a date
    dueTime: dueDate && TIME_RE.test(fields.dueTime || "") ? fields.dueTime : "",
  };
}

export function getTask(id) {
  return getTasks().find((t) => t.id === id);
}

export function addTask(fields) {
  const now = new Date().toISOString();
  const task = {
    id: newId(),
    ...normalize(fields),
    completed: false,
    createdAt: now,
    updatedAt: now,
  };
  commitTasks([...getTasks(), task]);
}

export function updateTask(id, fields) {
  const now = new Date().toISOString();
  commitTasks(
    getTasks().map((t) => (t.id === id ? { ...t, ...normalize(fields), updatedAt: now } : t))
  );
}

export function toggleTask(id) {
  const now = new Date().toISOString();
  commitTasks(
    getTasks().map((t) => (t.id === id ? { ...t, completed: !t.completed, updatedAt: now } : t))
  );
}

export function deleteTask(id) {
  commitTasks(getTasks().filter((t) => t.id !== id));
}

/* ---------- Queries ---------- */

// Not done first, then by date, then by time (untimed last), then by priority
function sortTasks(list) {
  return [...list].sort(
    (a, b) =>
      Number(a.completed) - Number(b.completed) ||
      (a.dueDate || "9999").localeCompare(b.dueDate || "9999") ||
      (a.dueTime || "99:99").localeCompare(b.dueTime || "99:99") ||
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
  );
}

// Due today, plus anything overdue that isn't completed
export function getTodayTasks() {
  const today = todayStr();
  return sortTasks(
    getTasks().filter((t) => t.dueDate && (t.dueDate === today || (t.dueDate < today && !t.completed)))
  );
}

// Incomplete tasks due after today (grouped by date) + tasks with no due date last
export function getUpcomingGroups() {
  const today = todayStr();
  const groups = new Map();

  getTasks()
    .filter((t) => !t.completed && (!t.dueDate || t.dueDate > today))
    .forEach((t) => {
      const key = t.dueDate || "";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(t);
    });

  return [...groups.keys()]
    .sort((a, b) => (a || "9999").localeCompare(b || "9999"))
    .map((date) => ({ date, tasks: sortTasks(groups.get(date)) }));
}

export function getStats() {
  const tasks = getTasks();
  const today = todayStr();
  const completed = tasks.filter((t) => t.completed).length;
  return {
    total: tasks.length,
    completed,
    pending: tasks.length - completed,
    today: tasks.filter((t) => !t.completed && t.dueDate && t.dueDate <= today).length,
  };
}