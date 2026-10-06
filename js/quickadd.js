import { addTask, deleteTask, resolveCategory, REPEAT_LABEL } from "./tasks.js";
import { getTasks } from "./state.js";
import { showToast } from "./toast.js";

const pad = (n) => String(n).padStart(2, "0");

const WEEKDAYS = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
};
const DAY_WORDS = { today: 0, aaj: 0, tomorrow: 1, tmrw: 1, tmr: 1, kal: 1, parson: 2, parso: 2 };
const PRIORITIES = { high: "high", h: "high", 1: "high", medium: "medium", med: "medium", m: "medium", 2: "medium", low: "low", l: "low", 3: "low" };
const REPEATS = { daily: "daily", everyday: "daily", weekly: "weekly", monthly: "monthly", weekdays: "weekdays" };
const REPEAT_UNITS = { day: "daily", week: "weekly", month: "monthly", weekday: "weekdays" };
const PRIORITY_LABEL = { high: "High", medium: "Medium", low: "Low" };

function toDateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(base, n) {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
}

function isRealDate(str) {
  const [y, m, d] = str.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

// "5pm", "5:30pm", "17:30", or "5" + "pm" (two words). Returns { time: "HH:MM", used } or null.
function parseTime(token, next) {
  const m = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/i.exec(token);
  if (!m) return null;

  let hour = Number(m[1]);
  const minute = m[2] === undefined ? 0 : Number(m[2]);
  let suffix = m[3] ? m[3].toLowerCase() : "";
  let used = 1;

  if (!suffix && next && /^(am|pm)$/i.test(next)) {
    suffix = next.toLowerCase();
    used = 2;
  }
  if (!suffix && m[2] === undefined) return null; // a bare number is not a time ("call 5 people")
  if (minute > 59) return null;

  if (suffix) {
    if (hour < 1 || hour > 12) return null;
    if (suffix === "pm" && hour < 12) hour += 12;
    if (suffix === "am" && hour === 12) hour = 0;
  } else if (hour > 23) {
    return null;
  }
  return { time: `${pad(hour)}:${pad(minute)}`, used };
}

/**
 * Turns one line of text into task fields.
 * Example: "Call Ali tomorrow 5pm #Work !high daily"
 */
export function parseQuickAdd(text, now = new Date()) {
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tokens = String(text || "").trim().split(/\s+/).filter(Boolean);
  const words = [];

  let category = "";
  let priority = "";
  let time = "";
  let repeat = "";
  let dayOffset = null; // days from today
  let isoDate = "";

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const lower = token.toLowerCase();

    if (!category && token.length > 1 && token.startsWith("#")) {
      category = token.slice(1).replace(/_/g, " ");
      continue;
    }

    if (!priority && token.length > 1 && token.startsWith("!") && PRIORITIES[lower.slice(1)]) {
      priority = PRIORITIES[lower.slice(1)];
      continue;
    }

    if (!time) {
      const parsed = parseTime(lower, tokens[i + 1]);
      if (parsed) {
        time = parsed.time;
        i += parsed.used - 1;
        if (words.length && words[words.length - 1].toLowerCase() === "at") words.pop(); // "at 5pm"
        continue;
      }
    }

    if (!repeat) {
      if (REPEATS[lower]) {
        repeat = REPEATS[lower];
        continue;
      }
      if (lower === "every" && REPEAT_UNITS[(tokens[i + 1] || "").toLowerCase()]) {
        repeat = REPEAT_UNITS[tokens[i + 1].toLowerCase()];
        i += 1;
        continue;
      }
    }

    if (dayOffset === null && !isoDate) {
      if (lower in DAY_WORDS) {
        dayOffset = DAY_WORDS[lower];
        continue;
      }
      if (lower in WEEKDAYS) {
        dayOffset = (WEEKDAYS[lower] - base.getDay() + 7) % 7 || 7; // the next such day
        continue;
      }
      if (lower === "in" && /^\d{1,3}$/.test(tokens[i + 1] || "") && /^(days?|weeks?)$/i.test(tokens[i + 2] || "")) {
        const n = Number(tokens[i + 1]);
        dayOffset = /^week/i.test(tokens[i + 2]) ? n * 7 : n;
        i += 2;
        continue;
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(lower) && isRealDate(lower)) {
        isoDate = lower;
        continue;
      }
    }

    words.push(token);
  }

  let dueDate = isoDate || (dayOffset !== null ? toDateStr(addDays(base, dayOffset)) : "");
  if (!dueDate && (time || repeat)) {
    // a time or repeat without a date: today, or tomorrow if that time has already passed
    const passed = time && time <= `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    dueDate = toDateStr(addDays(base, passed ? 1 : 0));
  }

  return {
    title: words.join(" ").trim().slice(0, 200),
    category,
    priority: priority || "medium",
    dueDate,
    dueTime: dueDate ? time : "",
    repeat: dueDate ? repeat : "",
  };
}

/* ---------- Preview text ---------- */

function dayLabel(dateStr, now) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((date - base) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function formatTime(time) {
  const [h, m] = time.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function describe(fields, now = new Date()) {
  const parts = [];
  if (fields.dueDate) {
    parts.push(dayLabel(fields.dueDate, now) + (fields.dueTime ? `, ${formatTime(fields.dueTime)}` : ""));
  }
  parts.push(resolveCategory(fields.category || "Personal"));
  parts.push(PRIORITY_LABEL[fields.priority]);
  if (fields.repeat) parts.push(`↻ ${REPEAT_LABEL[fields.repeat]}`);
  return parts.join(" · ");
}

/* ---------- The box on the page ---------- */

export function initQuickAdd() {
  document.querySelector(".topbar").insertAdjacentHTML(
    "afterend",
    '<form class="quickadd" id="quickAddForm" autocomplete="off">' +
      '<label class="quickadd-box">' +
      '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>' +
      '<input id="quickAddInput" type="text" maxlength="300" aria-label="Quick add task" ' +
      'placeholder="Quick add: Call Ali tomorrow 5pm #Work !high" />' +
      "</label>" +
      '<p class="quickadd-preview muted" id="quickAddPreview" aria-live="polite"></p>' +
      "</form>"
  );

  const form = document.getElementById("quickAddForm");
  const input = document.getElementById("quickAddInput");
  const preview = document.getElementById("quickAddPreview");

  function updatePreview() {
    if (!input.value.trim()) {
      preview.textContent = "";
      return;
    }
    const parsed = parseQuickAdd(input.value);
    preview.textContent = parsed.title
      ? `Will add: “${parsed.title}” · ${describe(parsed)}`
      : "Type a title for the task.";
  }

  input.addEventListener("input", updatePreview);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      input.value = "";
      updatePreview();
    }
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const parsed = parseQuickAdd(input.value);
    if (!parsed.title) {
      preview.textContent = "Type a title for the task.";
      return;
    }

    addTask({ ...parsed, category: parsed.category || "Personal" });
    const tasks = getTasks();
    const created = tasks[tasks.length - 1]; // new tasks are added at the end

    input.value = "";
    updatePreview();
    const shortTitle = created.title.length > 40 ? `${created.title.slice(0, 40)}…` : created.title;
    showToast(`Added: ${shortTitle}`, { actionLabel: "Undo", onAction: () => deleteTask(created.id) });
  });
}