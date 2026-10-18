import { getBugs } from "./state.js";
import {
  addBug, updateBug, deleteBug, restoreBug, getBug, getProjects,
  STATUSES, STATUS_LABEL, SEVERITIES, SEVERITY_LABEL, formatDate, esc,
} from "./bugs-core.js";
import { confirmAction } from "./dialogs.js";
import { showToast } from "./toast.js";

const $ = (id) => document.getElementById(id);
const CLOSE_ICON = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';

let editingId = "";

// "- step", "-> step", "1. step" -> "step"
const cleanLine = (line) => line.replace(/^\s*(?:->|=>|[-*•→]|\d+[.)])\s*/, "").trim();

/* ---------- Fix checklist rows ---------- */

function addStepRow({ id = "", title = "", done = false, focus = false, after = null } = {}) {
  const row = document.createElement("div");
  row.className = "subtask-input-row bug-step";
  row.dataset.id = id;
  row.innerHTML =
    '<input class="bug-check" type="checkbox" aria-label="Step done" />' +
    '<input class="input" type="text" maxlength="200" placeholder="Step to fix" autocomplete="off" aria-label="Step" />' +
    `<button class="icon-btn" type="button" data-remove aria-label="Remove step">${CLOSE_ICON}</button>`;
  row.querySelector(".bug-check").checked = done;
  row.querySelector(".input").value = title;

  if (after) after.after(row);
  else $("bugChecklist").appendChild(row);
  if (focus) row.querySelector(".input").focus();
  return row;
}

function readSteps() {
  return [...$("bugChecklist").querySelectorAll(".bug-step")].map((row) => ({
    id: row.dataset.id,
    title: row.querySelector(".input").value,
    done: row.querySelector(".bug-check").checked,
  }));
}

function setSteps(list) {
  $("bugChecklist").innerHTML = "";
  list.forEach((s) => addStepRow({ id: s.id, title: s.title, done: s.done }));
}

/* ---------- Opening ---------- */

function setSeverityStyle(severity) {
  $("bugDialog").className = `modal bug-dialog sev-${severity}`;
}

// Opens the form: for an existing bug ({ id }) or a new one ({ status } = starting column)
export function openBugDialog({ id = "", status = "todo" } = {}) {
  const bug = id ? getBug(id) : null;
  editingId = bug ? bug.id : "";

  $("bugDialogTitle").textContent = bug ? "Edit bug" : "New bug";
  $("bugSave").textContent = bug ? "Save changes" : "Add bug";
  $("bugDelete").hidden = !bug;
  $("bugTitleError").hidden = true;

  $("bugProjects").innerHTML = getProjects().map((p) => `<option value="${esc(p)}"></option>`).join("");

  $("bugTitle").value = bug ? bug.title : "";
  $("bugProject").value = bug ? bug.project : "";
  $("bugSeverity").value = bug ? bug.severity : "medium";
  $("bugStatus").value = bug ? bug.status : status;
  $("bugDescription").value = bug ? bug.description : "";
  $("bugSteps").value = bug ? bug.steps : "";
  setSteps(bug ? bug.checklist : []);
  $("bugLinks").value = bug ? bug.links.join("\n") : "";

  const dates = [];
  if (bug) {
    dates.push(`Created ${formatDate(bug.createdAt)}`);
    if (bug.resolvedAt) dates.push(`Solved ${formatDate(bug.resolvedAt)}`);
  }
  $("bugDates").textContent = dates.join(" · ");

  setSeverityStyle($("bugSeverity").value);
  $("bugDialog").showModal();
  $("bugTitle").focus();
}

/* ---------- Start-up ---------- */

