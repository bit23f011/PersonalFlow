import { getTasks, commitTasks } from "./state.js";
import { normalizeHex } from "./colors.js";

export const PRIORITIES = ["high", "medium", "low"];
export const BUILTIN_CATEGORIES = ["Personal", "Projects", "Learning", "Work", "Other"];
export const REPEAT_LABEL = { daily: "Daily", weekdays: "Weekdays", weekly: "Weekly", monthly: "Monthly" };
const REPEATS = Object.keys(REPEAT_LABEL);
const MAX_CATEGORY_LENGTH = 30;
const MAX_SUBTASKS = 100; // subtasks and sub-subtasks together
const MAX_SUBTASK_LENGTH = 200;
const MAX_LINKS = 10;
const MAX_DONE_DATES = 200;
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

/* ---------- Links ---------- */

// Lines or an array -> valid http(s) links ("figma.com/x" becomes "https://figma.com/x")
function cleanLinks(value) {
  const lines = Array.isArray(value) ? value : String(value || "").split(/\r?\n/);
  const result = [];

  for (const line of lines) {
    let text = String(line || "").trim();
    if (!text) continue;
    if (!/^https?:\/\//i.test(text)) text = `https://${text}`;
    try {
      const url = new URL(text);
      const host = url.hostname;
      const looksReal = host === "localhost" || host.includes(".");
      if (["http:", "https:"].includes(url.protocol) && looksReal && url.href.length <= 500 && !result.includes(url.href)) {
        result.push(url.href);
      }
    } catch {
      // not a link: ignored
    }
    if (result.length >= MAX_LINKS) break;
  }
  return result;
}

/* ---------- Subtasks (a subtask can have its own sub-subtasks) ---------- */

// Older tasks have no subtasks field
export const subtasksOf = (task) => (Array.isArray(task.subtasks) ? task.subtasks : []);
export const subtaskChildren = (s) => (Array.isArray(s.children) ? s.children : []);

// A subtask with sub-subtasks is done when all of them are done
const isDone = (s) => {
  const kids = subtaskChildren(s);
  return kids.length ? kids.every((c) => c.done) : s.done === true;
};

// Share of one subtask between 0 and 1: its sub-subtasks, or 0/1 if it has none
function subtaskRatio(s) {
  const kids = subtaskChildren(s);
  if (!kids.length) return s.done ? 1 : 0;
  return kids.filter((c) => c.done).length / kids.length;
}

export const subtaskPercent = (s) => Math.round(subtaskRatio(s) * 100);

// Task progress = average of its subtasks' shares
export function getProgress(task) {
  const subs = subtasksOf(task);
  const total = subs.length;
  const sum = subs.reduce((acc, s) => acc + subtaskRatio(s), 0);
  return {
    done: subs.filter(isDone).length,
    total,
    percent: total ? Math.round((sum / total) * 100) : 0,
  };
}

// Ticks or unticks every subtask and sub-subtask
function setAllDone(subs, value) {
  return subs.map((s) => {
    const next = { ...s, done: value };
    if (subtaskChildren(s).length) next.children = subtaskChildren(s).map((c) => ({ ...c, done: value }));
    return next;
  });
}

// Toggles one subtask or sub-subtask (found by id) and keeps parents in step
function toggleInTree(subs, id) {
  return subs.map((s) => {
    if (s.id === id) {
      const value = !isDone(s);
      const next = { ...s, done: value };
      if (subtaskChildren(s).length) next.children = subtaskChildren(s).map((c) => ({ ...c, done: value }));
      return next;
    }
    const kids = subtaskChildren(s);
    if (kids.some((c) => c.id === id)) {
      const children = kids.map((c) => (c.id === id ? { ...c, done: !c.done } : c));
      return { ...s, children, done: children.every((c) => c.done) };
    }
    return s;
  });
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

// A finished repeating task goes back to "to do" on its next date, with fresh subtasks.
// Today is added to its history of finished days (used for streaks and stats).
function reschedule(task) {
  const history = Array.isArray(task.doneDates) ? task.doneDates : [];
  return {
    ...task,
    dueDate: nextOccurrence(task.dueDate, task.repeat),
    subtasks: setAllDone(subtasksOf(task), false),
    completed: false,
    completedAt: "",
    doneDates: [...history, todayStr()].slice(-MAX_DONE_DATES),
    completedCount: (task.completedCount || 0) + 1,
  };
}

function settle(task) {
  return task.repeat && task.dueDate && task.completed ? reschedule(task) : task;
}

// After any change: remember when a task was finished (or forget it when reopened),
// then move repeating tasks on to their next date
function finalize(prev, next, now) {
  let task = next;
  if (task.completed && !prev.completed) task = { ...task, completedAt: now };
  else if (!task.completed && prev.completed) task = { ...task, completedAt: "" };
  return settle(task);
}

/* ---------- CRUD ---------- */

function randomId(prefix) {
  const unique = crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}-${unique}`;
}

// Rows from the task form: [{ id, title, children: [{ id, title }] }]. Known ids keep their
// ticked state (so renaming keeps the tick), new rows get a new id and start unticked.
function buildSubtasks(rows, existing) {
  const doneById = new Map();
  existing.forEach((s) => {
    doneById.set(s.id, s.done);
    subtaskChildren(s).forEach((c) => doneById.set(c.id, c.done));
  });
  const used = new Set();
  let count = 0;

  const make = (row) => {
    const title = String((row && row.title) || "").trim().slice(0, MAX_SUBTASK_LENGTH);
    if (!title || count >= MAX_SUBTASKS) return null;
    const known = Boolean(row.id) && doneById.has(row.id) && !used.has(row.id);
    const id = known ? row.id : randomId("sub");
    used.add(id);
    count += 1;
    return { id, title, done: known ? doneById.get(id) : false };
  };

  const result = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const children = [];
    for (const childRow of Array.isArray(row && row.children) ? row.children : []) {
      const child = make(childRow);
      if (child) children.push(child);
    }

    const item = make(row);
    if (!item) {
      result.push(...children); // a sub-subtask whose parent has no title becomes a subtask
      continue;
    }
    if (children.length) {
      item.children = children;
      item.done = children.every((c) => c.done);
    }
    result.push(item);
  }
  return result;
}

function normalize(fields) {
  const dueDate = fields.dueDate || "";
  return {
    title: (fields.title || "").trim(),
    description: (fields.description || "").trim(),
    priority: PRIORITIES.includes(fields.priority) ? fields.priority : "medium",
    category: resolveCategory(fields.category),
    color: normalizeHex(fields.color),
    links: cleanLinks(fields.links),
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
    completedAt: "",
    completedCount: 0,
    doneDates: [],
    focusMinutes: 0,
    focusDate: "",
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
      // With subtasks, the task is complete exactly when all of them are done
      const completed = subtasks.length ? subtasks.every(isDone) : t.completed;

      return finalize(t, { ...t, ...normalize(fields), subtasks, completed, updatedAt: now }, now);
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
      result = finalize(t, { ...t, completed, subtasks: setAllDone(subtasksOf(t), completed), updatedAt: now }, now);
      return result;
    })
  );
  return result;
}

// Works for subtasks and sub-subtasks
export function toggleSubtask(taskId, subtaskId) {
  const now = new Date().toISOString();
  commitTasks(
    getTasks().map((t) => {
      if (t.id !== taskId) return t;
      const subtasks = toggleInTree(subtasksOf(t), subtaskId);
      const completed = subtasks.length > 0 && subtasks.every(isDone);
      return finalize(t, { ...t, subtasks, completed, updatedAt: now }, now);
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

// Copy of a task: same details (colour, links), subtasks unticked, " (copy)" added to the title.
// History and tracked time start again. Returns the new id.
export function duplicateTask(id) {
  const source = getTask(id);
  if (!source) return null;

  const now = new Date().toISOString();
  const copy = {
    ...source,
    id: randomId("task"),
    title: `${source.title} (copy)`.slice(0, 200),
    subtasks: subtasksOf(source).map((s) => {
      const item = { id: randomId("sub"), title: s.title, done: false };
      const kids = subtaskChildren(s);
      if (kids.length) item.children = kids.map((c) => ({ id: randomId("sub"), title: c.title, done: false }));
      return item;
    }),
    starred: false,
    completed: false,
    completedAt: "",
    completedCount: 0,
    doneDates: [],
    focusMinutes: 0,
    focusDate: "",
    createdAt: now,
    updatedAt: now,
  };
  commitTasks([...getTasks(), copy]);
  return copy.id;
}

/* ---------- Time tracking and "today's focus" ---------- */

// Adds focus minutes (from the Focus timer) to a task
export function addFocusTime(id, minutes) {
  const add = Math.round(Number(minutes));
  if (!Number.isFinite(add) || add <= 0 || !getTask(id)) return;
  const now = new Date().toISOString();
  commitTasks(
    getTasks().map((t) => (t.id === id ? { ...t, focusMinutes: (t.focusMinutes || 0) + add, updatedAt: now } : t))
  );
}

// Marks exactly these tasks as today's focus (the others lose the mark)
export function setFocusToday(ids) {
  const set = new Set(ids);
  const today = todayStr();
  const now = new Date().toISOString();
  commitTasks(
    getTasks().map((t) => {
      const on = set.has(t.id);
      if (on && t.focusDate !== today) return { ...t, focusDate: today, updatedAt: now };
      if (!on && t.focusDate === today) return { ...t, focusDate: "", updatedAt: now };
      return t;
    })
  );
}

// Tasks picked as today's focus (finished ones included, so progress stays visible)
export function getFocusTasks() {
  const today = todayStr();
  return getTasks().filter((t) => t.focusDate === today);
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
      : finalize(t, { ...t, completed: true, subtasks: setAllDone(subtasksOf(t), true), updatedAt: now }, now)
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