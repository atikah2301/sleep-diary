import { supabase } from "./supabase-client.js";
import { computeMetrics } from "./metrics.js";

const COLUMNS = [
  { key: "entry_date", label: "Date" },
  { key: "bed_time", label: "Bed" },
  { key: "sleep_time", label: "Asleep" },
  { key: "awakenings_count", label: "Wakes" },
  { key: "awake_minutes", label: "Awake min" },
  { key: "wake_time", label: "Wake" },
  { key: "rising_time", label: "Up" },
  { key: "tag", label: "Tag" },
  { key: "sleepEfficiencyPct", label: "Efficiency" },
  { key: "notes", label: "Notes" },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Formats a Date's local calendar date as "YYYY-MM-DD" (toISOString would convert to UTC
 * first, silently shifting the date by a day whenever the local UTC offset is non-zero). */
function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Monday (as "YYYY-MM-DD") of the week containing the given date string. */
function mondayOf(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  const day = d.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday);
  return toDateStr(d);
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

function formatWeekHeading(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  const day = String(d.getDate()).padStart(2, "0");
  return `${day}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

function formatValue(row, key) {
  switch (key) {
    case "bed_time":
    case "sleep_time":
    case "wake_time":
    case "rising_time":
      return row[key]?.slice(0, 5) ?? "";
    case "tag":
      return row.tag ?? "";
    case "notes":
      return row.notes ?? "";
    case "sleepEfficiencyPct":
      return row.metrics.sleepEfficiencyPct === null
        ? ""
        : `${row.metrics.sleepEfficiencyPct.toFixed(1)}%`;
    default:
      return row[key] ?? "";
  }
}

function sortValue(row, key) {
  if (key === "sleepEfficiencyPct") return row.metrics.sleepEfficiencyPct ?? -Infinity;
  const value = row[key];
  if (typeof value === "number") return value;
  return value ?? "";
}

function editEntry(date) {
  const entryTabButton = document.querySelector('nav.tabs button[data-tab="entry"]');
  const dateInput = document.querySelector("#entry-date");
  if (!entryTabButton || !dateInput) return;
  entryTabButton.click();
  dateInput.value = date;
  dateInput.dispatchEvent(new Event("change"));
}

export function initTableView(container) {
  container.innerHTML = `
    <div class="card">
      <div class="week-nav">
        <button type="button" id="week-prev" aria-label="Previous week">◀</button>
        <div class="week-nav-label" id="week-label">w/c –</div>
        <button type="button" id="week-next" aria-label="Next week">▶</button>
      </div>
      <p class="hint" style="margin: 0 0 12px">Select a row to open it for editing. Select a column header to sort.</p>
      <p id="table-error" class="error-message" hidden></p>
      <div class="table-scroll">
        <table class="export-preview data-table" id="diary-table"></table>
      </div>
    </div>
  `;

  const errorEl = container.querySelector("#table-error");
  const tableEl = container.querySelector("#diary-table");
  const weekLabel = container.querySelector("#week-label");
  const prevBtn = container.querySelector("#week-prev");
  const nextBtn = container.querySelector("#week-next");

  let rows = [];
  let sortKey = "entry_date";
  let sortDir = 1;
  let weekStart = mondayOf(toDateStr(new Date()));

  function rowsForWeek() {
    const byDate = new Map(rows.map((r) => [r.entry_date, r]));
    return Array.from({ length: 7 }, (_, i) => {
      const date = addDays(weekStart, i);
      return byDate.get(date) ?? { entry_date: date, metrics: { sleepEfficiencyPct: null } };
    });
  }

  function render() {
    weekLabel.textContent = `w/c ${formatWeekHeading(weekStart)}`;

    const sorted = [...rowsForWeek()].sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      if (av < bv) return -1 * sortDir;
      if (av > bv) return 1 * sortDir;
      return 0;
    });

    const head = `<tr>${COLUMNS.map((c) => {
      const arrow = c.key === sortKey ? (sortDir === 1 ? " ▲" : " ▼") : "";
      return `<th data-sort="${c.key}">${c.label}${arrow}</th>`;
    }).join("")}</tr>`;

    const body = sorted
      .map(
        (row) =>
          `<tr data-date="${row.entry_date}">${COLUMNS.map(
            (c) => `<td>${formatValue(row, c.key)}</td>`,
          ).join("")}</tr>`,
      )
      .join("");

    tableEl.innerHTML = head + body;
  }

  prevBtn.addEventListener("click", () => {
    weekStart = addDays(weekStart, -7);
    render();
  });

  nextBtn.addEventListener("click", () => {
    weekStart = addDays(weekStart, 7);
    render();
  });

  tableEl.addEventListener("click", (event) => {
    const th = event.target.closest("th[data-sort]");
    if (th) {
      const key = th.dataset.sort;
      sortDir = key === sortKey ? -sortDir : 1;
      sortKey = key;
      render();
      return;
    }
    const tr = event.target.closest("tr[data-date]");
    if (tr) editEntry(tr.dataset.date);
  });

  async function loadRows() {
    const { data, error } = await supabase
      .from("diary_entries")
      .select("*")
      .order("entry_date", { ascending: true });

    if (error) {
      errorEl.textContent = error.message;
      errorEl.hidden = false;
      return;
    }
    rows = (data ?? []).map((row) => ({ ...row, metrics: computeMetrics(row) }));
    if (rows.length > 0) weekStart = mondayOf(rows[rows.length - 1].entry_date);
    render();
  }

  loadRows();
}
