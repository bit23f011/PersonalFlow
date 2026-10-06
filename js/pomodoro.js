import { getTasks } from "./state.js";
import { showToast } from "./toast.js";
import { confirmAction } from "./dialogs.js";

const KEY = "personalflow-pomodoro"; // per device
const MODE_KEYS = ["focus", "short", "long"];
const MODES = {
  focus: { label: "Focus", color: "var(--accent)" },
  short: { label: "Short break", color: "#3a9d6e" },
  long: { label: "Long break", color: "var(--amber)" },
};
const RING_RADIUS = 52;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;
const STATS_KEEP_DAYS = 60;

const TIMER_ICON =
  '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/></svg>';
const CLOSE_ICON =
  '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function dateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const clampInt = (value, min, max, fallback) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/* ---------- Saved data ---------- */

function defaultData() {
  return {
    settings: { focus: 25, short: 5, long: 15, every: 4, autoStart: false },
    // status: idle | running | paused. cycle = focus sessions finished in the current set.
    timer: { mode: "focus", status: "idle", endAt: 0, remainingMs: 0, cycle: 0, taskId: "" },
    stats: {}, // { "YYYY-MM-DD": { sessions, minutes } }
    taskSessions: {}, // { taskId: sessions }
  };
}

function load() {
  const data = defaultData();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (!saved || typeof saved !== "object") return data;

    const s = saved.settings || {};
    const t = saved.timer || {};
    data.settings = {
      focus: clampInt(s.focus, 1, 120, 25),
      short: clampInt(s.short, 1, 60, 5),
      long: clampInt(s.long, 1, 60, 15),
      every: clampInt(s.every, 2, 8, 4),
      autoStart: s.autoStart === true,
    };
    data.timer = {
      mode: MODE_KEYS.includes(t.mode) ? t.mode : "focus",
      status: ["idle", "running", "paused"].includes(t.status) ? t.status : "idle",
      endAt: Number(t.endAt) || 0,
      remainingMs: Number(t.remainingMs) || 0,
      cycle: clampInt(t.cycle, 0, 1000, 0),
      taskId: typeof t.taskId === "string" ? t.taskId : "",
    };
    if (saved.stats && typeof saved.stats === "object") data.stats = saved.stats;
    if (saved.taskSessions && typeof saved.taskSessions === "object") data.taskSessions = saved.taskSessions;
  } catch (err) {
    console.error("Pomodoro: saved data unreadable, starting fresh.", err);
  }
  return data;
}

const data = load();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch (err) {
    console.error("Pomodoro: could not save.", err);
  }
}

function pruneStats() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - STATS_KEEP_DAYS);
  const limit = dateKey(cutoff);
  Object.keys(data.stats).forEach((key) => {
    if (key < limit) delete data.stats[key];
  });
}

function pruneTaskSessions() {
  const ids = new Set(getTasks().map((t) => t.id));
  Object.keys(data.taskSessions).forEach((id) => {
    if (!ids.has(id)) delete data.taskSessions[id];
  });
}

/* ---------- Timer logic (based on an end time, so it stays accurate in the background) ---------- */

const duration = (mode) => data.settings[mode] * 60_000;

function remaining() {
  const t = data.timer;
  if (t.status === "running") return Math.max(0, t.endAt - Date.now());
  if (t.status === "paused") return t.remainingMs;
  return duration(t.mode);
}

