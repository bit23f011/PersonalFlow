import { getTasks, subscribe } from "./state.js";
import { toggleTask, restoreTask, todayStr } from "./tasks.js";
import { editTask, dueInfo } from "./ui.js";
import { showToast } from "./toast.js";
import { normalizeHex, colorStyle } from "./colors.js";

const BELL_ICON =
  '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/></svg>';
const CLOSE_ICON =
  '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';

const $ = (id) => document.getElementById(id);
let lastOpener = null;

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function loadStyles() {
  // This module brings its own stylesheet
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "css/alerts.css";
  document.head.appendChild(link);
}

/* ---------- What needs attention ---------- */

// High priority tasks, and "Daily" repeating tasks that are due today or overdue
function collect() {
  const today = todayStr();
  const open = getTasks().filter((t) => !t.completed);
  const byDue = (a, b) =>
    (a.dueDate || "9999").localeCompare(b.dueDate || "9999") ||
    (a.dueTime || "99:99").localeCompare(b.dueTime || "99:99");

  const high = open.filter((t) => t.priority === "high").sort(byDue);
  const highIds = new Set(high.map((t) => t.id));
  const daily = open
    .filter((t) => t.repeat === "daily" && t.dueDate && t.dueDate <= today && !highIds.has(t.id))
    .sort(byDue);

  return { high, daily };
}

function itemHtml(task) {
  const due = dueInfo(task);
  const color = normalizeHex(task.color);
  const bits = [];
  if (due.text) bits.push(`<span${due.overdue ? ' class="is-overdue"' : ""}>${escapeHtml(due.text)}</span>`);
  if (task.repeat === "daily") bits.push("↻ Daily");

  return `
    <li class="alert-item" data-id="${escapeHtml(task.id)}"${color ? ` style="${colorStyle(color)}"` : ""}>
      <button class="check" type="button" role="checkbox" aria-checked="false" data-act="done"
        aria-label="Mark as done: ${escapeHtml(task.title)}"></button>
      <button class="alert-main" type="button" data-act="open">
        <span class="alert-title">${escapeHtml(task.title)}</span>
        ${bits.length ? `<span class="alert-meta">${bits.join(" · ")}</span>` : ""}
      </button>
    </li>`;
}

function section(title, tasks) {
  if (!tasks.length) return "";
  return `
    <div>
      <h3 class="alerts-title">${title}<span class="alerts-count">${tasks.length}</span></h3>
      <ul class="alerts-list">${tasks.map(itemHtml).join("")}</ul>
    </div>`;
}

/* ---------- Drawing ---------- */

function updateBadges() {
  const { high, daily } = collect();
  const total = high.length + daily.length;
  document.querySelectorAll("[data-alerts-badge]").forEach((badge) => {
    badge.textContent = total > 99 ? "99+" : String(total);
    badge.hidden = total === 0;
  });
  document.querySelectorAll("[data-alerts-bell]").forEach((bell) => {
    bell.setAttribute("aria-label", total ? `Alerts (${total})` : "Alerts");
  });
  return { high, daily, total };
}

function render() {
  const { high, daily, total } = updateBadges();
  if ($("alertsPanel").hidden) return;

  $("alertsBody").innerHTML = total
    ? section("High priority", high) + section("Daily reminders", daily)
    : '<p class="muted alerts-empty">Nothing needs your attention right now.</p>';
}

/* ---------- Opening and closing ---------- */

function openPanel(opener) {
  // The focus timer panel sits in the same place: close it first
  const pomo = $("pomoPanel");
  if (pomo && !pomo.hidden && $("pomoClose")) $("pomoClose").click();

  lastOpener = opener || null;
  $("alertsPanel").hidden = false;
  render();
  $("alertsClose").focus();
}

function closePanel(restoreFocus = true) {
  $("alertsPanel").hidden = true;
  if (restoreFocus && lastOpener) lastOpener.focus();
}

function togglePanel(opener) {
  if ($("alertsPanel").hidden) openPanel(opener);
  else closePanel();
}

/* ---------- Start-up ---------- */

export function initAlerts() {
  loadStyles();

  document.body.insertAdjacentHTML(
    "beforeend",
    `
    <section class="alerts" id="alertsPanel" aria-label="Alerts" hidden>
      <header class="alerts-head">
        <h2>Alerts</h2>
        <button class="icon-btn" id="alertsClose" type="button" aria-label="Close alerts">${CLOSE_ICON}</button>
      </header>
      <div id="alertsBody"></div>
    </section>`
  );

  // Bell in the sidebar (desktop)...
  const footer = document.querySelector(".sidebar-footer");
  const sidebarBtn = document.createElement("button");
  sidebarBtn.type = "button";
  sidebarBtn.className = "nav-item";
  sidebarBtn.setAttribute("data-alerts-bell", "");
  sidebarBtn.innerHTML = `${BELL_ICON}Alerts<span class="bell-badge" data-alerts-badge hidden>0</span>`;
  footer.insertBefore(sidebarBtn, footer.querySelector(".js-theme-toggle"));
  sidebarBtn.addEventListener("click", () => togglePanel(sidebarBtn));

  // ...and in the top bar (phone)
  const mobileBtn = document.createElement("button");
  mobileBtn.type = "button";
  mobileBtn.className = "icon-btn alerts-bell";
  mobileBtn.setAttribute("data-alerts-bell", "");
  mobileBtn.innerHTML = `${BELL_ICON}<span class="bell-badge" data-alerts-badge hidden>0</span>`;
  document.querySelector(".mobile-header-actions").prepend(mobileBtn);
  mobileBtn.addEventListener("click", () => togglePanel(mobileBtn));

  $("alertsClose").addEventListener("click", () => closePanel());

  $("alertsBody").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const id = btn.closest(".alert-item").dataset.id;

    if (btn.dataset.act === "open") {
      closePanel(false);
      editTask(id);
      return;
    }

    const index = getTasks().findIndex((t) => t.id === id);
    if (index < 0) return;
    const before = structuredClone(getTasks()[index]);
    toggleTask(id);
    showToast("Done", { actionLabel: "Undo", onAction: () => restoreTask(before, index) });
  });

  // Click anywhere outside closes the panel (composedPath still works after the list is redrawn)
  document.addEventListener("click", (e) => {
    if ($("alertsPanel").hidden) return;
    const path = e.composedPath();
    if (path.includes($("alertsPanel")) || path.some((el) => el.hasAttribute && el.hasAttribute("data-alerts-bell"))) return;
    closePanel(false);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("alertsPanel").hidden && !document.querySelector("dialog[open]")) closePanel();
  });

  subscribe(render);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") render();
  });
  setInterval(updateBadges, 60_000); // dates change at midnight
  render();
}