export function initBugDialog() {
  document.body.insertAdjacentHTML(
    "beforeend",
    `
    <dialog class="modal bug-dialog" id="bugDialog" aria-labelledby="bugDialogTitle">
      <form class="modal-form" id="bugForm" novalidate>
        <h2 id="bugDialogTitle">New bug</h2>

        <div class="field">
          <label for="bugTitle">Title</label>
          <input class="input" id="bugTitle" type="text" maxlength="200" placeholder="What is broken?" autocomplete="off" />
          <p class="field-error" id="bugTitleError" hidden>Title is required.</p>
        </div>

        <div class="field-row">
          <div class="field">
            <label for="bugProject">Project</label>
            <input class="input" id="bugProject" type="text" maxlength="40" list="bugProjects" placeholder="e.g. POSaaS" autocomplete="off" />
            <datalist id="bugProjects"></datalist>
          </div>
          <div class="field">
            <label for="bugSeverity">Severity</label>
            <select class="input" id="bugSeverity"></select>
          </div>
        </div>

        <div class="field">
          <label for="bugStatus">Status</label>
          <select class="input" id="bugStatus"></select>
        </div>

        <div class="field">
          <label for="bugDescription">Details</label>
          <textarea class="input" id="bugDescription" rows="3" placeholder="What happens? What should happen?"></textarea>
        </div>

        <div class="field">
          <label for="bugSteps">Steps to reproduce</label>
          <textarea class="input" id="bugSteps" rows="3" placeholder="1. Open the login page&#10;2. Press Sign in"></textarea>
        </div>

        <div class="field" role="group" aria-labelledby="bugChecklistLabel">
          <span class="field-label" id="bugChecklistLabel">Fix checklist</span>
          <div class="subtask-inputs" id="bugChecklist"></div>
          <button class="btn btn-ghost btn-sm" id="bugAddStep" type="button">+ Add step</button>
          <p class="muted">Tick the steps as you finish them. The bug's progress comes from this list.</p>
        </div>

        <div class="field">
          <label for="bugLinks">Links (one per line)</label>
          <textarea class="input" id="bugLinks" rows="2" placeholder="github.com/me/repo/issues/12" spellcheck="false"></textarea>
        </div>

        <p class="muted" id="bugDates"></p>

        <div class="modal-actions bug-actions">
          <button class="btn btn-outline-danger" id="bugDelete" type="button" hidden>Delete</button>
          <span class="bug-spacer"></span>
          <button class="btn btn-ghost" id="bugCancel" type="button">Cancel</button>
          <button class="btn btn-primary" id="bugSave" type="submit">Add bug</button>
        </div>
      </form>
    </dialog>`
  );

  $("bugSeverity").innerHTML = SEVERITIES.map((s) => `<option value="${s}">${SEVERITY_LABEL[s]}</option>`).join("");
  $("bugStatus").innerHTML = STATUSES.map((s) => `<option value="${s}">${STATUS_LABEL[s]}</option>`).join("");

  const dialog = $("bugDialog");
  const box = $("bugChecklist");

  $("bugSeverity").addEventListener("change", (e) => setSeverityStyle(e.target.value));
  $("bugCancel").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close(); // click on the backdrop
  });

  $("bugAddStep").addEventListener("click", () => addStepRow({ focus: true, after: box.lastElementChild }));

  box.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-remove]");
    if (!btn) return;
    const row = btn.closest(".bug-step");
    const neighbour = row.nextElementSibling || row.previousElementSibling;
    row.remove();
    if (neighbour) neighbour.querySelector(".input").focus();
  });

  // Enter adds a new step below (and does not save the form)
  box.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !e.target.matches(".input")) return;
    e.preventDefault();
    addStepRow({ focus: true, after: e.target.closest(".bug-step") });
  });

  // Pasting several lines creates one step per line
  box.addEventListener("paste", (e) => {
    const input = e.target;
    const text = (e.clipboardData || window.clipboardData).getData("text");
    if (!input.matches(".input") || !/\r?\n/.test(text)) return;

    const lines = text.split(/\r?\n/).map(cleanLine).filter(Boolean);
    if (!lines.length) return;
    e.preventDefault();

    let row = input.closest(".bug-step");
    let rest = lines;
    if (!input.value.trim()) {
      input.value = lines[0];
      rest = lines.slice(1);
    }
    rest.forEach((title) => {
      row = addStepRow({ title, after: row });
    });
  });

  $("bugForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const title = $("bugTitle").value.trim();
    if (!title) {
      $("bugTitleError").hidden = false;
      $("bugTitle").focus();
      return;
    }

    const fields = {
      title,
      project: $("bugProject").value,
      severity: $("bugSeverity").value,
      status: $("bugStatus").value,
      description: $("bugDescription").value,
      steps: $("bugSteps").value,
      checklist: readSteps(), // empty steps are ignored
      links: $("bugLinks").value.split(/\r?\n/), // invalid lines are ignored
    };

    const wasSolved = editingId && getBug(editingId) && getBug(editingId).status === "solved";
    if (editingId) updateBug(editingId, fields);
    else addBug(fields);
    dialog.close();
    if (fields.status === "solved" && !wasSolved) showToast("Bug marked as solved. Nice work!");
  });

  $("bugDelete").addEventListener("click", async () => {
    const bug = getBug(editingId);
    if (!bug) return;
    const ok = await confirmAction({
      title: "Delete bug?",
      text: `"${bug.title}" will be deleted. If Google Drive sync is on, the deletion will sync too.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;

    const index = getBugs().findIndex((b) => b.id === bug.id);
    const snapshot = structuredClone(bug);
    deleteBug(bug.id);
    dialog.close();
    showToast("Bug deleted", { actionLabel: "Undo", onAction: () => restoreBug(snapshot, index) });
  });
}