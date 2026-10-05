import { subscribe, getTasks } from "./state.js";
import {
  addTask, updateTask, toggleTask, toggleSubtask, deleteTask, duplicateTask, restoreTask, getTask,
  getStats, getTodayTasks, getUpcomingGroups, getCategories,
  getProgress, subtasksOf, REPEAT_LABEL, todayStr, tomorrowStr,
} from "./tasks.js";
import { filterTasks } from "./filters.js";
import { confirmAction } from "./dialogs.js";
import { showToast } from "./toast.js";

const $ = (id) => document.getElementById(id);

const PRIORITY_LABEL = { high: "High", medium: "Medium", low: "Low" };
const CATEGORY_DOT = {
  Personal: "dot-personal",
  Projects: "dot-projects",
  Learning: "dot-learning",
  Work: "dot-work",
  Other: "dot-other",
};
// Custom categories get one of the accent colours, chosen from the name
const DOT_PALETTE = ["dot-personal", "dot-projects", "dot-learning", "dot-work"];
const NEW_CATEGORY = "__new__";

// Google Calendar recurrence rules
const CALENDAR_RULES = {
  daily: "FREQ=DAILY",
  weekdays: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
  weekly: "FREQ=WEEKLY",
  monthly: "FREQ=MONTHLY",
};

const ICON_EDIT = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
const ICON_DELETE = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/></svg>';
const ICON_CALENDAR = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M12 13v4M10 15h4"/></svg>';
const ICON_COPY = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>';
const ICON_CHEVRON = '<svg class="icon chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
const ICON_PLUS = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
const ICON_CLOSE = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';

/* ---------- UI state (not saved) ---------- */

const LIST_VIEWS = ["tasks", "today", "upcoming", "completed"];
const VIEW_TITLES = { tasks: "My Tasks", today: "Today", upcoming: "Upcoming", completed: "Completed" };
const EMPTY_TEXT = {
  tasks: ["No tasks yet", "Click Add Task to create your first one."],
  today: ["Nothing due today", "Tasks due today or overdue appear here."],
  upcoming: ["Nothing upcoming", "Incomplete tasks with a future or no due date appear here."],
  completed: ["No completed tasks", "Finished tasks will show up here."],
};

const ui = { view: "overview", category: null, highOnly: false, query: "" };
const expanded = new Set(); // ids of tasks whose subtask list is open

/* ---------- Helpers ---------- */

const pad = (n) => String(n).padStart(2, "0");

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function dotClass(category) {
  if (CATEGORY_DOT[category]) return CATEGORY_DOT[category];
  let hash = 0;
  for (const ch of category) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return DOT_PALETTE[hash % DOT_PALETTE.length];
}

function parseDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatShort(dateStr) {
  return parseDate(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// "15:30" -> "3:30 PM" (or 24h, depending on the device settings)
function formatTime(time) {
  const [h, m] = time.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function isOverdue(task) {
  if (task.completed || !task.dueDate) return false;
  const today = todayStr();
  if (task.dueDate < today) return true;
  if (task.dueDate === today && task.dueTime) {
    const now = new Date();
    return task.dueTime < `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }
  return false;
}

function dueInfo(task) {
  if (!task.dueDate) return { text: "", overdue: false };

  let day = formatShort(task.dueDate);
  if (task.dueDate === todayStr()) day = "Today";
  else if (task.dueDate === tomorrowStr()) day = "Tomorrow";

  const time = task.dueTime ? `, ${formatTime(task.dueTime)}` : "";
  const overdue = isOverdue(task);
  return { text: `${overdue ? "Overdue · " : ""}${day}${time}`, overdue };
}

function groupTitle(dateStr) {
  if (!dateStr) return "No due date";
  if (dateStr === tomorrowStr()) return "Tomorrow";
  return parseDate(dateStr).toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric",
  });
}

const dayStamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const timeStamp = (d) => `${dayStamp(d)}T${pad(d.getHours())}${pad(d.getMinutes())}00`;

// Opens Google Calendar with a prefilled event: timed (1 hour) if the task has a time, else all-day
function openCalendar(task) {
  const startDay = parseDate(task.dueDate);
  let dates;

  if (task.dueTime) {
    const [h, m] = task.dueTime.split(":").map(Number);
    startDay.setHours(h, m, 0, 0);
    const end = new Date(startDay.getTime() + 60 * 60 * 1000);
    dates = `${timeStamp(startDay)}/${timeStamp(end)}`;
  } else {
    const next = new Date(startDay);
    next.setDate(next.getDate() + 1); // all-day events end on the next day
    dates = `${dayStamp(startDay)}/${dayStamp(next)}`;
  }

  const params = new URLSearchParams({ action: "TEMPLATE", text: task.title, dates });
  if (CALENDAR_RULES[task.repeat]) params.set("recur", `RRULE:${CALENDAR_RULES[task.repeat]}`);

  const details = [];
  if (task.description) details.push(task.description);
  const subs = subtasksOf(task);
  if (subs.length) details.push(subs.map((s) => `${s.done ? "[x]" : "[ ]"} ${s.title}`).join("\n"));
  if (details.length) params.set("details", details.join("\n\n"));

  window.open(`https://calendar.google.com/calendar/render?${params}`, "_blank", "noopener");
}

const categoryOption = (c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`;

/* ---------- Undo ---------- */

// A copy of the task and its position, taken before a change, so the change can be undone
function snapshot(id) {
  const index = getTasks().findIndex((t) => t.id === id);
  return index < 0 ? null : { task: structuredClone(getTasks()[index]), index };
}

function offerUndo(message, snap) {
  if (!snap) return;
  showToast(message, {
    actionLabel: "Undo",
    onAction: () => restoreTask(snap.task, snap.index),
  });
}

// Toast after completing/reopening a task (or finishing its last subtask)
function announceToggle(before, id) {
  const after = getTask(id);
  if (!before || !after) return;

  if ((after.completedCount || 0) > (before.task.completedCount || 0)) {
    offerUndo(`Done. Next: ${dueInfo(after).text}`, before); // repeating task moved to its next date
  } else if (after.completed !== before.task.completed) {
    offerUndo(after.completed ? "Task completed" : "Task reopened", before);
  }
}

/* ---------- Rendering ---------- */

// 0-33 red, 34-66 amber, 67-99 blue, 100 green
function progressClass(percent) {
  if (percent >= 100) return "progress-done";
  if (percent >= 67) return "progress-high";
  if (percent >= 34) return "progress-mid";
  return "progress-low";
}

function progressHtml(task) {
  const { done, total, percent } = getProgress(task);
  if (!total) return "";

  const open = expanded.has(task.id);
  const items = subtasksOf(task)
    .map(
      (s) => `
      <li class="subtask${s.done ? " is-done" : ""}">
        <button class="check check-sm${s.done ? " is-checked" : ""}" type="button" role="checkbox"
          aria-checked="${s.done}" data-action="subtask" data-sub-id="${escapeHtml(s.id)}"
          aria-label="${s.done ? "Mark as not done" : "Mark as done"}: ${escapeHtml(s.title)}"></button>
        <span class="subtask-title">${escapeHtml(s.title)}</span>
      </li>`
    )
    .join("");

  return `
    <div class="progress">
      <div class="progress-track" role="progressbar" aria-label="Progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}">
        <div class="progress-fill ${progressClass(percent)}" style="width:${percent}%"></div>
      </div>
      <span class="progress-label">${percent}%</span>
    </div>
    <button class="subtasks-toggle${open ? " is-open" : ""}" type="button" data-action="subtasks" aria-expanded="${open}">
      ${ICON_CHEVRON}${done}/${total} subtasks
    </button>
    <ul class="subtask-list"${open ? "" : " hidden"}>${items}</ul>`;
}

function taskRow(task) {
  const due = dueInfo(task);
  const title = escapeHtml(task.title);
  const desc = task.description ? `<p class="task-desc">${escapeHtml(task.description)}</p>` : "";
  const dueHtml = due.text
    ? `<span class="meta-item${due.overdue ? " is-overdue" : ""}">${due.text}</span>`
    : "";
  const repeatHtml = REPEAT_LABEL[task.repeat]
    ? `<span class="meta-item">↻ ${REPEAT_LABEL[task.repeat]}${task.completedCount ? ` · done ${task.completedCount}×` : ""}</span>`
    : "";
  const calendarBtn = task.dueDate
    ? `<button class="icon-btn" type="button" data-action="calendar" title="Add to Google Calendar" aria-label="Add to Google Calendar: ${title}">${ICON_CALENDAR}</button>`
    : "";

  return `
    <li class="task${task.completed ? " is-done" : ""}" data-id="${escapeHtml(task.id)}">
      <button class="check${task.completed ? " is-checked" : ""}" type="button" role="checkbox"
        aria-checked="${task.completed}" data-action="toggle"
        aria-label="${task.completed ? "Mark as not done" : "Mark as done"}: ${title}"></button>
      <div class="task-body">
        <p class="task-title">${title}</p>
        ${desc}
        <div class="task-meta">
          <span class="badge badge-${task.priority}">${PRIORITY_LABEL[task.priority]}</span>
          <span class="meta-item"><span class="dot ${dotClass(task.category)}"></span>${escapeHtml(task.category)}</span>
          ${dueHtml}
          ${repeatHtml}
        </div>
        ${progressHtml(task)}
      </div>
      <div class="task-actions">
        ${calendarBtn}
        <button class="icon-btn" type="button" data-action="duplicate" title="Duplicate" aria-label="Duplicate task: ${title}">${ICON_COPY}</button>
        <button class="icon-btn" type="button" data-action="edit" aria-label="Edit task: ${title}">${ICON_EDIT}</button>
        <button class="icon-btn" type="button" data-action="delete" aria-label="Delete task: ${title}">${ICON_DELETE}</button>
      </div>
    </li>`;
}

function emptyState(title, text) {
  return `<div class="empty"><p class="empty-title">${title}</p><p class="muted">${text}</p></div>`;
}

// Sidebar category list is generated (built-in + custom categories)
const categoryNav = $("categoryNav");
let categorySignature = "";

function renderCategoryNav(categories) {
  const signature = categories.join("|");
  if (signature === categorySignature) return; // unchanged: keep the buttons (and keyboard focus)
  categorySignature = signature;

  categoryNav.innerHTML =
    '<p class="nav-label">Categories</p>' +
    categories
      .map(
        (c) =>
          `<button class="nav-item" type="button" data-category="${escapeHtml(c)}"><span class="dot ${dotClass(c)}"></span>${escapeHtml(c)}</button>`
      )
      .join("");
}

function renderOverview() {
  const stats = getStats();
  $("statTotal").textContent = stats.total;
  $("statCompleted").textContent = stats.completed;
  $("statPending").textContent = stats.pending;
  $("statToday").textContent = stats.today;

  const today = getTodayTasks();
  $("todayList").innerHTML = today.length
    ? today.map(taskRow).join("")
    : `<li>${emptyState("Nothing due today", "Add a task with today's date to see it here.")}</li>`;

  const groups = getUpcomingGroups();
  $("upcomingList").innerHTML = groups.length
    ? groups
        .map(
          (g) => `
        <div class="task-group">
          <p class="group-title">${groupTitle(g.date)}</p>
          <ul class="task-list">${g.tasks.map(taskRow).join("")}</ul>
        </div>`
        )
        .join("")
    : emptyState("Nothing scheduled yet", "Tasks with a future or no due date will appear here.");
}

function renderList(categories) {
  const tasks = filterTasks(getTasks(), ui);
  const query = ui.query.trim();

  let title = VIEW_TITLES[ui.view];
  if (ui.view === "tasks" && ui.category) title = ui.category;
  if (query) title = `Results for "${query}"`;
  $("listTitle").textContent = title;
  $("listCount").textContent = `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`;

  document.querySelectorAll("[data-filter]").forEach((chip) => {
    const on = chip.dataset.filter === ui.view;
    chip.classList.toggle("is-active", on);
    chip.setAttribute("aria-pressed", String(on));
  });
  $("chipHigh").classList.toggle("is-active", ui.highOnly);
  $("chipHigh").setAttribute("aria-pressed", String(ui.highOnly));

  $("categoryFilter").innerHTML =
    `<option value="">All categories</option>${categories.map(categoryOption).join("")}`;
  $("categoryFilter").value = ui.category || "";

  if (tasks.length) {
    $("taskList").innerHTML = tasks.map(taskRow).join("");
  } else {
    const filtered = query || ui.category || ui.highOnly;
    const [t, msg] = filtered
      ? ["No matching tasks", "Try a different search or filter."]
      : EMPTY_TEXT[ui.view];
    $("taskList").innerHTML = `<li>${emptyState(t, msg)}</li>`;
  }
}

function syncNav() {
  document.querySelectorAll(".nav-item[data-view], .bn-item[data-view]").forEach((el) => {
    const on = el.dataset.view === ui.view && !(ui.view === "tasks" && ui.category);
    el.classList.toggle("is-active", on);
    if (on) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  });
  document.querySelectorAll(".nav-item[data-category]").forEach((el) => {
    el.classList.toggle("is-active", ui.view === "tasks" && ui.category === el.dataset.category);
  });
}

// Only the visible view is rendered
function render() {
  const categories = getCategories();
  if (ui.category && !categories.includes(ui.category)) ui.category = null; // category no longer exists
  renderCategoryNav(categories);

  const isList = LIST_VIEWS.includes(ui.view);
  $("viewOverview").hidden = ui.view !== "overview";
  $("viewList").hidden = !isList;
  $("viewSettings").hidden = ui.view !== "settings";
  syncNav();

  if (ui.view === "overview") renderOverview();
  else if (isList) renderList(categories);
}

/* ---------- Navigation ---------- */

function go(view, category = null) {
  ui.view = view;
  ui.category = category;
  ui.highOnly = false;
  if (view === "overview" || view === "settings") {
    ui.query = "";
    $("searchInput").value = "";
  }
  render();
  window.scrollTo({ top: 0 });
}

function onNavClick(e) {
  const el = e.target.closest("[data-view], [data-category]");
  if (!el) return;
  if (el.dataset.category) go("tasks", el.dataset.category);
  else go(el.dataset.view);
}

/* ---------- Task dialog ---------- */

const dialog = $("taskDialog");
const form = $("taskForm");
let editingId = null;

// Adds the "new category name" input under the category dropdown
function setupNewCategoryField() {
  $("fieldCategory").insertAdjacentHTML(
    "afterend",
    '<input class="input" id="fieldNewCategory" type="text" maxlength="30" placeholder="New category name" autocomplete="off" hidden />' +
      '<p class="field-error" id="categoryError" hidden>Enter a category name.</p>'
  );
  $("fieldCategory").addEventListener("change", () => {
    const isNew = $("fieldCategory").value === NEW_CATEGORY;
    $("fieldNewCategory").hidden = !isNew;
    if (!isNew) $("categoryError").hidden = true;
    else $("fieldNewCategory").focus();
  });
}

// Adds the "Repeat" dropdown under the date and time fields
function setupRepeatField() {
  const options =
    '<option value="">Does not repeat</option>' +
    Object.entries(REPEAT_LABEL)
      .map(([value, label]) => `<option value="${value}">${label}</option>`)
      .join("");

  $("fieldDueDate")
    .closest(".field-row")
    .insertAdjacentHTML(
      "afterend",
      '<div class="field">' +
        '<label for="fieldRepeat">Repeat</label>' +
        `<select class="input" id="fieldRepeat" disabled>${options}</select>` +
        '<p class="muted">Needs a due date. When you complete the task, the next one is scheduled automatically.</p>' +
        "</div>"
    );
}

/* ----- Subtask inputs (one box per subtask) ----- */

// "-> Task 1", "- Task 1", "* Task 1" -> "Task 1"
const cleanLine = (line) => line.replace(/^\s*(?:->|=>|[-*•→])\s*/, "").trim();

// A row keeps the id of an existing subtask, so renaming it keeps its tick
function addSubtaskRow({ title = "", id = "", focus = false, after = null } = {}) {
  const row = document.createElement("div");
  row.className = "subtask-input-row";
  row.dataset.id = id;
  row.innerHTML =
    '<input class="input" type="text" maxlength="200" placeholder="Subtask" autocomplete="off" aria-label="Subtask" />' +
    `<button class="icon-btn" type="button" data-remove aria-label="Remove subtask">${ICON_CLOSE}</button>`;
  row.querySelector("input").value = title; // set as a property: no HTML escaping needed

  if (after) after.after(row);
  else $("subtaskInputs").appendChild(row);
  if (focus) row.querySelector("input").focus();
  return row;
}

function readSubtaskRows() {
  return [...$("subtaskInputs").querySelectorAll(".subtask-input-row")].map((row) => ({
    id: row.dataset.id,
    title: row.querySelector("input").value,
  }));
}

function setSubtaskRows(subtasks) {
  $("subtaskInputs").innerHTML = "";
  if (subtasks.length) subtasks.forEach((s) => addSubtaskRow({ title: s.title, id: s.id }));
  else addSubtaskRow(); // always start with one box
}

// Adds the "Subtasks" section (boxes + add button) under the description
function setupSubtasksField() {
  $("fieldDescription")
    .closest(".field")
    .insertAdjacentHTML(
      "afterend",
      '<div class="field" role="group" aria-labelledby="subtasksLabel">' +
        '<span class="field-label" id="subtasksLabel">Subtasks</span>' +
        '<div class="subtask-inputs" id="subtaskInputs"></div>' +
        `<button class="btn btn-ghost btn-sm" id="addSubtaskBtn" type="button">${ICON_PLUS} Add subtask</button>` +
        '<p class="muted">Progress is calculated from the ticked subtasks.</p>' +
        "</div>"
    );

  const box = $("subtaskInputs");

  $("addSubtaskBtn").addEventListener("click", () => addSubtaskRow({ focus: true }));

  // Remove button
  box.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-remove]");
    if (!btn) return;
    const row = btn.closest(".subtask-input-row");
    const neighbour = row.nextElementSibling || row.previousElementSibling;
    row.remove();
    if (!box.children.length) addSubtaskRow({ focus: true });
    else if (neighbour) neighbour.querySelector("input").focus();
  });

  // Enter adds a new box below (and does not submit the form)
  box.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !e.target.matches("input")) return;
    e.preventDefault();
    addSubtaskRow({ focus: true, after: e.target.closest(".subtask-input-row") });
  });

  // Pasting several lines creates one box per line
  box.addEventListener("paste", (e) => {
    const input = e.target;
    const text = (e.clipboardData || window.clipboardData).getData("text");
    if (!input.matches("input") || !/\r?\n/.test(text)) return;

    const lines = text.split(/\r?\n/).map(cleanLine).filter(Boolean);
    if (!lines.length) return;
    e.preventDefault();

    let row = input.closest(".subtask-input-row");
    let rest = lines;
    if (!input.value.trim()) {
      input.value = lines[0];
      rest = lines.slice(1);
    }
    rest.forEach((title) => {
      row = addSubtaskRow({ title, after: row });
    });
  });
}

// Time and repeat only work together with a date
function syncDateFields() {
  const hasDate = Boolean($("fieldDueDate").value);
  $("fieldDueTime").disabled = !hasDate;
  $("fieldRepeat").disabled = !hasDate;
  if (!hasDate) {
    $("fieldDueTime").value = "";
    $("fieldRepeat").value = "";
  }
}

function openDialog(task = null) {
  editingId = task ? task.id : null;
  $("dialogTitle").textContent = task ? "Edit Task" : "New Task";
  $("saveTaskBtn").textContent = task ? "Save Changes" : "Create Task";
  $("titleError").hidden = true;

  const categories = getCategories();
  $("fieldCategory").innerHTML =
    categories.map(categoryOption).join("") + `<option value="${NEW_CATEGORY}">+ New category…</option>`;
  $("fieldNewCategory").value = "";
  $("fieldNewCategory").hidden = true;
  $("categoryError").hidden = true;

  // New tasks start in the category you are currently viewing (if any)
  const defaultCategory = ui.category && categories.includes(ui.category) ? ui.category : "Personal";

  $("fieldTitle").value = task ? task.title : "";
  $("fieldDescription").value = task ? task.description : "";
  setSubtaskRows(task ? subtasksOf(task) : []);
  $("fieldPriority").value = task ? task.priority : "medium";
  $("fieldCategory").value = task ? task.category : defaultCategory;
  $("fieldDueDate").value = task ? task.dueDate : "";
  $("fieldDueTime").value = task ? task.dueTime || "" : "";
  $("fieldRepeat").value = task ? task.repeat || "" : "";
  syncDateFields();

  dialog.showModal();
  $("fieldTitle").focus();
}

function onSubmit(e) {
  e.preventDefault();
  const title = $("fieldTitle").value.trim();
  if (!title) {
    $("titleError").hidden = false;
    $("fieldTitle").focus();
    return;
  }

  let category = $("fieldCategory").value;
  if (category === NEW_CATEGORY) {
    category = $("fieldNewCategory").value.trim();
    if (!category) {
      $("categoryError").hidden = false;
      $("fieldNewCategory").focus();
      return;
    }
  }

  const fields = {
    title,
    description: $("fieldDescription").value,
    subtasks: readSubtaskRows(), // empty boxes are ignored
    priority: $("fieldPriority").value,
    category,
    dueDate: $("fieldDueDate").value,
    dueTime: $("fieldDueTime").value,
    repeat: $("fieldRepeat").value,
  };

  if (editingId) updateTask(editingId, fields);
  else addTask(fields);
  dialog.close();
}

/* ---------- Task row actions ---------- */

// After a re-render, put keyboard focus back on the same control
function refocus(taskId, selector) {
  const row = document.querySelector(`.task[data-id="${CSS.escape(taskId)}"]`);
  const el = row && row.querySelector(selector);
  if (el) el.focus();
}

async function onListClick(e) {
  const btn = e.target.closest("[data-action]");
  const row = btn && btn.closest(".task");
  if (!row) return;
  const id = row.dataset.id;
  const action = btn.dataset.action;

  if (action === "toggle") {
    if (row.dataset.busy) return;
    row.dataset.busy = "1";
    const before = snapshot(id);
    // Show the transition first, then save, re-render and offer Undo
    row.classList.toggle("is-done");
    btn.classList.toggle("is-checked");
    setTimeout(() => {
      toggleTask(id);
      announceToggle(before, id);
    }, 180);
  } else if (action === "subtask") {
    const subId = btn.dataset.subId;
    const before = snapshot(id);
    toggleSubtask(id, subId);
    announceToggle(before, id); // only speaks up if the task just got completed
    refocus(id, `[data-sub-id="${CSS.escape(subId)}"]`);
  } else if (action === "subtasks") {
    if (expanded.has(id)) expanded.delete(id);
    else expanded.add(id);
    render();
    refocus(id, '[data-action="subtasks"]');
  } else if (action === "edit") {
    openDialog(getTask(id));
  } else if (action === "duplicate") {
    const newId = duplicateTask(id);
    if (newId) {
      showToast("Task duplicated", { actionLabel: "Undo", onAction: () => deleteTask(newId) });
    }
  } else if (action === "calendar") {
    const task = getTask(id);
    if (task && task.dueDate) openCalendar(task);
  } else if (action === "delete") {
    const task = getTask(id);
    if (!task) return;
    const ok = await confirmAction({
      title: "Delete task?",
      text: `"${task.title}" will be deleted. If Google Drive sync is on, the deletion will sync too.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    const snap = snapshot(id);
    deleteTask(id);
    offerUndo("Task deleted", snap);
  }
}

/* ---------- Init ---------- */

export function initUI() {
  setupNewCategoryField();
  setupSubtasksField();
  setupRepeatField();
  $("fieldDueDate").addEventListener("input", syncDateFields);

  // Navigation (sidebar, bottom nav, settings icon)
  document.addEventListener("click", onNavClick);

  // Search: typing from Overview/Settings jumps to the task list
  $("searchInput").addEventListener("input", (e) => {
    ui.query = e.target.value;
    if (ui.query.trim() && !LIST_VIEWS.includes(ui.view)) ui.view = "tasks";
    render();
  });

  // Filters
  $("filterBar").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    if (chip.dataset.toggle === "high") ui.highOnly = !ui.highOnly;
    else ui.view = chip.dataset.filter;
    render();
  });
  $("categoryFilter").addEventListener("change", (e) => {
    ui.category = e.target.value || null;
    render();
  });

  // Add / edit dialog
  $("addTaskBtn").addEventListener("click", () => openDialog());
  $("addTaskFab").addEventListener("click", () => openDialog());
  $("cancelTaskBtn").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close(); // click on backdrop
  });
  form.addEventListener("submit", onSubmit);

  // Task row actions
  $("todayList").addEventListener("click", onListClick);
  $("upcomingList").addEventListener("click", onListClick);
  $("taskList").addEventListener("click", onListClick);

  subscribe(render);
  render();
}