function formatMs(ms) {
  const total = Math.ceil(ms / 1000);
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

function start() {
  unlockAudio();
  const t = data.timer;
  if (t.status === "running") return;
  const ms = t.status === "paused" ? t.remainingMs : duration(t.mode);
  t.endAt = Date.now() + ms;
  t.status = "running";
  save();
  render();
}

function pause() {
  const t = data.timer;
  t.remainingMs = remaining();
  t.endAt = 0;
  t.status = "paused";
  save();
  render();
}

function reset() {
  const t = data.timer;
  t.status = "idle";
  t.endAt = 0;
  t.remainingMs = 0;
  save();
  render();
}

async function switchMode(mode) {
  const t = data.timer;
  if (mode === t.mode) return;
  if (t.status !== "idle") {
    const ok = await confirmAction({
      title: "Switch timer?",
      text: "The timer that is running will be reset.",
      confirmLabel: "Switch",
    });
    if (!ok) return;
  }
  t.mode = mode;
  t.status = "idle";
  t.endAt = 0;
  t.remainingMs = 0;
  save();
  render();
}

// Ends the current session. credited = it ran to the end (counts for stats); false = skipped.
function finish(credited, { silent = false } = {}) {
  const t = data.timer;
  const finished = t.mode;
  let next;

  if (finished === "focus") {
    if (credited) {
      const key = dateKey(new Date());
      const day = data.stats[key] || { sessions: 0, minutes: 0 };
      day.sessions += 1;
      day.minutes += data.settings.focus;
      data.stats[key] = day;
      if (t.taskId) data.taskSessions[t.taskId] = (data.taskSessions[t.taskId] || 0) + 1;
      t.cycle += 1;
    }
    next = credited && t.cycle % data.settings.every === 0 ? "long" : "short";
  } else {
    if (finished === "long") t.cycle = 0; // a full set is done
    next = "focus";
  }

  t.mode = next;
  t.remainingMs = 0;
  t.endAt = 0;
  t.status = "idle";
  if (data.settings.autoStart && credited) {
    t.status = "running";
    t.endAt = Date.now() + duration(next);
  }

  pruneStats();
  save();
  render();
  if (credited && !silent) announce(finished, next);
}

function tick() {
  if (data.timer.status === "running" && remaining() <= 0) finish(true);
  else render();
}

/* ---------- Alerts (sound, vibration, toast, notification) ---------- */

let audio = null;

function unlockAudio() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === "suspended") audio.resume();
  } catch {
    audio = null; // no sound support: the other alerts still work
  }
}

function beep() {
  if (!audio) return;
  const now = audio.currentTime;
  [0, 0.25, 0.5].forEach((offset) => {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, now + offset);
    gain.gain.exponentialRampToValueAtTime(0.25, now + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.2);
    osc.connect(gain).connect(audio.destination);
    osc.start(now + offset);
    osc.stop(now + offset + 0.22);
  });
}

// Only if notifications were already allowed (Settings, Reminders). Never asks for permission here.
async function showNotification(title, body) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const options = {
    body,
    tag: "personalflow-pomodoro",
    icon: new URL("assets/favicon1.png", location.href).href,
  };
  try {
    const reg =
      "serviceWorker" in navigator
        ? await Promise.race([
            navigator.serviceWorker.ready,
            new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
          ])
        : null;
    if (reg) await reg.showNotification(title, options);
    else new Notification(title, options);
  } catch (err) {
    console.error("Pomodoro notification failed", err);
  }
}

function announce(finished, next) {
  const title = finished === "focus" ? "Focus session complete" : "Break is over";
  const body =
    finished === "focus"
      ? `Take a ${data.settings[next]} minute break.`
      : "Ready for the next focus session?";

  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  beep();
  showToast(`${title}. ${body}`, { duration: 8000 });
  showNotification(title, body);
}

/* ---------- Page elements ---------- */

function loadStyles() {
  // This module brings its own stylesheet
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "css/pomodoro.css";
  document.head.appendChild(link);
}

