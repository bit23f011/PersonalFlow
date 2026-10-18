import { getTasks, subscribe } from "./state.js";
import { toggleTask, restoreTask, setFocusToday, getFocusTasks, getProgress, todayStr } from "./tasks.js";
import { editTask, dueInfo } from "./ui.js";
import { showToast } from "./toast.js";
import { normalizeHex, colorStyle } from "./colors.js";

const MAX_FOCUS = 3;
const $ = (id) => document.getElementById(id);

function esc(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

// A task counts as done today if it is completed, or a repeating task finished today
function isDoneToday(task) {
  return task.completed || (Array.isArray(task.doneDates) && task.doneDates.includes(todayStr()));
}

// Higher = more worth doing today
function score(task) {
  const today = todayStr();
  let s = task.starred ? 3 : 0;
  s += { high: 3, medium: 1, low: 0 }[task.priority] || 0;
  if (task.dueDate && task.dueDate < today) s += 3;
  else if (task.dueDate === today) s += 2;
  return s;
}

const byScore = (a, b) => score(b) - score(a) || (a.dueDate || "9999").localeCompare(b.dueDate || "9999");

/* ---------- The card on the Overview ---------- */

function itemHtml(task) {
  const done = isDoneToday(task);
  const color = normalizeHex(task.color);
  const progress = getProgress(task);
  const bits = [dueInfo(task).text, progress.total ? `${progress.percent}% of subtasks` : ""].filter(Boolean);
  // A repeating task finished today moved on to its next date: it cannot be ticked again today
  const locked = done && !task.completed;

  return `
    <li class="focus-item${done ? " is-done" : ""}" data-id="${esc(task.id)}"${color ? ` style="${colorStyle(color)}"` : ""}>
      <button class="check${done ? " is-checked" : ""}" type="button" role="checkbox" aria-checked="${done}"
        data-act="done"${locked ? " disabled" : ""} aria-label="Mark as ${done ? "not done" : "done"}: ${esc(task.title)}"></button>
      <button class="focus-main" type="button" data-act="open">
        <span class="focus-title">${esc(task.title)}</span>
        ${bits.length ? `<span class="focus-meta">${esc(bits.join(" · "))}</span>` : ""}
      </button>
    </li>`;
}

function render() {
  const tasks = getFocusTasks();
  const done = tasks.filter(isDoneToday).length;
  $("focusPick").textContent = tasks.length ? "Change" : "Choose";

  if (!tasks.length) {
    $("focusBody").innerHTML = `
      <div class="empty">
        <p class="empty-title">What matters most today?</p>
        <p class="muted">Pick up to ${MAX_FOCUS} tasks to focus on. The list starts fresh every day.</p>
      </div>`;
    return;
  }

  const percent = Math.round((done / tasks.length) * 100);
  const fillClass = percent >= 100 ? "progress-done" : percent >= 67 ? "progress-high" : percent >= 34 ? "progress-mid" : "progress-low";
  $("focusBody").innerHTML = `
    <div class="focus-summary">
      <div class="progress-track" role="progressbar" aria-label="Today's focus progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}">
        <div class="progress-fill ${fillClass}" style="width:${percent}%"></div>
      </div>
      <span class="progress-label">${done} of ${tasks.length} done</span>
    </div>
    <ul class="focus-list">${tasks.map(itemHtml).join("")}</ul>
    ${done === tasks.length ? '<p class="muted focus-cheer">All done. Great work today!</p>' : ""}`;
}

/* ---------- The picker ---------- */

function candidates() {
  const today = todayStr();
  return getTasks()
    .filter((t) => !t.completed || t.focusDate === today)
    .sort(byScore);
}

function updateCount() {
  const n = $("focusOptions").querySelectorAll("input:checked").length;
  $("focusCount").textContent = `${n} of ${MAX_FOCUS} selected`;
}

function openPicker() {
  const chosen = new Set(getFocusTasks().map((t) => t.id));
  const list = candidates();

  $("focusOptions").innerHTML = list.length
    ? list
        .map((t) => {
          const due = dueInfo(t).text;
          const meta = [t.priority === "high" ? "High priority" : "", t.starred ? "Starred" : "", due].filter(Boolean).join(" · ");
          return `
        <label class="focus-option">
          <input type="checkbox" value="${esc(t.id)}"${chosen.has(t.id) ? " checked" : ""} />
          <span><span class="focus-title">${esc(t.title)}</span>${meta ? `<span class="focus-meta">${esc(meta)}</span>` : ""}</span>
        </label>`;
        })
        .join("")
    : '<p class="muted">You have no open tasks to pick from.</p>';

  updateCount();
  $("focusDialog").showModal();
}

function autoPick() {
  const top = new Set(
    candidates()
      .filter((t) => !t.completed)
      .slice(0, MAX_FOCUS)
      .map((t) => t.id)
  );
  $("focusOptions").querySelectorAll("input").forEach((input) => {
    input.checked = top.has(input.value);
  });
  updateCount();
}

function savePicker() {
  const ids = [...$("focusOptions").querySelectorAll("input:checked")].map((input) => input.value);
  setFocusToday(ids);
  $("focusDialog").close();
}

/* ---------- Start-up ---------- */

export function initFocus() {
  $("viewOverview").insertAdjacentHTML(
    "afterbegin",
    `
    <section class="section" id="focusCard" aria-label="Today's focus">
      <div class="section-head">
        <h2>Today's focus</h2>
        <button class="btn btn-ghost btn-sm" id="focusPick" type="button">Choose</button>
      </div>
      <div class="card" id="focusBody"></div>
    </section>`
  );

  document.body.insertAdjacentHTML(
    "beforeend",
    `
    <dialog class="modal" id="focusDialog" aria-labelledby="focusDialogTitle">
      <div class="modal-form">
        <h2 id="focusDialogTitle">Today's focus</h2>
        <p class="muted" id="focusCount" aria-live="polite">0 of ${MAX_FOCUS} selected</p>
        <div class="focus-options" id="focusOptions"></div>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="focusAuto" type="button">Auto-pick</button>
          <button class="btn btn-ghost" id="focusCancel" type="button">Cancel</button>
          <button class="btn btn-primary" id="focusSave" type="button">Save</button>
        </div>
      </div>
    </dialog>`
  );

  $("focusPick").addEventListener("click", openPicker);
  $("focusAuto").addEventListener("click", autoPick);
  $("focusCancel").addEventListener("click", () => $("focusDialog").close());
  $("focusSave").addEventListener("click", savePicker);

  // At most 3 can be ticked
  $("focusOptions").addEventListener("change", (e) => {
    if ($("focusOptions").querySelectorAll("input:checked").length > MAX_FOCUS) e.target.checked = false;
    updateCount();
  });

  $("focusBody").addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]");
    if (!act || act.disabled) return;
    const id = act.closest(".focus-item").dataset.id;

    if (act.dataset.act === "open") {
      editTask(id);
      return;
    }
    const index = getTasks().findIndex((t) => t.id === id);
    if (index < 0) return;
    const before = structuredClone(getTasks()[index]);
    toggleTask(id);
    showToast("Done", { actionLabel: "Undo", onAction: () => restoreTask(before, index) });
  });

  subscribe(render);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") render(); // a new day starts with an empty list
  });
  render();
}