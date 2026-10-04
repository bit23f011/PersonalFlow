import { todayStr } from "./tasks.js";

const RANK = { high: 0, medium: 1, low: 2 };
const byPriority = (a, b) => RANK[a.priority] - RANK[b.priority];
const byDate = (a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999");

// Which tasks belong to each view
const VIEW_RULES = {
  tasks: () => true,
  today: (t, today) => Boolean(t.dueDate) && (t.dueDate === today || (t.dueDate < today && !t.completed)),
  upcoming: (t, today) => !t.completed && (!t.dueDate || t.dueDate > today),
  completed: (t) => t.completed,
};

// How each view is ordered
const defaultSort = (a, b) => Number(a.completed) - Number(b.completed) || byPriority(a, b) || byDate(a, b);
const SORTERS = {
  tasks: defaultSort,
  today: defaultSort,
  upcoming: (a, b) => byDate(a, b) || byPriority(a, b),
  completed: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
};

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
        (!q || `${t.title} ${t.description} ${t.category}`.toLowerCase().includes(q))
    )
    .sort(SORTERS[view] || defaultSort);
}