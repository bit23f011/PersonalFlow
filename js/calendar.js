import { getTasks } from "./state.js";
import { toggleTask, restoreTask, addTask, deleteTask, todayStr } from "./tasks.js";
import { registerView, editTask } from "./ui.js";
import { showToast } from "./toast.js";
import { normalizeHex, colorStyle } from "./colors.js";

const pad = (n) => String(n).padStart(2, "0");
const toStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function parse(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function esc(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function formatTime(time) {
  const [h, m] = time.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

// Tasks without a card colour use their priority colour
const PRIORITY_STYLE = {
  high: "--task-color:#f4675e;--task-tint:rgba(244,103,94,0.14)",
  medium: "--task-color:#d1964a;--task-tint:rgba(209,150,74,0.14)",
  low: "--task-color:#78909c;--task-tint:rgba(120,144,156,0.14)",
};

const CHEVRON_LEFT = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg>';
const CHEVRON_RIGHT = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';

let root = null;
let shown = { y: new Date().getFullYear(), m: new Date().getMonth() };
let selected = todayStr();

const styleOf = (task) => {
  const color = normalizeHex(task.color);
  return color ? colorStyle(color) : PRIORITY_STYLE[task.priority] || "";
};

/* ---------- Which tasks fall on which day ---------- */

// The next date of a repeating task (same rules as the task list)
function nextDate(dateStr, repeat) {
  const d = parse(dateStr);
  if (repeat === "daily") {
    d.setDate(d.getDate() + 1);
  } else if (repeat === "weekdays") {
    do {
      d.setDate(d.getDate() + 1);
    } while (d.getDay() === 0 || d.getDay() === 6);
  } else if (repeat === "weekly") {
    d.setDate(d.getDate() + 7);
  } else if (repeat === "monthly") {
    const day = d.getDate();
    d.setMonth(d.getMonth() + 1);
    if (d.getDate() !== day) d.setDate(0);
  } else {
    d.setDate(d.getDate() + 1000); // unknown rule: stop quickly
  }
  return toStr(d);
}

// Map of "YYYY-MM-DD" -> [{ task, ghost, done }] between two dates (inclusive).
// ghost = a repeat that has not happened yet, or a past day a repeating task was finished.
function entriesByDate(startStr, endStr) {
  const map = new Map();
  const add = (date, entry) => {
    if (date < startStr || date > endStr) return;
    if (!map.has(date)) map.set(date, []);
    map.get(date).push(entry);
  };

  getTasks().forEach((t) => {
    (Array.isArray(t.doneDates) ? t.doneDates : []).forEach((d) => add(d, { task: t, ghost: true, done: true }));
    if (!t.dueDate) return;

    add(t.dueDate, { task: t, ghost: false, done: t.completed });
    if (t.repeat) {
      let d = t.dueDate;
      for (let i = 0; i < 400; i++) {
        d = nextDate(d, t.repeat);
        if (d > endStr) break;
        add(d, { task: t, ghost: true, done: false });
      }
    }
  });

  map.forEach((list) =>
    list.sort(
      (a, b) =>
        Number(a.done) - Number(b.done) ||
        (a.task.dueTime || "99:99").localeCompare(b.task.dueTime || "99:99") ||
        a.task.title.localeCompare(b.task.title)
    )
  );
  return map;
}

/* ---------- Drawing ---------- */

function dayCell(date, entries, today) {
  const ds = toStr(date);
  const classes = ["cal-day"];
  if (date.getMonth() !== shown.m) classes.push("is-other");
  if (ds === today) classes.push("is-today");
  if (ds === selected) classes.push("is-selected");

  const chips = entries
    .slice(0, 3)
    .map(
      ({ task, ghost, done }) =>
        `<span class="cal-chip${done ? " is-done" : ""}${ghost && !done ? " is-ghost" : ""}" style="${styleOf(task)}">${esc(task.title)}</span>`
    )
    .join("");
  const more = entries.length > 3 ? `<span class="cal-more">+${entries.length - 3} more</span>` : "";
  const dots = entries
    .slice(0, 4)
    .map(({ task }) => `<span class="cal-dot" style="${styleOf(task)}"></span>`)
    .join("");

  const label = `${date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}, ${entries.length} ${entries.length === 1 ? "task" : "tasks"}`;
  return `
    <button class="${classes.join(" ")}" type="button" data-date="${ds}" aria-label="${esc(label)}">
      <span class="cal-num">${date.getDate()}</span>${chips}${more}<span class="cal-dots">${dots}</span>
    </button>`;
}

function panelItem({ task, ghost, done }) {
  const meta = [
    task.dueTime ? formatTime(task.dueTime) : "",
    ghost ? (done ? "Done" : "Repeats") : "",
    task.category,
  ]
    .filter(Boolean)
    .map(esc)
    .join(" · ");

  const mark = ghost
    ? `<span class="cal-ghost-mark" aria-hidden="true">${done ? "✓" : "↻"}</span>`
    : `<button class="check${task.completed ? " is-checked" : ""}" type="button" role="checkbox"
         aria-checked="${task.completed}" data-act="done" aria-label="Mark as ${task.completed ? "not done" : "done"}: ${esc(task.title)}"></button>`;

  return `
    <li class="cal-item${done ? " is-done" : ""}" data-id="${esc(task.id)}" style="${styleOf(task)}">
      ${mark}
      <button class="cal-item-main" type="button" data-act="open">
        <span class="cal-item-title">${esc(task.title)}</span>
        ${meta ? `<span class="cal-item-meta">${meta}</span>` : ""}
      </button>
    </li>`;
}

function render() {
  if (!root) return;
  const today = todayStr();
  const first = new Date(shown.y, shown.m, 1);
  const lead = (first.getDay() + 6) % 7; // Monday first
  const days = new Date(shown.y, shown.m + 1, 0).getDate();
  const cells = Math.ceil((lead + days) / 7) * 7;
  const gridStart = new Date(shown.y, shown.m, 1 - lead);
  const gridEnd = new Date(shown.y, shown.m, 1 - lead + cells - 1);
  const map = entriesByDate(toStr(gridStart), toStr(gridEnd));

  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: "short" }) // 1 Jan 2024 is a Monday
  );

  let grid = weekdays.map((w) => `<div class="cal-dow">${w}</div>`).join("");
  for (let i = 0; i < cells; i++) {
    const date = new Date(gridStart);
    date.setDate(date.getDate() + i);
    grid += dayCell(date, map.get(toStr(date)) || [], today);
  }

  const selectedDate = parse(selected);
  const dayEntries = entriesByDate(selected, selected).get(selected) || [];
  const dayTitle = selectedDate.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  root.innerHTML = `
    <section class="section">
      <div class="section-head cal-head">
        <h2 class="cal-title">${first.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h2>
        <div class="cal-controls">
          <button class="icon-btn" type="button" data-cal="prev" aria-label="Previous month">${CHEVRON_LEFT}</button>
          <button class="btn btn-ghost btn-sm" type="button" data-cal="today">Today</button>
          <button class="icon-btn" type="button" data-cal="next" aria-label="Next month">${CHEVRON_RIGHT}</button>
        </div>
      </div>
      <div class="cal-grid" role="group" aria-label="Calendar">${grid}</div>
    </section>

    <section class="section">
      <div class="section-head"><h2>${esc(dayTitle)}</h2></div>
      <div class="card cal-panel">
        ${
          dayEntries.length
            ? `<ul class="cal-list">${dayEntries.map(panelItem).join("")}</ul>`
            : '<p class="muted cal-empty">Nothing planned for this day.</p>'
        }
        <form class="cal-add" autocomplete="off">
          <input class="input" type="text" maxlength="200" placeholder="Add a task for this day…" aria-label="Add a task for ${esc(dayTitle)}" />
          <button class="btn btn-primary btn-sm" type="submit">Add</button>
        </form>
      </div>
    </section>`;
}

