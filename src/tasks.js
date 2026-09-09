import { scheduleSave } from "./storage.js";

/* ==========================================================================
   Tasks and notepad

   There are always at least three rows, empty and ready to type into, so the
   panel never looks like it is waiting for you to find an Add button. Each
   row is a live text input rather than a label, so a task is edited in place.
   ========================================================================== */

const MIN_TASK_ROWS = 3;

const taskList = document.getElementById("task-list");
const taskAddBtn = document.getElementById("task-add");
export const notepad = document.getElementById("notepad");

// { id, text, done }
export let tasks = [];

function newTask(text) {
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    text: text || "",
    done: false,
  };
}

// Pad up to the minimum so there are always spare rows to type into.
function padTasks() {
  while (tasks.length < MIN_TASK_ROWS) tasks.push(newTask());
}

// See the note on clearBanked() in timer.js.
export function setTasks(list) {
  tasks = list;
}

export function renderTasks() {
  padTasks();
  taskList.innerHTML = "";

  tasks.forEach((task) => {
    const item = document.createElement("li");
    item.className = "task";
    item.classList.toggle("is-done", task.done);

    const check = document.createElement("button");
    check.className = "task-check";
    check.type = "button";
    check.setAttribute("aria-pressed", String(task.done));
    check.setAttribute("aria-label", "Mark complete");
    check.addEventListener("click", () => toggleTask(task.id));

    const input = document.createElement("input");
    input.className = "task-text";
    input.type = "text";
    input.value = task.text;
    input.placeholder = "Type your priority";
    input.autocomplete = "off";
    input.setAttribute("aria-label", "Task");
    // Edited in place: the input is the task.
    input.addEventListener("input", () => {
      task.text = input.value;
    });
    // Enter drops you into the next row, like a list should behave.
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      const inputs = [...taskList.querySelectorAll(".task-text")];
      const next = inputs[inputs.indexOf(input) + 1];
      if (next) next.focus();
      else addTaskRow();
    });

    const remove = document.createElement("button");
    remove.className = "task-delete";
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", "Delete task");
    remove.addEventListener("click", () => deleteTask(task.id));

    item.append(check, input, remove);
    taskList.append(item);
  });
}

function toggleTask(id) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return;
  task.done = !task.done;
  renderTasks();
}

function deleteTask(id) {
  tasks = tasks.filter((t) => t.id !== id);
  renderTasks();
  scheduleSave();
}

function addTaskRow() {
  tasks.push(newTask());
  renderTasks();
  const inputs = taskList.querySelectorAll(".task-text");
  const last = inputs[inputs.length - 1];
  if (last) last.focus();
}


/* Called by main.js once every module has loaded. Doing this at module
   scope instead would run it while other modules were still initialising,
   which is how a circular import turns into a TDZ error. */
export function initTasks() {
  taskAddBtn.addEventListener("click", addTaskRow);
  renderTasks();
}
