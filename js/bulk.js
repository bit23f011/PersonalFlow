import { getTasks } from "./state.js";
import {
  completeTasks, deleteTasks, starTasks, moveToCategory, restoreTasks, getCategories,
} from "./tasks.js";
import { confirmAction } from "./dialogs.js";
import { showToast } from "./toast.js";

const $ = (id) => document.getElementById(id);
const selected = new Set(); // ids of the selected tasks
let selecting = false;
let categorySignature = "";

const plural = (n) => `${n} task${n === 1 ? "" : "s"}`;
const visibleRows = () => [...$("taskList").querySelectorAll(".task")];

// Copies of tasks (with their position) taken before a change, so it can be undone
function snapshots(ids) {
  const set = new Set(ids);
  return getTasks()
    .map((task, index) => ({ task, index }))
    .filter(({ task }) => set.has(task.id))
    .map(({ task, index }) => ({ task: structuredClone(task), index }));
}

function undoToast(message, snaps) {
  showToast(message, { actionLabel: "Undo", onAction: () => restoreTasks(snaps) });
}

function setSelecting(on) {
  selecting = on;
  selected.clear();
  sync();
}

// Brings the page in line with the selection state (runs after every list redraw too)
function sync() {
  if (selecting && $("viewList").hidden) {
    selecting = false; // left the list view
    selected.clear();
  }

  const rows = visibleRows();
  $("viewList").classList.toggle("is-selecting", selecting);
  document.body.classList.toggle("has-bulkbar", selecting);
  $("bulkBar").hidden = !selecting;
  $("selectModeBtn").textContent = selecting ? "Cancel" : "Select";

  if (!selecting) {
    rows.forEach((row) => row.removeAttribute("tabindex"));
    return;
  }

  // Forget tasks that are no longer on screen (filtered out or deleted)
  const visible = new Set(rows.map((row) => row.dataset.id));
  [...selected].forEach((id) => {
    if (!visible.has(id)) selected.delete(id);
  });

  rows.forEach((row) => {
    const on = selected.has(row.dataset.id);
    row.classList.toggle("is-selected", on);
    row.setAttribute("tabindex", "0");
    row.setAttribute("aria-selected", String(on));
  });

  const count = selected.size;
  $("bulkCount").textContent = `${count} selected`;
  document.querySelectorAll("#bulkBar [data-bulk]").forEach((btn) => {
    if (["complete", "star", "delete"].includes(btn.dataset.bulk)) btn.disabled = count === 0;
  });
  $("bulkCategory").disabled = count === 0;

  const tasks = getTasks().filter((t) => selected.has(t.id));
  const allStarred = tasks.length > 0 && tasks.every((t) => t.starred);
  document.querySelector('#bulkBar [data-bulk="star"]').textContent = allStarred ? "Unstar" : "Star";

  // Category list (only rebuilt when it changes, so an open dropdown is not reset)
  const categories = getCategories();
  const signature = categories.join("|");
  if (signature !== categorySignature) {
    categorySignature = signature;
    $("bulkCategory").innerHTML =
      '<option value="">Move to…</option>' +
      categories.map((c) => `<option value="${c.replace(/"/g, "&quot;")}">${c.replace(/</g, "&lt;")}</option>`).join("");
  }
}

function toggleRow(row) {
  const id = row.dataset.id;
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
  sync();
}

async function onBulk(action) {
  if (action === "done") {
    setSelecting(false);
    return;
  }

  if (action === "all") {
    const rows = visibleRows();
    const everything = rows.length > 0 && rows.every((row) => selected.has(row.dataset.id));
    selected.clear();
    if (!everything) rows.forEach((row) => selected.add(row.dataset.id));
    sync();
    return;
  }

  const ids = [...selected];
  if (!ids.length) return;
  const snaps = snapshots(ids);

  if (action === "complete") {
    completeTasks(ids);
    undoToast(`${plural(ids.length)} completed`, snaps);
  } else if (action === "star") {
    const unstar = snaps.every(({ task }) => task.starred);
    starTasks(ids, !unstar);
    undoToast(`${plural(ids.length)} ${unstar ? "unstarred" : "starred"}`, snaps);
  } else if (action === "delete") {
    const ok = await confirmAction({
      title: `Delete ${plural(ids.length)}?`,
      text: "If Google Drive sync is on, the deletion will sync too. You can undo right after.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    deleteTasks(ids);
    undoToast(`${plural(ids.length)} deleted`, snaps);
  }

  selected.clear();
  sync();
}

export function initBulk() {
  // "Select" button next to the task count
  const count = $("listCount");
  const wrap = document.createElement("div");
  wrap.className = "head-actions";
  count.parentElement.appendChild(wrap);
  wrap.appendChild(count);
  wrap.insertAdjacentHTML(
    "beforeend",
    '<button class="btn btn-ghost btn-sm" id="selectModeBtn" type="button">Select</button>'
  );

  // Bulk action bar
  document.body.insertAdjacentHTML(
    "beforeend",
    '<div class="bulkbar" id="bulkBar" role="toolbar" aria-label="Bulk actions" hidden>' +
      '<span class="bulkbar-count" id="bulkCount" aria-live="polite">0 selected</span>' +
      '<button class="btn btn-ghost btn-sm" type="button" data-bulk="all">Select all</button>' +
      '<button class="btn btn-ghost btn-sm" type="button" data-bulk="complete">Complete</button>' +
      '<button class="btn btn-ghost btn-sm" type="button" data-bulk="star">Star</button>' +
      '<select class="input bulk-select" id="bulkCategory" aria-label="Move selected tasks to a category"></select>' +
      '<button class="btn btn-outline-danger btn-sm" type="button" data-bulk="delete">Delete</button>' +
      '<button class="btn btn-primary btn-sm" type="button" data-bulk="done">Done</button>' +
      "</div>"
  );

  $("selectModeBtn").addEventListener("click", () => setSelecting(!selecting));
  $("bulkBar").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-bulk]");
    if (btn) onBulk(btn.dataset.bulk);
  });

  $("bulkCategory").addEventListener("change", (e) => {
    const category = e.target.value;
    e.target.value = "";
    if (!category || !selected.size) return;
    const ids = [...selected];
    const snaps = snapshots(ids);
    moveToCategory(ids, category);
    undoToast(`${plural(ids.length)} moved to ${category}`, snaps);
    selected.clear();
    sync();
  });

  // While selecting, a click anywhere on a task selects it instead of running its normal action
  $("taskList").addEventListener(
    "click",
    (e) => {
      if (!selecting) return;
      const row = e.target.closest(".task");
      if (!row) return;
      e.preventDefault();
      e.stopPropagation();
      toggleRow(row);
    },
    true
  );

  // Keyboard: Enter or Space selects the focused task
  $("taskList").addEventListener("keydown", (e) => {
    if (!selecting || (e.key !== "Enter" && e.key !== " ")) return;
    const row = e.target.closest(".task");
    if (!row || e.target !== row) return;
    e.preventDefault();
    toggleRow(row);
  });

  // Escape leaves select mode (unless a dialog is open)
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && selecting && !document.querySelector("dialog[open]")) setSelecting(false);
  });

  // The task list is redrawn by ui.js on every change: re-apply the selection afterwards
  new MutationObserver(sync).observe($("taskList"), { childList: true });
  new MutationObserver(sync).observe($("viewList"), { attributes: true, attributeFilter: ["hidden"] });
}