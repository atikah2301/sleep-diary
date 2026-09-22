import { supabase } from "./supabase-client.js";
import { computeMetrics, computeWeekSummary } from "./metrics.js";
import { addTopScrollbar } from "./table-scroll-sync.js";
import { groupByWeek, formatWeekHeading } from "./date.js";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dayOfWeekAbbr(dateStr) {
  return WEEKDAYS[new Date(`${dateStr}T00:00:00`).getDay()];
}

function formatHoursMinutes(mins) {
  if (mins === null || mins === undefined || Number.isNaN(mins)) return "";
  const sign = mins < 0 ? "-" : "";
  const abs = Math.abs(mins);
  return `${sign}${Math.floor(abs / 60)}h ${abs % 60}`;
}

const COLUMNS = [
  { key: "entry_date", label: "Date" },
  { key: "dayOfWeek", label: "Day", optional: "day" },
  { key: "bed_time", label: "Bed time" },
  { key: "sleep_time", label: "Fell asleep" },
  { key: "timeToSleep", label: "Time to sleep (min)", optional: "timeToSleep" },
  { key: "awakenings_count", label: "Awakenings" },
  { key: "awake_minutes", label: "Awake minutes" },
  { key: "wake_time", label: "Wake time" },
  { key: "rising_time", label: "Out of bed" },
  { key: "timeToRise", label: "Time to rise (min)", optional: "timeToRise" },
  { key: "tag", label: "Tag" },
  { key: "sleep_location", label: "Location" },
  { key: "nap_count", label: "Naps" },
  { key: "nap_minutes", label: "Nap minutes" },
  { key: "notes", label: "Notes" },
  { key: "timeInBedMinutes", label: "Time in bed (min)" },
  { key: "timeInBedHm", label: "Time in bed (h/m)", optional: "conversions" },
  { key: "totalSleepTimeMinutes", label: "Total sleep time (min)" },
  { key: "totalSleepTimeHm", label: "Total sleep time (h/m)", optional: "conversions" },
  { key: "sleepEfficiencyPct", label: "Sleep efficiency %" },
];

function attachMetrics(entries) {
  return entries.map((entry) => ({ ...entry, metrics: computeMetrics(entry) }));
}

function formatRow(entry) {
  const metrics = entry.metrics;
  return {
    entry_date: entry.entry_date,
    dayOfWeek: dayOfWeekAbbr(entry.entry_date),
    bed_time: entry.bed_time?.slice(0, 5) ?? "",
    sleep_time: entry.sleep_time?.slice(0, 5) ?? "",
    timeToSleep: metrics.sleepOnsetLatencyMinutes ?? "",
    awakenings_count: entry.awakenings_count ?? 0,
    awake_minutes: entry.awake_minutes ?? 0,
    wake_time: entry.wake_time?.slice(0, 5) ?? "",
    rising_time: entry.rising_time?.slice(0, 5) ?? "",
    timeToRise: metrics.awakeAfterWakingMinutes ?? "",
    tag: entry.tag ?? "",
    sleep_location: entry.sleep_location ?? "",
    nap_count: entry.nap_count ?? 0,
    nap_minutes: entry.nap_minutes ?? 0,
    notes: entry.notes ?? "",
    timeInBedMinutes: metrics.timeInBedMinutes ?? "",
    timeInBedHm: formatHoursMinutes(metrics.timeInBedMinutes),
    totalSleepTimeMinutes: metrics.totalSleepTimeMinutes ?? "",
    totalSleepTimeHm: formatHoursMinutes(metrics.totalSleepTimeMinutes),
    sleepEfficiencyPct:
      metrics.sleepEfficiencyPct === null ? "" : Number(metrics.sleepEfficiencyPct.toFixed(1)),
  };
}

function buildRows(entries) {
  return attachMetrics(entries).map(formatRow);
}

function formatSummaryRow(summary, weekStart) {
  return {
    entry_date: `Week of ${formatWeekHeading(weekStart)} (${summary.nightsCount} nights)`,
    dayOfWeek: "",
    bed_time: "",
    sleep_time: "",
    timeToSleep: summary.metrics.sleepOnsetLatencyMinutes?.toFixed(1) ?? "",
    awakenings_count: summary.awakenings_count?.toFixed(1) ?? "",
    awake_minutes: summary.awake_minutes?.toFixed(1) ?? "",
    wake_time: "",
    rising_time: "",
    timeToRise: summary.metrics.awakeAfterWakingMinutes?.toFixed(1) ?? "",
    tag: "",
    sleep_location: "",
    nap_count: summary.nap_count?.toFixed(1) ?? "",
    nap_minutes: summary.nap_minutes?.toFixed(1) ?? "",
    notes: "",
    timeInBedMinutes: summary.metrics.timeInBedMinutes?.toFixed(1) ?? "",
    timeInBedHm: formatHoursMinutes(Math.round(summary.metrics.timeInBedMinutes)),
    totalSleepTimeMinutes: summary.metrics.totalSleepTimeMinutes?.toFixed(1) ?? "",
    totalSleepTimeHm: formatHoursMinutes(Math.round(summary.metrics.totalSleepTimeMinutes)),
    sleepEfficiencyPct:
      summary.metrics.sleepEfficiencyPct === null ? "" : `${summary.metrics.sleepEfficiencyPct.toFixed(1)}%`,
    isSummaryRow: true,
  };
}

