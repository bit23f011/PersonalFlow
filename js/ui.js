import { subscribe, getTasks } from "./state.js";
import {
  addTask, updateTask, toggleTask, deleteTask, getTask,
  getStats, getTodayTasks, getUpcomingGroups,
  todayStr, tomorrowStr, CATEGORIES,
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

function parseDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatShort(dateStr) {
  return parseDate(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function dueInfo(task) {
  if (!task.dueDate) return { text: "", overdue: false };
  if (task.dueDate === todayStr()) return { text: "Today", overdue: false };
  if (task.dueDate === tomorrowStr()) return { text: "Tomorrow", overdue: false };
  if (task.dueDate < todayStr() && !task.completed) {
    return { text: `Overdue · ${formatShort(task.dueDate)}`, overdue: true };
  }
  return { text: formatShort(task.dueDate), overdue: false };
}

function groupTitle(dateStr) {
  if (!dateStr) return "No due date";
  if (dateStr === tomorrowStr()) return "Tomorrow";
  return parseDate(dateStr).toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric",
  });
}

// Opens Google Calendar with a prefilled all-day event for the task's due date
function openCalendar(task) {
  const start = task.dueDate.replace(/-/g, "");
  const next = parseDate(task.dueDate);
  next.setDate(next.getDate() + 1); // all-day events end on the next day
  const end = `${next.getFullYear()}${pad(next.getMonth() + 1)}${pad(next.getDate())}`;

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: task.title,
    dates: `${start}/${end}`,
  });
  if (task.description) params.set("details", task.description);

  window.open(`https://calendar.google.com/calendar/render?${params}`, "_blank", "noopener");
}

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
          <span class="meta-item"><span class="dot ${CATEGORY_DOT[task.category] || "dot-other"}"></span>${escapeHtml(task.category)}</span>
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

function renderList() {
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
  const isList = LIST_VIEWS.includes(ui.view);
  $("viewOverview").hidden = ui.view !== "overview";
  $("viewList").hidden = !isList;
  $("viewSettings").hidden = ui.view !== "settings";
  syncNav();

  if (ui.view === "overview") renderOverview();
  else if (isList) renderList();
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

function openDialog(task = null) {
  editingId = task ? task.id : null;
  $("dialogTitle").textContent = task ? "Edit Task" : "New Task";
  $("saveTaskBtn").textContent = task ? "Save Changes" : "Create Task";
  $("titleError").hidden = true;

  $("fieldTitle").value = task ? task.title : "";
  $("fieldDescription").value = task ? task.description : "";
  $("fieldPriority").value = task ? task.priority : "medium";
  $("fieldCategory").value = task ? task.category : "Personal";
  $("fieldDueDate").value = task ? task.dueDate : "";

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

  const fields = {
    title,
    description: $("fieldDescription").value,
    priority: $("fieldPriority").value,
    category: $("fieldCategory").value,
    dueDate: $("fieldDueDate").value,
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
  const options = CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join("");
  $("fieldCategory").innerHTML = options;
  $("categoryFilter").innerHTML = `<option value="">All categories</option>${options}`;

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