function buildUI() {
  document.body.insertAdjacentHTML(
    "beforeend",
    `
    <button class="pomo-pill" id="pomoPill" type="button" hidden aria-label="Open focus timer">
      <span id="pomoPillTime">25:00</span><small id="pomoPillMode">Focus</small>
    </button>

    <section class="pomo" id="pomoPanel" aria-label="Focus timer" hidden>
      <header class="pomo-head">
        <h2>Focus timer</h2>
        <button class="icon-btn" id="pomoClose" type="button" aria-label="Close focus timer">${CLOSE_ICON}</button>
      </header>

      <div class="pomo-modes" role="group" aria-label="Timer mode">
        <button type="button" data-mode="focus">Focus</button>
        <button type="button" data-mode="short">Short break</button>
        <button type="button" data-mode="long">Long break</button>
      </div>

      <div class="pomo-ring">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle class="ring-bg" cx="60" cy="60" r="${RING_RADIUS}"></circle>
          <circle class="ring-fg" id="pomoRing" cx="60" cy="60" r="${RING_RADIUS}" stroke-dasharray="${RING_LENGTH}"></circle>
        </svg>
        <div class="pomo-time">
          <span id="pomoTime">25:00</span>
          <span class="pomo-label muted" id="pomoLabel">Focus</span>
        </div>
      </div>

      <div class="pomo-controls">
        <button class="btn btn-primary" id="pomoStart" type="button">Start</button>
        <button class="btn btn-ghost" id="pomoReset" type="button">Reset</button>
        <button class="btn btn-ghost" id="pomoSkip" type="button">Skip</button>
      </div>

      <div class="field">
        <label for="pomoTask">Working on</label>
        <select class="input" id="pomoTask"></select>
      </div>

      <p class="muted pomo-stats" id="pomoStats" aria-live="polite"></p>

      <details class="pomo-settings">
        <summary>Timer settings</summary>
        <div class="pomo-settings-grid">
          <label>Focus (min)<input class="input" id="pomoFocus" type="number" min="1" max="120" /></label>
          <label>Short break (min)<input class="input" id="pomoShort" type="number" min="1" max="60" /></label>
          <label>Long break (min)<input class="input" id="pomoLong" type="number" min="1" max="60" /></label>
          <label>Long break every<input class="input" id="pomoEvery" type="number" min="2" max="8" /></label>
        </div>
        <label class="pomo-check"><input id="pomoAuto" type="checkbox" /> Start the next session automatically</label>
        <p class="muted">To get an alert while the app is in the background, allow notifications in Settings, Reminders.</p>
      </details>
    </section>`
  );
}

// Opens the panel from the sidebar (desktop) or the top bar (phone)
function addEntryButtons() {
  const footer = document.querySelector(".sidebar-footer");
  const sidebarBtn = document.createElement("button");
  sidebarBtn.type = "button";
  sidebarBtn.className = "nav-item";
  sidebarBtn.innerHTML = `${TIMER_ICON}Focus timer`;
  footer.insertBefore(sidebarBtn, footer.querySelector(".js-theme-toggle"));
  sidebarBtn.addEventListener("click", () => togglePanel(sidebarBtn));

  const mobileBtn = document.createElement("button");
  mobileBtn.type = "button";
  mobileBtn.className = "icon-btn";
  mobileBtn.setAttribute("aria-label", "Focus timer");
  mobileBtn.innerHTML = TIMER_ICON;
  document.querySelector(".mobile-header-actions").prepend(mobileBtn);
  mobileBtn.addEventListener("click", () => togglePanel(mobileBtn));
}

/* ---------- Drawing ---------- */