function withWeeklySummaries(entries) {
  const withMetrics = attachMetrics(entries);
  const weeks = groupByWeek(withMetrics);
  return weeks.flatMap(({ weekStart, rows }) => {
    const formatted = rows.map(formatRow);
    const summary = computeWeekSummary(rows);
    return summary ? [...formatted, formatSummaryRow(summary, weekStart)] : formatted;
  });
}

function downloadExcel(rows, filenameSuffix, columns) {
  const worksheet = XLSX.utils.json_to_sheet(
    rows.map((row) => {
      const ordered = {};
      for (const col of columns) ordered[col.label] = row[col.key];
      return ordered;
    }),
  );
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Sleep diary");
  XLSX.writeFile(workbook, `sleep-diary-${filenameSuffix}.xlsx`);
}

function stickyClass(key) {
  if (key === "entry_date") return "sticky-col sticky-col-1";
  if (key === "dayOfWeek") return "sticky-col sticky-col-2";
  return "";
}

function renderPreviewTable(container, rows, columns) {
  const table = container.querySelector("#export-preview-table");
  if (rows.length === 0) {
    table.innerHTML = "<tr><td>No entries yet.</td></tr>";
    return;
  }
  const head = `<tr>${columns.map((c) => `<th class="${stickyClass(c.key)}">${c.label}</th>`).join("")}</tr>`;
  const body = rows
    .map(
      (row) =>
        `<tr class="${row.isSummaryRow ? "summary-row" : ""}">${columns
          .map((c) => `<td class="${stickyClass(c.key)}">${row[c.key] ?? ""}</td>`)
          .join("")}</tr>`,
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
        <label>Columns</label>
        <div class="checkbox-group">
          <label class="checkbox-label"><input type="checkbox" id="toggle-day" /> Show day</label>
          <label class="checkbox-label"><input type="checkbox" id="toggle-conversions" /> Show conversions</label>
          <label class="checkbox-label"><input type="checkbox" id="toggle-time-to-sleep" /> Show time to sleep</label>
          <label class="checkbox-label"><input type="checkbox" id="toggle-time-to-rise" /> Show time to rise</label>
          <label class="checkbox-label"><input type="checkbox" id="toggle-weekly-summary" /> Show weekly totals/averages</label>
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
  const dayToggle = container.querySelector("#toggle-day");
  const conversionsToggle = container.querySelector("#toggle-conversions");
  const timeToSleepToggle = container.querySelector("#toggle-time-to-sleep");
  const timeToRiseToggle = container.querySelector("#toggle-time-to-rise");
  const weeklySummaryToggle = container.querySelector("#toggle-weekly-summary");

  addTopScrollbar(container.querySelector(".table-scroll"), container.querySelector("#export-preview-table"));

  let allEntries = [];

  function activeColumns() {
    return COLUMNS.filter((c) => {
      if (c.optional === "day") return dayToggle.checked;
      if (c.optional === "conversions") return conversionsToggle.checked;
      if (c.optional === "timeToSleep") return timeToSleepToggle.checked;
      if (c.optional === "timeToRise") return timeToRiseToggle.checked;
      return true;
    });
  }

  function filteredEntries() {
    const from = fromInput.value || null;
    const to = toInput.value || null;
    if (!from && !to) return allEntries;

    return allEntries.filter((entry) => {
      if (from && entry.entry_date < from) return false;
      if (to && entry.entry_date > to) return false;
      return true;
    });
  }

  function displayRows() {
    const entries = filteredEntries();
    return weeklySummaryToggle.checked ? withWeeklySummaries(entries) : buildRows(entries);
  }

  function rangeSuffix() {
    if (!fromInput.value && !toInput.value) return "all";
    const entries = filteredEntries();
    if (entries.length === 0) return "no-entries";
    return `${entries[0].entry_date}_to_${entries[entries.length - 1].entry_date}`;
  }

  function refresh() {
    const entries = filteredEntries();
    renderPreviewTable(container, displayRows(), activeColumns());
    if (entries.length === allEntries.length) {
      summaryEl.textContent = `Showing all entries (${entries.length}).`;
    } else if (entries.length === 0) {
      summaryEl.textContent = "Showing 0 entries in the selected range.";
    } else {
      const first = entries[0].entry_date;
      const last = entries[entries.length - 1].entry_date;
      summaryEl.textContent = `Showing ${entries.length} entries, ${first} to ${last}.`;
    }
  }

  container.querySelector("#range-all").addEventListener("click", () => {
    if (allEntries.length === 0) return;
    fromInput.value = allEntries[0].entry_date;
    toInput.value = allEntries[allEntries.length - 1].entry_date;
    refresh();
  });

  container.querySelector("#range-clear").addEventListener("click", () => {
    fromInput.value = "";
    toInput.value = "";
    refresh();
  });

  fromInput.addEventListener("change", refresh);
  toInput.addEventListener("change", refresh);

  [dayToggle, conversionsToggle, timeToSleepToggle, timeToRiseToggle, weeklySummaryToggle].forEach((el) =>
    el.addEventListener("change", refresh),
  );

  container.querySelector("#export-excel").addEventListener("click", () => {
    const rows = displayRows();
    if (rows.length === 0) return;
    downloadExcel(rows, rangeSuffix(), activeColumns());
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
    allEntries = data ?? [];
    refresh();
  }

  loadRows();
}
