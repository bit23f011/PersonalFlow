import { getTasks } from "./state.js";
import { registerView, formatMinutes } from "./ui.js";

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

const addDays = (d, n) => {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
};

const weekStart = (d) => addDays(d, -((d.getDay() + 6) % 7)); // Monday
const dayDiff = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);

let root = null;

/* ---------- Finished work ---------- */

// Every day something was finished: tasks that are done, plus the history of repeating tasks.
// Tasks finished before the history existed fall back to their last change date.
function completionCounts() {
  const counts = new Map();
  const add = (dateStr) => {
    if (dateStr) counts.set(dateStr, (counts.get(dateStr) || 0) + 1);
  };
  const localDate = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : toStr(d);
  };

  getTasks().forEach((t) => {
    if (t.completed) add(localDate(t.completedAt || t.updatedAt));
    (Array.isArray(t.doneDates) ? t.doneDates : []).forEach(add);
  });
  return counts;
}

// Days in a row with something finished (today may still be open)
function overallStreaks(counts) {
  let current = 0;
  let day = new Date();
  if (!counts.has(toStr(day))) day = addDays(day, -1);
  while (counts.has(toStr(day))) {
    current += 1;
    day = addDays(day, -1);
  }

  let best = 0;
  let run = 0;
  let prev = null;
  [...counts.keys()].sort().forEach((d) => {
    run = prev && dayDiff(prev, d) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  });
  return { current, best };
}

/* ---------- Streak of one repeating task ---------- */

// The "period" a date belongs to: the day, the week (Monday) or the month
function periodKey(dateStr, repeat) {
  if (repeat === "monthly") return dateStr.slice(0, 7);
  if (repeat === "weekly") return toStr(weekStart(parse(dateStr)));
  return dateStr;
}

function previousPeriod(key, repeat) {
  if (repeat === "monthly") {
    const [y, m] = key.split("-").map(Number);
    const d = new Date(y, m - 2, 1);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  }
  let d = parse(key);
  if (repeat === "weekly") {
    d = addDays(d, -7);
  } else if (repeat === "weekdays") {
    do {
      d = addDays(d, -1);
    } while (d.getDay() === 0 || d.getDay() === 6);
  } else {
    d = addDays(d, -1);
  }
  return toStr(d);
}

function habitStreak(task) {
  const history = Array.isArray(task.doneDates) ? task.doneDates : [];
  const keys = new Set(history.map((d) => periodKey(d, task.repeat)));

  let today = new Date();
  if (task.repeat === "weekdays") while (today.getDay() === 0 || today.getDay() === 6) today = addDays(today, -1);

  let key = periodKey(toStr(today), task.repeat);
  if (!keys.has(key)) key = previousPeriod(key, task.repeat); // this period is still open
  let streak = 0;
  while (keys.has(key)) {
    streak += 1;
    key = previousPeriod(key, task.repeat);
  }
  return streak;
}

const UNIT = { daily: "day", weekdays: "weekday", weekly: "week", monthly: "month" };

/* ---------- Drawing ---------- */

function bars(items) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return `
    <div class="bars">
      ${items
        .map(
          (i) => `
        <div class="bar-col">
          <span class="bar-value">${i.value || ""}</span>
          <div class="bar-track"><div class="bar-fill${i.highlight ? " is-today" : ""}" style="height:${i.value ? Math.max(6, Math.round((i.value / max) * 100)) : 0}%"></div></div>
          <span class="bar-label">${esc(i.label)}</span>
        </div>`
        )
        .join("")}
    </div>`;
}

function render() {
  if (!root) return;
  const counts = completionCounts();
  const now = new Date();
  const todayKey = toStr(now);

  // Last 7 days
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(now, i - 6);
    return {
      label: d.toLocaleDateString(undefined, { weekday: "short" }),
      value: counts.get(toStr(d)) || 0,
      highlight: toStr(d) === todayKey,
    };
  });
  const week = days.reduce((sum, d) => sum + d.value, 0);

  // Last 8 weeks
  const thisMonday = weekStart(now);
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const start = addDays(thisMonday, (i - 7) * 7);
    let value = 0;
    for (let k = 0; k < 7; k++) value += counts.get(toStr(addDays(start, k))) || 0;
    return {
      label: start.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      value,
      highlight: i === 7,
    };
  });

  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const { current, best } = overallStreaks(counts);

  // Repeating tasks
  const habits = getTasks()
    .filter((t) => t.repeat)
    .map((t) => ({ task: t, streak: habitStreak(t) }))
    .sort((a, b) => b.streak - a.streak || (b.task.completedCount || 0) - (a.task.completedCount || 0));

  // Time tracked with the Focus timer
  const timed = getTasks()
    .filter((t) => t.focusMinutes > 0)
    .sort((a, b) => b.focusMinutes - a.focusMinutes);
  const totalMinutes = timed.reduce((sum, t) => sum + t.focusMinutes, 0);
  const topMinutes = timed.length ? timed[0].focusMinutes : 1;

  if (!total && !habits.length && !timed.length) {
    root.innerHTML = `
      <section class="section">
        <div class="section-head"><h2>Stats</h2></div>
        <div class="card"><div class="empty"><p class="empty-title">Nothing to show yet</p>
        <p class="muted">Finish a few tasks and your streaks and charts will appear here.</p></div></div>
      </section>`;
    return;
  }

  root.innerHTML = `
    <section class="stats" aria-label="Summary">
      <article class="card stat"><p class="stat-label">Last 7 days</p><p class="stat-value">${week}</p></article>
      <article class="card stat"><p class="stat-label">All time</p><p class="stat-value">${total}</p></article>
      <article class="card stat"><p class="stat-label">Current streak</p><p class="stat-value">${current}<span class="stat-unit"> ${current === 1 ? "day" : "days"}</span></p></article>
      <article class="card stat"><p class="stat-label">Best streak</p><p class="stat-value">${best}<span class="stat-unit"> ${best === 1 ? "day" : "days"}</span></p></article>
    </section>

    <section class="section">
      <div class="section-head"><h2>Last 7 days</h2></div>
      <div class="card">${bars(days)}</div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Last 8 weeks</h2></div>
      <div class="card">${bars(weeks)}</div>
    </section>

    ${
      habits.length
        ? `<section class="section">
      <div class="section-head"><h2>Habits</h2></div>
      <div class="card">
        ${habits
          .map(
            ({ task, streak }) => `
          <div class="habit-row">
            <span class="habit-title">${esc(task.title)}</span>
            <span class="habit-meta">${streak} ${UNIT[task.repeat]}${streak === 1 ? "" : "s"} streak · done ${task.completedCount || 0}×</span>
          </div>`
          )
          .join("")}
      </div>
    </section>`
        : ""
    }

    ${
      timed.length
        ? `<section class="section">
      <div class="section-head"><h2>Time tracked</h2><span class="muted">Total ${formatMinutes(totalMinutes)}</span></div>
      <div class="card">
        ${timed
          .slice(0, 5)
          .map(
            (t) => `
          <div class="time-row">
            <span class="habit-title">${esc(t.title)}</span>
            <div class="time-bar"><div class="time-fill" style="width:${Math.max(6, Math.round((t.focusMinutes / topMinutes) * 100))}%"></div></div>
            <span class="habit-meta">${formatMinutes(t.focusMinutes)}</span>
          </div>`
          )
          .join("")}
      </div>
    </section>`
        : ""
    }

    <p class="muted stats-note">Tasks finished before this feature was added are counted on the day they were last changed.</p>`;
}

export function initStats(element) {
  root = element;
  registerView("stats", root, render);
}