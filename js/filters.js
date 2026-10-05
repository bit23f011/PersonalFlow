import { todayStr } from "./tasks.js";

const RANK = { high: 0, medium: 1, low: 2 };
const byDone = (a, b) => Number(a.completed) - Number(b.completed);
const byPriority = (a, b) => RANK[a.priority] - RANK[b.priority];
const byDate = (a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999");
const byTime = (a, b) => (a.dueTime || "99:99").localeCompare(b.dueTime || "99:99");

// Which tasks belong to each view
const VIEW_RULES = {
  tasks: () => true,
  today: (t, today) => Boolean(t.dueDate) && (t.dueDate === today || (t.dueDate < today && !t.completed)),
  upcoming: (t, today) => !t.completed && (!t.dueDate || t.dueDate > today),
  completed: (t) => t.completed,
};

// How each view is ordered
const SORTERS = {
  tasks: (a, b) => byDone(a, b) || byPriority(a, b) || byDate(a, b) || byTime(a, b),
  today: (a, b) => byDone(a, b) || byDate(a, b) || byTime(a, b) || byPriority(a, b),
  upcoming: (a, b) => byDate(a, b) || byTime(a, b) || byPriority(a, b),
  completed: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
};

// Everything searchable in one lowercase string
function searchText(task) {
  const subtasks = (Array.isArray(task.subtasks) ? task.subtasks : []).map((s) => s.title).join(" ");
  return `${task.title} ${task.description} ${task.category} ${subtasks}`.toLowerCase();
}

export function filterTasks(tasks, { view = "tasks", category = null, highOnly = false, query = "" } = {}) {
  const today = todayStr();
  const q = query.trim().toLowerCase();
  const rule = VIEW_RULES[view] || VIEW_RULES.tasks;

  return tasks
    .filter(
      (t) =>
        rule(t, today) &&
        (!category || t.category === category) &&
        (!highOnly || t.priority === "high") &&
        (!q || searchText(t).includes(q))
    )
    .sort(SORTERS[view] || SORTERS.tasks);
}