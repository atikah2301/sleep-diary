import { supabase } from "./supabase-client.js";
import { computeMetrics } from "./metrics.js";
import { minutesSinceNoon, clockFromMinutesSinceNoon } from "./time.js";

const CHART_COLORS = {
  efficiency: "#fb923c",
  duration: "#38bdf8",
  bed: "#f472b6",
  sleep: "#ef4444",
  wake: "#22c55e",
  rise: "#86efac",
  grid: "#475569",
  text: "#94a3b8",
  monday: "#fbbf24",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function average(values) {
  const clean = values.filter((v) => v !== null && v !== undefined && !Number.isNaN(v));
  if (clean.length === 0) return null;
  return clean.reduce((a, b) => a + b, 0) / clean.length;
}

/** Formats a Date's local calendar date as "YYYY-MM-DD" (toISOString would convert to UTC
 * first, silently shifting the date by a day whenever the local UTC offset is non-zero). */
function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function periodKey(entryDate, period) {
  if (period === "day") return entryDate;
  const d = new Date(`${entryDate}T00:00:00`);
  if (period === "week") {
    const day = d.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diffToMonday);
    return toDateStr(d);
  }
  return entryDate.slice(0, 7); // month: YYYY-MM
}

function groupByPeriod(rows, period) {
  const groups = new Map();
  for (const row of rows) {
    const key = periodKey(row.entry_date, period);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, entries]) => ({
      key,
      efficiency: average(entries.map((e) => e.metrics.sleepEfficiencyPct)),
      totalSleepTimeMinutes: average(entries.map((e) => e.metrics.totalSleepTimeMinutes)),
      timeInBedMinutes: average(entries.map((e) => e.metrics.timeInBedMinutes)),
    }));
}

