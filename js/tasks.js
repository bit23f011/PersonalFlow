import { getTasks, commitTasks } from "./state.js";
import { normalizeHex } from "./colors.js";

export const PRIORITIES = ["high", "medium", "low"];
export const BUILTIN_CATEGORIES = ["Personal", "Projects", "Learning", "Work", "Other"];
export const REPEAT_LABEL = { daily: "Daily", weekdays: "Weekdays", weekly: "Weekly", monthly: "Monthly" };
const REPEATS = Object.keys(REPEAT_LABEL);
const MAX_CATEGORY_LENGTH = 30;
const MAX_SUBTASKS = 100;
const MAX_SUBTASK_LENGTH = 200;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

/* ---------- Dates (local time, "YYYY-MM-DD") ---------- */

const pad = (n) => String(n).padStart(2, "0");

function toDateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseLocal(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
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

/* ---------- Subtasks ---------- */

// Older tasks have no subtasks field
export const subtasksOf = (task) => (Array.isArray(task.subtasks) ? task.subtasks : []);

export function getProgress(task) {
  const subs = subtasksOf(task);
  const done = subs.filter((s) => s.done).length;
  return {
    done,
    total: subs.length,
    percent: subs.length ? Math.round((done / subs.length) * 100) : 0,
  };
}

/* ---------- Repeating tasks ---------- */

function addInterval(dateStr, repeat) {
  const d = parseLocal(dateStr);
  if (repeat === "daily") {
    d.setDate(d.getDate() + 1);
  } else if (repeat === "weekdays") {
    do {
      d.setDate(d.getDate() + 1);
    } while (d.getDay() === 0 || d.getDay() === 6); // skip Saturday and Sunday
  } else if (repeat === "weekly") {
    d.setDate(d.getDate() + 7);
  } else if (repeat === "monthly") {
    const day = d.getDate();
    d.setMonth(d.getMonth() + 1);
    if (d.getDate() !== day) d.setDate(0); // e.g. Jan 31 -> Feb 28
  }
  return toDateStr(d);
}

// The next due date that is still after today
function nextOccurrence(dueDate, repeat) {
  const today = todayStr();
  let next = addInterval(dueDate, repeat);
  for (let i = 0; i < 1000 && next <= today; i++) next = addInterval(next, repeat);
  return next;
}

// A finished repeating task goes back to "to do" on its next date, with fresh subtasks
function reschedule(task) {
  return {
    ...task,
    dueDate: nextOccurrence(task.dueDate, task.repeat),
    subtasks: subtasksOf(task).map((s) => ({ ...s, done: false })),
    completed: false,
    completedCount: (task.completedCount || 0) + 1,
  };
}

function settle(task) {
  return task.repeat && task.dueDate && task.completed ? reschedule(task) : task;
}

/* ---------- CRUD ---------- */

function randomId(prefix) {
  const unique = crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}-${unique}`;
}

// Rows from the task form: [{ id, title }]. Known ids keep their ticked state
// (so renaming a subtask keeps its tick), new rows get a new id and start unticked.
function buildSubtasks(rows, existing) {
  const doneById = new Map(existing.map((s) => [s.id, s.done]));
  const used = new Set();

  return (Array.isArray(rows) ? rows : [])
    .map((r) => ({
      id: r && r.id,
      title: String((r && r.title) || "").trim().slice(0, MAX_SUBTASK_LENGTH),
    }))
    .filter((r) => r.title)
    .slice(0, MAX_SUBTASKS)
    .map((r) => {
      const known = Boolean(r.id) && doneById.has(r.id) && !used.has(r.id);
      const id = known ? r.id : randomId("sub");
      used.add(id);
      return { id, title: r.title, done: known ? doneById.get(id) : false };
    });
}

function normalize(fields) {
  const dueDate = fields.dueDate || "";
  return {
    title: (fields.title || "").trim(),
    description: (fields.description || "").trim(),
    priority: PRIORITIES.includes(fields.priority) ? fields.priority : "medium",
    category: resolveCategory(fields.category),
    color: normalizeHex(fields.color),
    dueDate,
    // A time and a repeat only make sense together with a date
    dueTime: dueDate && TIME_RE.test(fields.dueTime || "") ? fields.dueTime : "",
    repeat: dueDate && REPEATS.includes(fields.repeat) ? fields.repeat : "",
  };
}

export function getTask(id) {
  return getTasks().find((t) => t.id === id);
}

export function addTask(fields) {
  const now = new Date().toISOString();
  const task = {
    id: randomId("task"),
    ...normalize(fields),
    subtasks: buildSubtasks(fields.subtasks, []),
    starred: false,
    completed: false,
    completedCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  commitTasks([...getTasks(), task]);
}

export function updateTask(id, fields) {
  const now = new Date().toISOString();
  commitTasks(
    getTasks().map((t) => {
      if (t.id !== id) return t;

      const subtasks =
        fields.subtasks === undefined ? subtasksOf(t) : buildSubtasks(fields.subtasks, subtasksOf(t));
      // With subtasks, the task is complete exactly when all of them are ticked
      const completed = subtasks.length ? subtasks.every((s) => s.done) : t.completed;

      return settle({ ...t, ...normalize(fields), subtasks, completed, updatedAt: now });
    })
  );
}

// Completing (or reopening) a task ticks (or unticks) all of its subtasks.
// A repeating task moves to its next date instead of staying completed. Returns the updated task.
export function toggleTask(id) {
  const now = new Date().toISOString();
  let result = null;

  commitTasks(
    getTasks().map((t) => {
      if (t.id !== id) return t;
      const completed = !t.completed;
      const subtasks = subtasksOf(t).map((s) => ({ ...s, done: completed }));
      result = settle({ ...t, completed, subtasks, updatedAt: now });
      return result;
    })
  );
  return result;
}

export function toggleSubtask(taskId, subtaskId) {
  const now = new Date().toISOString();
  commitTasks(
    getTasks().map((t) => {
      if (t.id !== taskId) return t;
      const subtasks = subtasksOf(t).map((s) => (s.id === subtaskId ? { ...s, done: !s.done } : s));
      const completed = subtasks.length > 0 && subtasks.every((s) => s.done);
      return settle({ ...t, subtasks, completed, updatedAt: now });
    })
  );
}

export function toggleStar(id) {
  const now = new Date().toISOString();
  commitTasks(getTasks().map((t) => (t.id === id ? { ...t, starred: !t.starred, updatedAt: now } : t)));
}

export function deleteTask(id) {
  commitTasks(getTasks().filter((t) => t.id !== id));
}

// Copy of a task: same details (and colour), subtasks unticked, " (copy)" added to the title.
// Returns the new id.
export function duplicateTask(id) {
  const source = getTask(id);
  if (!source) return null;

  const now = new Date().toISOString();
  const copy = {
    ...source,
    id: randomId("task"),
    title: `${source.title} (copy)`.slice(0, 200),
    subtasks: subtasksOf(source).map((s) => ({ id: randomId("sub"), title: s.title, done: false })),
    starred: false,
    completed: false,
    completedCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  commitTasks([...getTasks(), copy]);
  return copy.id;
}

/* ---------- Bulk changes (one save for many tasks) ---------- */

function changeMany(ids, change) {
  const set = new Set(ids);
  const now = new Date().toISOString();
  commitTasks(getTasks().map((t) => (set.has(t.id) ? change(t, now) : t)));
}

export function completeTasks(ids) {
  changeMany(ids, (t, now) =>
    t.completed
      ? t
      : settle({ ...t, completed: true, subtasks: subtasksOf(t).map((s) => ({ ...s, done: true })), updatedAt: now })
  );
}

export function starTasks(ids, value) {
  changeMany(ids, (t, now) => ({ ...t, starred: value, updatedAt: now }));
}

export function moveToCategory(ids, category) {
  const name = resolveCategory(category);
  changeMany(ids, (t, now) => ({ ...t, category: name, updatedAt: now }));
}

export function deleteTasks(ids) {
  const set = new Set(ids);
  commitTasks(getTasks().filter((t) => !set.has(t.id)));
}

/* ---------- Undo ---------- */

// Puts tasks back exactly as they were: [{ task, index }]. Deleted ones are re-inserted.
export function restoreTasks(snaps) {
  const tasks = [...getTasks()];
  [...snaps]
    .sort((a, b) => a.index - b.index)
    .forEach(({ task, index }) => {
      const i = tasks.findIndex((t) => t.id === task.id);
      if (i >= 0) tasks[i] = task;
      else tasks.splice(Math.min(index, tasks.length), 0, task);
    });
  commitTasks(tasks);
}

export function restoreTask(snapshot, index) {
  restoreTasks([{ task: snapshot, index }]);
}

/* ---------- Queries ---------- */

// Not done first, starred first, then by date, then by time (untimed last), then by priority
function sortTasks(list) {
  return [...list].sort(
    (a, b) =>
      Number(a.completed) - Number(b.completed) ||
      Number(Boolean(b.starred)) - Number(Boolean(a.starred)) ||
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