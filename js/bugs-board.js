import { getBugs } from "./state.js";
import {
  STATUSES, STATUS_LABEL, bugProgress, compareBugs, getProjects, moveBug, restoreBug,
  esc, formatDate, ageText, severityBadge, progressBar, bugHeader,
} from "./bugs-core.js";
import { openBugDialog } from "./bug-dialog.js";
import { registerView } from "./ui.js";
import { showToast } from "./toast.js";

const ARROW_LEFT = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg>';
const ARROW_RIGHT = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
const PLUS_ICON = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';

let root = null;
const filters = { query: "", project: "" };

function visibleBugs() {
  const q = filters.query.trim().toLowerCase();
  return getBugs().filter((b) => {
    if (filters.project && b.project !== filters.project) return false;
    if (!q) return true;
    return `${b.title} ${b.description} ${b.steps} ${b.project}`.toLowerCase().includes(q);
  });
}

function cardHtml(bug, column) {
  const p = bugProgress(bug);
  const foot =
    bug.status === "solved"
      ? `Solved ${formatDate(bug.resolvedAt || bug.updatedAt)}`
      : `${p.total ? `${p.done}/${p.total} steps · ` : ""}${ageText(bug.createdAt)}`;

  return `
    <article class="bug-card sev-${bug.severity}" draggable="true" data-id="${esc(bug.id)}">
      <div class="bug-card-top">
        ${severityBadge(bug.severity)}
        ${bug.project ? `<span class="bug-project">${esc(bug.project)}</span>` : ""}
      </div>
      <p class="bug-card-title">${esc(bug.title)}</p>
      <div class="bug-progress">${progressBar(p.percent)}<span class="progress-label">${p.percent}%</span></div>
      <div class="bug-card-foot">
        <span class="muted">${esc(foot)}</span>
        <span class="bug-moves">
          <button class="icon-btn" type="button" data-move="-1" aria-label="Move left"${column === 0 ? " disabled" : ""}>${ARROW_LEFT}</button>
          <button class="icon-btn" type="button" data-move="1" aria-label="Move right"${column === STATUSES.length - 1 ? " disabled" : ""}>${ARROW_RIGHT}</button>
        </span>
      </div>
    </article>`;
}

function fillProjects() {
  const select = document.getElementById("bugProjectFilter");
  const projects = getProjects();
  select.innerHTML =
    '<option value="">All projects</option>' +
    projects.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join("");
  if (!projects.includes(filters.project)) filters.project = "";
  select.value = filters.project;
}

function render() {
  if (!root) return;
  fillProjects();

  const bugs = visibleBugs();
  document.getElementById("boardCols").innerHTML = STATUSES.map((status, column) => {
    const list = bugs.filter((b) => b.status === status).sort(compareBugs);
    return `
      <section class="board-col" data-status="${status}" aria-label="${STATUS_LABEL[status]}">
        <header class="board-col-head">
          <h3>${STATUS_LABEL[status]} <span class="board-count">${list.length}</span></h3>
          <button class="icon-btn" type="button" data-add="${status}" aria-label="Add a bug to ${STATUS_LABEL[status]}">${PLUS_ICON}</button>
        </header>
        ${list.length ? list.map((b) => cardHtml(b, column)).join("") : '<p class="muted board-empty">No bugs here</p>'}
      </section>`;
  }).join("");
}

// Moves a bug to another column, with Undo
function moveWithUndo(id, status) {
  const list = getBugs();
  const index = list.findIndex((b) => b.id === id);
  if (index < 0 || list[index].status === status) return;
  const before = structuredClone(list[index]);

  moveBug(id, status);
  showToast(`Moved to ${STATUS_LABEL[status]}`, { actionLabel: "Undo", onAction: () => restoreBug(before, index) });
}

export function initBugBoard(element) {
  root = element;
  root.innerHTML = `
    ${bugHeader("board")}
    <div class="bug-toolbar">
      <input class="input" id="bugSearch" type="search" placeholder="Search bugs…" aria-label="Search bugs" />
      <select class="input" id="bugProjectFilter" aria-label="Filter by project"></select>
      <button class="btn btn-primary btn-sm" id="bugNewBoard" type="button">${PLUS_ICON} New bug</button>
    </div>
    <div class="board" id="boardCols"></div>`;

  const cols = document.getElementById("boardCols");

  document.getElementById("bugSearch").addEventListener("input", (e) => {
    filters.query = e.target.value;
    render();
  });
  document.getElementById("bugProjectFilter").addEventListener("change", (e) => {
    filters.project = e.target.value;
    render();
  });
  document.getElementById("bugNewBoard").addEventListener("click", () => openBugDialog());

  cols.addEventListener("click", (e) => {
    const add = e.target.closest("[data-add]");
    if (add) {
      openBugDialog({ status: add.dataset.add });
      return;
    }

    const card = e.target.closest(".bug-card");
    if (!card) return;

    const move = e.target.closest("[data-move]");
    if (move) {
      const bug = getBugs().find((b) => b.id === card.dataset.id);
      const next = STATUSES[STATUSES.indexOf(bug.status) + Number(move.dataset.move)];
      if (next) moveWithUndo(bug.id, next);
      return;
    }
    openBugDialog({ id: card.dataset.id });
  });

  // Drag and drop (computers; phones use the arrow buttons)
  cols.addEventListener("dragstart", (e) => {
    const card = e.target.closest(".bug-card");
    if (!card) return;
    e.dataTransfer.setData("text/plain", card.dataset.id);
    e.dataTransfer.effectAllowed = "move";
    card.classList.add("is-dragging");
  });
  cols.addEventListener("dragend", () => {
    cols.querySelectorAll(".is-dragging, .is-over").forEach((el) => el.classList.remove("is-dragging", "is-over"));
  });
  cols.addEventListener("dragover", (e) => {
    const col = e.target.closest(".board-col");
    if (!col) return;
    e.preventDefault();
    cols.querySelectorAll(".is-over").forEach((el) => el !== col && el.classList.remove("is-over"));
    col.classList.add("is-over");
  });
  cols.addEventListener("drop", (e) => {
    const col = e.target.closest(".board-col");
    if (!col) return;
    e.preventDefault();
    col.classList.remove("is-over");
    const id = e.dataTransfer.getData("text/plain");
    if (id) moveWithUndo(id, col.dataset.status);
  });

  registerView("bugs-board", root, render);
}