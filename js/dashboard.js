import { supabase } from "./supabase-client.js";
import { computeMetrics } from "./metrics.js";
import { minutesSinceNoon, clockFromMinutesSinceNoon } from "./time.js";

const CHART_COLORS = {
  efficiency: "#facc15",
  bed: "#a78bfa",
  sleep: "#38bdf8",
  wake: "#4ade80",
  rise: "#fb923c",
  grid: "#4c4696",
  text: "#b7b3e6",
};

function average(values) {
  const clean = values.filter((v) => v !== null && v !== undefined && !Number.isNaN(v));
  if (clean.length === 0) return null;
  return clean.reduce((a, b) => a + b, 0) / clean.length;
}

function periodKey(entryDate, period) {
  if (period === "day") return entryDate;
  const d = new Date(`${entryDate}T00:00:00`);
  if (period === "week") {
    const day = d.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diffToMonday);
    return d.toISOString().slice(0, 10);
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
        <div class="chart-wrap"><canvas id="times-chart"></canvas></div>
      </div>
    </div>
  `;

  const tagFilter = container.querySelector("#tag-filter");
  const efficiencyToggle = container.querySelector("#efficiency-period-toggle");
  const efficiencyCanvas = container.querySelector("#efficiency-chart");
  const timesCanvas = container.querySelector("#times-chart");

  let rows = [];
  let efficiencyPeriod = "day";
  let efficiencyChart = null;
  let timesChart = null;

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
    if (efficiencyChart) efficiencyChart.destroy();
    efficiencyChart = new Chart(efficiencyCanvas, {
      type: "line",
      data: {
        labels: grouped.map((g) => g.key),
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
          x: { grid: { color: CHART_COLORS.grid }, ticks: { color: CHART_COLORS.text } },
        },
        plugins: { legend: { labels: { color: CHART_COLORS.text } } },
      },
    });
  }

  function renderTimesChart(rowsForChart) {
    const sorted = [...rowsForChart].sort((a, b) => (a.entry_date < b.entry_date ? -1 : 1));
    if (timesChart) timesChart.destroy();
    timesChart = new Chart(timesCanvas, {
      type: "line",
      data: {
        labels: sorted.map((r) => r.entry_date),
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
          x: { grid: { color: CHART_COLORS.grid }, ticks: { color: CHART_COLORS.text } },
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

  function renderAll() {
    const filtered = filteredRows();
    renderSummary(filtered);
    renderEfficiencyChart(filtered);
    renderTimesChart(filtered);
  }

  efficiencyToggle.addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-period]");
    if (!btn) return;
    efficiencyToggle.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
    efficiencyPeriod = btn.dataset.period;
    renderEfficiencyChart(filteredRows());
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
