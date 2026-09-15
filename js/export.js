import { supabase } from "./supabase-client.js";
import { computeMetrics } from "./metrics.js";

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

const COLUMNS = [
  { key: "entry_date", label: "Date" },
  { key: "bed_time", label: "Bed time" },
  { key: "sleep_time", label: "Fell asleep" },
  { key: "awakenings_count", label: "Awakenings" },
  { key: "awake_minutes", label: "Awake minutes" },
  { key: "wake_time", label: "Wake time" },
  { key: "rising_time", label: "Out of bed" },
  { key: "tag", label: "Tag" },
  { key: "notes", label: "Notes" },
  { key: "timeInBedMinutes", label: "Time in bed (min)" },
  { key: "totalSleepTimeMinutes", label: "Total sleep time (min)" },
  { key: "sleepEfficiencyPct", label: "Sleep efficiency %" },
];

function buildRows(entries) {
  return entries.map((entry) => {
    const metrics = computeMetrics(entry);
    return {
      entry_date: entry.entry_date,
      bed_time: entry.bed_time?.slice(0, 5) ?? "",
      sleep_time: entry.sleep_time?.slice(0, 5) ?? "",
      awakenings_count: entry.awakenings_count ?? 0,
      awake_minutes: entry.awake_minutes ?? 0,
      wake_time: entry.wake_time?.slice(0, 5) ?? "",
      rising_time: entry.rising_time?.slice(0, 5) ?? "",
      tag: entry.tag ?? "",
      notes: entry.notes ?? "",
      timeInBedMinutes: metrics.timeInBedMinutes ?? "",
      totalSleepTimeMinutes: metrics.totalSleepTimeMinutes ?? "",
      sleepEfficiencyPct:
        metrics.sleepEfficiencyPct === null ? "" : Number(metrics.sleepEfficiencyPct.toFixed(1)),
    };
  });
}

function downloadExcel(rows, filenameSuffix) {
  const worksheet = XLSX.utils.json_to_sheet(
    rows.map((row) => {
      const ordered = {};
      for (const col of COLUMNS) ordered[col.label] = row[col.key];
      return ordered;
    }),
  );
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Sleep diary");
  XLSX.writeFile(workbook, `sleep-diary-${filenameSuffix}.xlsx`);
}

function renderPreviewTable(container, rows) {
  const table = container.querySelector("#export-preview-table");
  if (rows.length === 0) {
    table.innerHTML = "<tr><td>No entries yet.</td></tr>";
    return;
  }
  const head = `<tr>${COLUMNS.map((c) => `<th>${c.label}</th>`).join("")}</tr>`;
  const body = rows
    .map(
      (row) => `<tr>${COLUMNS.map((c) => `<td>${row[c.key] ?? ""}</td>`).join("")}</tr>`,
    )
    .join("");
  table.innerHTML = head + body;
}

export function initExportView(container) {
  container.innerHTML = `
    <div class="card">
      <label>Export range</label>
      <div class="toggle-group" id="range-mode-toggle">
        <button type="button" data-mode="all" class="active">All</button>
        <button type="button" data-mode="dates">Dates</button>
        <button type="button" data-mode="weeks">Weeks</button>
      </div>
      <div class="field-row" id="range-inputs" hidden>
        <div>
          <label for="range-from" id="range-from-label">From</label>
          <input id="range-from" type="date" />
        </div>
        <div>
          <label for="range-to" id="range-to-label">To</label>
          <input id="range-to" type="date" />
        </div>
      </div>
      <div class="export-buttons">
        <button type="button" id="export-excel" class="primary">Download Excel (.xlsx)</button>
        <button type="button" id="export-pdf" class="secondary">Print / Save as PDF</button>
      </div>
      <p id="export-error" class="error-message" hidden></p>
      <table class="export-preview" id="export-preview-table"></table>
    </div>
  `;

  const errorEl = container.querySelector("#export-error");
  const modeToggle = container.querySelector("#range-mode-toggle");
  const rangeInputs = container.querySelector("#range-inputs");
  const fromInput = container.querySelector("#range-from");
  const toInput = container.querySelector("#range-to");
  const fromLabel = container.querySelector("#range-from-label");
  const toLabel = container.querySelector("#range-to-label");

  let allRows = [];
  let rangeMode = "all";

  function filteredRows() {
    if (rangeMode === "all") return allRows;

    let from = fromInput.value || null;
    let to = toInput.value || null;
    if (rangeMode === "weeks") {
      if (from) from = mondayOf(from);
      if (to) to = addDays(mondayOf(to), 6);
    }

    return allRows.filter((row) => {
      if (from && row.entry_date < from) return false;
      if (to && row.entry_date > to) return false;
      return true;
    });
  }

  function rangeSuffix() {
    if (rangeMode === "all") return "all";
    const rows = filteredRows();
    if (rows.length === 0) return "no-entries";
    return `${rows[0].entry_date}_to_${rows[rows.length - 1].entry_date}`;
  }

  function refresh() {
    renderPreviewTable(container, filteredRows());
  }

  modeToggle.addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-mode]");
    if (!btn) return;
    modeToggle.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
    rangeMode = btn.dataset.mode;
    rangeInputs.hidden = rangeMode === "all";
    fromLabel.textContent = rangeMode === "weeks" ? "From (week commencing)" : "From";
    toLabel.textContent = rangeMode === "weeks" ? "To (week commencing)" : "To";
    refresh();
  });

  fromInput.addEventListener("change", refresh);
  toInput.addEventListener("change", refresh);

  container.querySelector("#export-excel").addEventListener("click", () => {
    const rows = filteredRows();
    if (rows.length === 0) return;
    downloadExcel(rows, rangeSuffix());
  });

  container.querySelector("#export-pdf").addEventListener("click", () => {
    window.print();
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
    allRows = buildRows(data ?? []);
    refresh();
  }

  loadRows();
}
