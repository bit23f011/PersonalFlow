import { subscribe, getTasks } from "./state.js";
import {
  addTask, updateTask, toggleTask, deleteTask, getTask,
  getStats, getTodayTasks, getUpcomingGroups, getCategories,
  todayStr, tomorrowStr,
} from "./tasks.js";
import { filterTasks } from "./filters.js";
import { confirmAction } from "./dialogs.js";

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

const ICON_EDIT = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
const ICON_DELETE = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/></svg>';
const ICON_CALENDAR = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M12 13v4M10 15h4"/></svg>';

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
  if (task.description) params.set("details", task.description);

  window.open(`https://calendar.google.com/calendar/render?${params}`, "_blank", "noopener");
}

const categoryOption = (c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`;

/* ---------- Rendering ---------- */

function taskRow(task) {
  const due = dueInfo(task);
  const title = escapeHtml(task.title);
  const desc = task.description ? `<p class="task-desc">${escapeHtml(task.description)}</p>` : "";
  const dueHtml = due.text
    ? `<span class="meta-item${due.overdue ? " is-overdue" : ""}">${due.text}</span>`
    : "";
  const calendarBtn = task.dueDate
    ? `<button class="icon-btn" type="button" data-action="calendar" title="Add to Google Calendar" aria-label="Add to Google Calendar: ${title}">${ICON_CALENDAR}</button>`
    : "";

  return `
    <li class="task${task.completed ? " is-done" : ""}" data-id="${task.id}">
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
        </div>
      </div>
      <div class="task-actions">
        ${calendarBtn}
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

// The time field only works together with a date
function syncTimeField() {
  const hasDate = Boolean($("fieldDueDate").value);
  $("fieldDueTime").disabled = !hasDate;
  if (!hasDate) $("fieldDueTime").value = "";
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
  $("fieldPriority").value = task ? task.priority : "medium";
  $("fieldCategory").value = task ? task.category : defaultCategory;
  $("fieldDueDate").value = task ? task.dueDate : "";
  $("fieldDueTime").value = task ? task.dueTime || "" : "";
  syncTimeField();

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
    priority: $("fieldPriority").value,
    category,
    dueDate: $("fieldDueDate").value,
    dueTime: $("fieldDueTime").value,
  };

  if (editingId) updateTask(editingId, fields);
  else addTask(fields);
  dialog.close();
}

/* ---------- Task row actions ---------- */

async function onListClick(e) {
  const btn = e.target.closest("[data-action]");
  const row = btn && btn.closest(".task");
  if (!row) return;
  const id = row.dataset.id;

  if (btn.dataset.action === "toggle") {
    if (row.dataset.busy) return;
    row.dataset.busy = "1";
    // Show the transition first, then save and re-render
    row.classList.toggle("is-done");
    btn.classList.toggle("is-checked");
    setTimeout(() => toggleTask(id), 180);
  } else if (btn.dataset.action === "edit") {
    openDialog(getTask(id));
  } else if (btn.dataset.action === "calendar") {
    const task = getTask(id);
    if (task && task.dueDate) openCalendar(task);
  } else if (btn.dataset.action === "delete") {
    const task = getTask(id);
    if (!task) return;
    const ok = await confirmAction({
      title: "Delete task?",
      text: `"${task.title}" will be deleted. This can't be undone. If Google Drive sync is on, the deletion will sync too.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (ok) deleteTask(id);
  }
}

/* ---------- Init ---------- */

export function initUI() {
  setupNewCategoryField();
  $("fieldDueDate").addEventListener("input", syncTimeField);

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