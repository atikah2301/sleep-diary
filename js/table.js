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
      <p class="hint" style="margin: 0 0 12px">Tap a row to open it for editing. Tap a column header to sort.</p>
      <p id="table-error" class="error-message" hidden></p>
      <div class="table-scroll">
        <table class="export-preview data-table" id="diary-table"></table>
      </div>
    </div>
  `;

  const errorEl = container.querySelector("#table-error");
  const tableEl = container.querySelector("#diary-table");

  let rows = [];
  let sortKey = "entry_date";
  let sortDir = 1;

  function render() {
    const sorted = [...rows].sort((a, b) => {
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

    const body =
      sorted.length === 0
        ? `<tr><td colspan="${COLUMNS.length}">No entries yet.</td></tr>`
        : sorted
            .map(
              (row) =>
                `<tr data-date="${row.entry_date}">${COLUMNS.map(
                  (c) => `<td>${formatValue(row, c.key)}</td>`,
                ).join("")}</tr>`,
            )
            .join("");

    tableEl.innerHTML = head + body;
  }

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
    render();
  }

  loadRows();
}