function fillTasks() {
  pruneTaskSessions();
  const tasks = getTasks()
    .filter((t) => !t.completed)
    .sort((a, b) => Number(Boolean(b.starred)) - Number(Boolean(a.starred)));
  const label = (title) => (title.length > 50 ? `${title.slice(0, 50)}…` : title);

  const select = $("pomoTask");
  select.innerHTML =
    '<option value="">No specific task</option>' +
    tasks.map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(label(t.title))}</option>`).join("");

  const stillThere = tasks.some((t) => t.id === data.timer.taskId);
  select.value = stillThere ? data.timer.taskId : "";
  if (!stillThere && data.timer.taskId) {
    data.timer.taskId = "";
    save();
  }
}

function renderSettings() {
  const s = data.settings;
  $("pomoFocus").value = s.focus;
  $("pomoShort").value = s.short;
  $("pomoLong").value = s.long;
  $("pomoEvery").value = s.every;
  $("pomoAuto").checked = s.autoStart;
}

function render() {
  const t = data.timer;
  const ms = remaining();
  const total = duration(t.mode);
  const mode = MODES[t.mode];
  const time = formatMs(ms);

  $("pomoTime").textContent = time;
  const base =
    t.mode === "focus"
      ? `Focus · session ${(t.cycle % data.settings.every) + 1} of ${data.settings.every}`
      : mode.label;
  $("pomoLabel").textContent = base + (t.status === "paused" ? " · paused" : "");

  const ring = $("pomoRing");
  ring.style.stroke = mode.color;
  ring.style.strokeDashoffset = String(RING_LENGTH * (1 - (total ? ms / total : 1)));

  $("pomoStart").textContent = t.status === "running" ? "Pause" : t.status === "paused" ? "Resume" : "Start";
  document.querySelectorAll("#pomoPanel [data-mode]").forEach((btn) => {
    const on = btn.dataset.mode === t.mode;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-pressed", String(on));
  });

  const today = data.stats[dateKey(new Date())] || { sessions: 0, minutes: 0 };
  let stats = `Today: ${today.sessions} focus session${today.sessions === 1 ? "" : "s"} · ${today.minutes} min`;
  if (t.taskId) {
    const n = data.taskSessions[t.taskId] || 0;
    stats += ` · This task: ${n} session${n === 1 ? "" : "s"}`;
  }
  $("pomoStats").textContent = stats;

  // Small pill while a timer is active and the panel is closed
  $("pomoPill").hidden = t.status === "idle" || !$("pomoPanel").hidden;
  $("pomoPillTime").textContent = time;
  $("pomoPillMode").textContent = t.status === "paused" ? `${mode.label} · paused` : mode.label;

  document.title = t.status === "running" ? `${time} · ${mode.label} · PersonalFlow` : "PersonalFlow";
}

/* ---------- Opening and closing ---------- */

let lastOpener = null;

function openPanel(opener) {
  lastOpener = opener || null;
  fillTasks();
  renderSettings();
  $("pomoPanel").hidden = false;
  render();
  $("pomoStart").focus();
}

function closePanel() {
  $("pomoPanel").hidden = true;
  render();
  if (lastOpener) lastOpener.focus();
}

function togglePanel(opener) {
  if ($("pomoPanel").hidden) openPanel(opener);
  else closePanel();
}

function readSettings() {
  const s = data.settings;
  s.focus = clampInt($("pomoFocus").value, 1, 120, s.focus);
  s.short = clampInt($("pomoShort").value, 1, 60, s.short);
  s.long = clampInt($("pomoLong").value, 1, 60, s.long);
  s.every = clampInt($("pomoEvery").value, 2, 8, s.every);
  s.autoStart = $("pomoAuto").checked;
  save();
  renderSettings();
  render();
}

/* ---------- Start-up ---------- */

export function initPomodoro() {
  loadStyles();
  buildUI();
  addEntryButtons();

  $("pomoPill").addEventListener("click", () => openPanel($("pomoPill")));
  $("pomoClose").addEventListener("click", closePanel);
  $("pomoStart").addEventListener("click", () => (data.timer.status === "running" ? pause() : start()));
  $("pomoReset").addEventListener("click", reset);
  $("pomoSkip").addEventListener("click", () => finish(false));

  document.querySelectorAll("#pomoPanel [data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => switchMode(btn.dataset.mode));
  });

  $("pomoTask").addEventListener("change", (e) => {
    data.timer.taskId = e.target.value;
    save();
    render();
  });

  ["pomoFocus", "pomoShort", "pomoLong", "pomoEvery", "pomoAuto"].forEach((id) => {
    $(id).addEventListener("change", readSettings);
  });

  // Escape closes the panel (unless a dialog is open)
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("pomoPanel").hidden && !document.querySelector("dialog[open]")) closePanel();
  });

  // Browsers allow sound only after the first tap or click on the page
  document.addEventListener("pointerdown", unlockAudio, { once: true });

  // Catch up when the tab comes back to the front
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") tick();
  });

  pruneStats();
  renderSettings();

  // A timer that ran out while the app was closed counts as finished (without sound)
  if (data.timer.status === "running" && data.timer.endAt <= Date.now()) finish(true, { silent: true });
  else render();

  setInterval(tick, 250);
}