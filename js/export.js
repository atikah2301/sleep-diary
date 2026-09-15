import { supabase } from "./supabase-client.js";
import { computeMetrics } from "./metrics.js";

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
      <div class="export-controls">
        <label>Export range</label>
        <div class="field-row">
          <div>
            <label for="range-from">From</label>
            <input id="range-from" type="date" />
          </div>
          <div>
            <label for="range-to">To</label>
            <input id="range-to" type="date" />
          </div>
        </div>
        <div class="toggle-group" id="range-shortcuts">
          <button type="button" id="range-all">All</button>
          <button type="button" id="range-clear">Clear selected</button>
        </div>
        <div class="export-buttons">
          <button type="button" id="export-excel" class="primary">Download Excel (.xlsx)</button>
          <button type="button" id="export-pdf" class="secondary">Print / Save as PDF</button>
        </div>
      </div>
      <p id="export-error" class="error-message" hidden></p>
      <p class="hint" id="export-range-summary" style="margin: 0 0 12px"></p>
      <div class="table-scroll">
        <table class="export-preview" id="export-preview-table"></table>
      </div>
    </div>
  `;

  const errorEl = container.querySelector("#export-error");
  const summaryEl = container.querySelector("#export-range-summary");
  const fromInput = container.querySelector("#range-from");
  const toInput = container.querySelector("#range-to");

  let allRows = [];

  function filteredRows() {
    const from = fromInput.value || null;
    const to = toInput.value || null;
    if (!from && !to) return allRows;

    return allRows.filter((row) => {
      if (from && row.entry_date < from) return false;
      if (to && row.entry_date > to) return false;
      return true;
    });
  }

  function rangeSuffix() {
    if (!fromInput.value && !toInput.value) return "all";
    const rows = filteredRows();
    if (rows.length === 0) return "no-entries";
    return `${rows[0].entry_date}_to_${rows[rows.length - 1].entry_date}`;
  }

  function refresh() {
    const rows = filteredRows();
    renderPreviewTable(container, rows);
    if (rows.length === allRows.length) {
      summaryEl.textContent = `Showing all entries (${rows.length}).`;
    } else if (rows.length === 0) {
      summaryEl.textContent = "Showing 0 entries in the selected range.";
    } else {
      const first = rows[0].entry_date;
      const last = rows[rows.length - 1].entry_date;
      summaryEl.textContent = `Showing ${rows.length} entries, ${first} to ${last}.`;
    }
  }

  container.querySelector("#range-all").addEventListener("click", () => {
    if (allRows.length === 0) return;
    fromInput.value = allRows[0].entry_date;
    toInput.value = allRows[allRows.length - 1].entry_date;
    refresh();
  });

  container.querySelector("#range-clear").addEventListener("click", () => {
    fromInput.value = "";
    toInput.value = "";
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