/* ---------- Clicks ---------- */

function completeFromPanel(id) {
  const index = getTasks().findIndex((t) => t.id === id);
  if (index < 0) return;
  const before = structuredClone(getTasks()[index]);
  toggleTask(id);
  showToast("Done", { actionLabel: "Undo", onAction: () => restoreTask(before, index) });
}

function onClick(e) {
  const nav = e.target.closest("[data-cal]");
  if (nav) {
    if (nav.dataset.cal === "today") {
      const now = new Date();
      shown = { y: now.getFullYear(), m: now.getMonth() };
      selected = todayStr();
    } else {
      const step = nav.dataset.cal === "next" ? 1 : -1;
      const d = new Date(shown.y, shown.m + step, 1);
      shown = { y: d.getFullYear(), m: d.getMonth() };
    }
    render();
    return;
  }

  const day = e.target.closest(".cal-day");
  if (day) {
    selected = day.dataset.date;
    const d = parse(selected);
    if (d.getMonth() !== shown.m) shown = { y: d.getFullYear(), m: d.getMonth() }; // a day of a neighbouring month
    render();
    return;
  }

  const act = e.target.closest("[data-act]");
  if (!act) return;
  const id = act.closest(".cal-item").dataset.id;
  if (act.dataset.act === "open") editTask(id);
  else completeFromPanel(id);
}

function onSubmit(e) {
  if (!e.target.matches(".cal-add")) return;
  e.preventDefault();
  const input = e.target.querySelector("input");
  const title = input.value.trim();
  if (!title) return;

  addTask({ title, dueDate: selected, priority: "medium", category: "Personal" });
  const tasks = getTasks();
  const created = tasks[tasks.length - 1]; // new tasks are added at the end
  showToast("Task added", { actionLabel: "Undo", onAction: () => deleteTask(created.id) });

  const again = root.querySelector(".cal-add input");
  if (again) again.focus();
}

export function initCalendar(element) {
  root = element;
  root.addEventListener("click", onClick);
  root.addEventListener("submit", onSubmit);
  registerView("calendar", root, render);
}