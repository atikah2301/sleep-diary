import { supabase } from "./supabase-client.js";
import { computeMetrics } from "./metrics.js";

const COLUMNS = [
  { key: "entry_date", label: "Date" },
  { key: "dayOfWeek", label: "Day", optional: "day" },
  { key: "bed_time", label: "Bed" },
  { key: "sleep_time", label: "Asleep" },
  { key: "timeToSleep", label: "Time to sleep (min)", optional: "timeToSleep" },
  { key: "awakenings_count", label: "Wakes" },
  { key: "awake_minutes", label: "Awake min" },
  { key: "wake_time", label: "Wake" },
  { key: "rising_time", label: "Up" },
  { key: "timeToRise", label: "Time to rise (min)", optional: "timeToRise" },
  { key: "tag", label: "Tag" },
  { key: "sleep_location", label: "Location" },
  { key: "timeInBedMinutes", label: "Time in bed (min)" },
  { key: "timeInBedHm", label: "Time in bed (h/m)", optional: "conversions" },
  { key: "totalSleepTimeMinutes", label: "Total sleep time (min)" },
  { key: "totalSleepTimeHm", label: "Total sleep time (h/m)", optional: "conversions" },
  { key: "sleepEfficiencyPct", label: "Efficiency" },
  { key: "notes", label: "Notes" },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
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
    case "dayOfWeek":
      return dayOfWeekAbbr(row.entry_date);
    case "timeToSleep":
      return row.metrics.sleepOnsetLatencyMinutes ?? "";
    case "timeToRise":
      return row.metrics.awakeAfterWakingMinutes ?? "";
    case "timeInBedMinutes":
      return row.metrics.timeInBedMinutes ?? "";
    case "totalSleepTimeMinutes":
      return row.metrics.totalSleepTimeMinutes ?? "";
    case "timeInBedHm":
      return formatHoursMinutes(row.metrics.timeInBedMinutes);
    case "totalSleepTimeHm":
      return formatHoursMinutes(row.metrics.totalSleepTimeMinutes);
    case "sleepEfficiencyPct":
      return row.metrics.sleepEfficiencyPct === null
        ? ""
        : `${row.metrics.sleepEfficiencyPct.toFixed(1)}%`;
    default:
      return row[key] ?? "";
  }
}

function sortValue(row, key) {
  switch (key) {
    case "dayOfWeek":
      return row.entry_date;
    case "sleepEfficiencyPct":
      return row.metrics.sleepEfficiencyPct ?? -Infinity;
    case "timeToSleep":
      return row.metrics.sleepOnsetLatencyMinutes ?? -Infinity;
    case "timeToRise":
      return row.metrics.awakeAfterWakingMinutes ?? -Infinity;
    case "timeInBedMinutes":
      return row.metrics.timeInBedMinutes ?? -Infinity;
    case "totalSleepTimeMinutes":
      return row.metrics.totalSleepTimeMinutes ?? -Infinity;
    case "timeInBedHm":
      return row.metrics.timeInBedMinutes ?? -Infinity;
    case "totalSleepTimeHm":
      return row.metrics.totalSleepTimeMinutes ?? -Infinity;
    default: {
      const value = row[key];
      if (typeof value === "number") return value;
      return value ?? "";
    }
  }
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
      <button type="button" id="week-today" class="secondary">Jump to this week</button>
      <p class="hint" style="margin: 0 0 12px">Select a row to open it for editing. Select a column header to sort.</p>
      <div class="checkbox-group">
        <label class="checkbox-label"><input type="checkbox" id="table-toggle-day" /> Show day</label>
        <label class="checkbox-label"><input type="checkbox" id="table-toggle-conversions" /> Show conversions</label>
        <label class="checkbox-label"><input type="checkbox" id="table-toggle-time-to-sleep" /> Show time to sleep</label>
        <label class="checkbox-label"><input type="checkbox" id="table-toggle-time-to-rise" /> Show time to rise</label>
      </div>
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
  const todayBtn = container.querySelector("#week-today");
  const dayToggle = container.querySelector("#table-toggle-day");
  const conversionsToggle = container.querySelector("#table-toggle-conversions");
  const timeToSleepToggle = container.querySelector("#table-toggle-time-to-sleep");
  const timeToRiseToggle = container.querySelector("#table-toggle-time-to-rise");

  let rows = [];
  let sortKey = "entry_date";
  let sortDir = 1;
  let weekStart = mondayOf(toDateStr(new Date()));

  function activeColumns() {
    return COLUMNS.filter((c) => {
      if (c.optional === "day") return dayToggle.checked;
      if (c.optional === "conversions") return conversionsToggle.checked;
      if (c.optional === "timeToSleep") return timeToSleepToggle.checked;
      if (c.optional === "timeToRise") return timeToRiseToggle.checked;
      return true;
    });
  }

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

    const columns = activeColumns();

    const head = `<tr>${columns.map((c) => {
      const arrow = c.key === sortKey ? (sortDir === 1 ? " ▲" : " ▼") : "";
      return `<th data-sort="${c.key}">${c.label}${arrow}</th>`;
    }).join("")}</tr>`;

    const body = sorted
      .map(
        (row) =>
          `<tr data-date="${row.entry_date}">${columns.map(
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

  todayBtn.addEventListener("click", () => {
    weekStart = mondayOf(toDateStr(new Date()));
    render();
  });

  [dayToggle, conversionsToggle, timeToSleepToggle, timeToRiseToggle].forEach((el) =>
    el.addEventListener("change", render),
  );

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