function formatMinutes(mins) {
  if (mins === null || mins === undefined) return "–";
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function formatDayLabel(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return `${MONTHS[d.getMonth()]}-${String(d.getDate()).padStart(2, "0")}`;
}

function isMonday(dateStr) {
  return new Date(`${dateStr}T00:00:00`).getDay() === 1;
}

/** X-axis tick options for a "day" resolution axis: labels as "Mon-DD" and Mondays
 * highlighted in a distinct color, so weekly cycles are easier to spot at a glance.
 * Non-day periods (week/month) keep the raw label and default color. */
function xAxisTicksOptions(labels, period) {
  if (period !== "day") return { color: CHART_COLORS.text };
  return {
    color: (ctx) => {
      const label = ctx.tick ? labels[ctx.tick.value] : undefined;
      return label && isMonday(label) ? CHART_COLORS.monday : CHART_COLORS.text;
    },
    callback: (value) => formatDayLabel(labels[value]),
  };
}

export function initDashboardView(container) {
  container.innerHTML = `
    <div class="card">
      <label for="tag-filter">Filter by tag</label>
      <select id="tag-filter">
        <option value="">All entries</option>
        <option value="Office">Office</option>
        <option value="WFH">WFH</option>
        <option value="No alarm">No alarm</option>
        <option value="__none__">Alarm, no particular reason</option>
      </select>

      <div class="summary-grid">
        <div class="stat">
          <div class="value good" id="dash-avg-efficiency">–</div>
          <div class="label">Avg sleep efficiency</div>
        </div>
        <div class="stat">
          <div class="value" id="dash-avg-tst">–</div>
          <div class="label">Avg total sleep time</div>
        </div>
      </div>
    </div>

    <div class="charts-grid">
      <div class="card">
        <div class="period-toggle" id="efficiency-period-toggle">
          <button type="button" data-period="day" class="active">Day</button>
          <button type="button" data-period="week">Week</button>
          <button type="button" data-period="month">Month</button>
        </div>
        <div class="chart-wrap"><canvas id="efficiency-chart"></canvas></div>
      </div>

      <div class="card">
        <div class="period-toggle" id="duration-period-toggle">
          <button type="button" data-period="day" class="active">Day</button>
          <button type="button" data-period="week">Week</button>
          <button type="button" data-period="month">Month</button>
        </div>
        <div class="chart-wrap"><canvas id="duration-chart"></canvas></div>
      </div>

      <div class="card">
        <div class="chart-wrap"><canvas id="times-chart"></canvas></div>
      </div>

      <div class="card">
        <div class="chart-wrap"><canvas id="time-to-sleep-chart"></canvas></div>
      </div>

      <div class="card">
        <div class="chart-wrap"><canvas id="time-to-rise-chart"></canvas></div>
      </div>
    </div>
  `;

  const tagFilter = container.querySelector("#tag-filter");
  const efficiencyToggle = container.querySelector("#efficiency-period-toggle");
  const efficiencyCanvas = container.querySelector("#efficiency-chart");
  const durationToggle = container.querySelector("#duration-period-toggle");
  const durationCanvas = container.querySelector("#duration-chart");
  const timesCanvas = container.querySelector("#times-chart");
  const timeToSleepCanvas = container.querySelector("#time-to-sleep-chart");
  const timeToRiseCanvas = container.querySelector("#time-to-rise-chart");

  let rows = [];
  let efficiencyPeriod = "day";
  let efficiencyChart = null;
  let durationPeriod = "day";
  let durationChart = null;
  let timesChart = null;
  let timeToSleepChart = null;
  let timeToRiseChart = null;

  function filteredRows() {
    if (!tagFilter.value) return rows;
    if (tagFilter.value === "__none__") return rows.filter((r) => !r.tag);
    return rows.filter((r) => r.tag === tagFilter.value);
  }

  function renderSummary(rowsForSummary) {
    const avgEfficiency = average(rowsForSummary.map((r) => r.metrics.sleepEfficiencyPct));
    const avgTst = average(rowsForSummary.map((r) => r.metrics.totalSleepTimeMinutes));
    container.querySelector("#dash-avg-efficiency").textContent =
      avgEfficiency === null ? "–" : `${avgEfficiency.toFixed(1)}%`;
    container.querySelector("#dash-avg-tst").textContent = formatMinutes(avgTst);
  }

  function renderEfficiencyChart(rowsForChart) {
    const grouped = groupByPeriod(rowsForChart, efficiencyPeriod);
    const labels = grouped.map((g) => g.key);
    if (efficiencyChart) efficiencyChart.destroy();
    efficiencyChart = new Chart(efficiencyCanvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Sleep efficiency %",
            data: grouped.map((g) => g.efficiency),
            borderColor: CHART_COLORS.efficiency,
            backgroundColor: CHART_COLORS.efficiency,
            tension: 0.25,
            spanGaps: true,
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        scales: {
          y: {
            min: 0,
            max: 100,
            grid: { color: CHART_COLORS.grid },
            ticks: { color: CHART_COLORS.text, callback: (v) => `${v}%` },
          },
          x: { grid: { color: CHART_COLORS.grid }, ticks: xAxisTicksOptions(labels, efficiencyPeriod) },
        },
        plugins: { legend: { labels: { color: CHART_COLORS.text } } },
      },
    });
  }

  function renderDurationChart(rowsForChart) {
    const grouped = groupByPeriod(rowsForChart, durationPeriod);
    const labels = grouped.map((g) => g.key);
    if (durationChart) durationChart.destroy();
    durationChart = new Chart(durationCanvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Sleep duration",
            data: grouped.map((g) => g.totalSleepTimeMinutes),
            borderColor: CHART_COLORS.duration,
            backgroundColor: CHART_COLORS.duration,
            tension: 0.25,
            spanGaps: true,
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        scales: {
          y: {
            min: 0,
            grid: { color: CHART_COLORS.grid },
            ticks: { color: CHART_COLORS.text, callback: (v) => formatMinutes(v) },
          },
          x: { grid: { color: CHART_COLORS.grid }, ticks: xAxisTicksOptions(labels, durationPeriod) },
        },
        plugins: {
          legend: { labels: { color: CHART_COLORS.text } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${formatMinutes(ctx.parsed.y)}`,
            },
          },
        },
      },
    });
  }

  function renderTimesChart(rowsForChart) {
    const sorted = [...rowsForChart].sort((a, b) => (a.entry_date < b.entry_date ? -1 : 1));
    const labels = sorted.map((r) => r.entry_date);
    if (timesChart) timesChart.destroy();
    timesChart = new Chart(timesCanvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Bed time",
            data: sorted.map((r) => minutesSinceNoon(r.bed_time.slice(0, 5))),
            borderColor: CHART_COLORS.bed,
            backgroundColor: CHART_COLORS.bed,
            tension: 0.25,
            spanGaps: true,
          },
          {
            label: "Fell asleep",
            data: sorted.map((r) => minutesSinceNoon(r.sleep_time.slice(0, 5))),
            borderColor: CHART_COLORS.sleep,
            backgroundColor: CHART_COLORS.sleep,
            tension: 0.25,
            spanGaps: true,
          },
          {
            label: "Wake time",
            data: sorted.map((r) => minutesSinceNoon(r.wake_time.slice(0, 5))),
            borderColor: CHART_COLORS.wake,
            backgroundColor: CHART_COLORS.wake,
            tension: 0.25,
            spanGaps: true,
          },
          {
            label: "Out of bed",
            data: sorted.map((r) => minutesSinceNoon(r.rising_time.slice(0, 5))),
            borderColor: CHART_COLORS.rise,
            backgroundColor: CHART_COLORS.rise,
            tension: 0.25,
            spanGaps: true,
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        scales: {
          y: {
            grid: { color: CHART_COLORS.grid },
            ticks: {
              color: CHART_COLORS.text,
              callback: (v) => clockFromMinutesSinceNoon(v),
            },
          },
          x: { grid: { color: CHART_COLORS.grid }, ticks: xAxisTicksOptions(labels, "day") },
        },
        plugins: {
          legend: { labels: { color: CHART_COLORS.text } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${clockFromMinutesSinceNoon(ctx.parsed.y)}`,
            },
          },
        },
      },
    });
  }

  function renderMinutesDiffChart(chart, canvas, rowsForChart, label, color, metricsKey) {
    const sorted = [...rowsForChart].sort((a, b) => (a.entry_date < b.entry_date ? -1 : 1));
    const labels = sorted.map((r) => r.entry_date);
    if (chart) chart.destroy();
    return new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label,
            data: sorted.map((r) => r.metrics[metricsKey]),
            borderColor: color,
            backgroundColor: color,
            tension: 0.25,
            spanGaps: true,
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        scales: {
          y: {
            min: 0,
            grid: { color: CHART_COLORS.grid },
            ticks: { color: CHART_COLORS.text, callback: (v) => `${v} min` },
          },
          x: { grid: { color: CHART_COLORS.grid }, ticks: xAxisTicksOptions(labels, "day") },
        },
        plugins: {
          legend: { labels: { color: CHART_COLORS.text } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y} min`,
            },
          },
        },
      },
    });
  }

  function renderAll() {
    const filtered = filteredRows();
    renderSummary(filtered);
    renderEfficiencyChart(filtered);
    renderDurationChart(filtered);
    renderTimesChart(filtered);
    timeToSleepChart = renderMinutesDiffChart(
      timeToSleepChart,
      timeToSleepCanvas,
      filtered,
      "Time to fall asleep",
      CHART_COLORS.sleep,
      "sleepOnsetLatencyMinutes",
    );
    timeToRiseChart = renderMinutesDiffChart(
      timeToRiseChart,
      timeToRiseCanvas,
      filtered,
      "Time to get out of bed",
      CHART_COLORS.rise,
      "awakeAfterWakingMinutes",
    );
  }

  efficiencyToggle.addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-period]");
    if (!btn) return;
    efficiencyToggle.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
    efficiencyPeriod = btn.dataset.period;
    renderEfficiencyChart(filteredRows());
  });

  durationToggle.addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-period]");
    if (!btn) return;
    durationToggle.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
    durationPeriod = btn.dataset.period;
    renderDurationChart(filteredRows());
  });

  tagFilter.addEventListener("change", renderAll);

  loadEntries();

  async function loadEntries() {
    const { data, error } = await supabase
      .from("diary_entries")
      .select("*")
      .order("entry_date", { ascending: true });

    if (error) {
      container.insertAdjacentHTML(
        "afterbegin",
        `<p class="error-message">${error.message}</p>`,
      );
      return;
    }

    rows = (data ?? []).map((row) => ({ ...row, metrics: computeMetrics(row) }));
    renderAll();
  }
}
