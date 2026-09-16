import { supabase } from "./supabase-client.js";
import { computeMetrics } from "./metrics.js";
import { minutesSinceNoon, clockFromMinutesSinceNoon } from "./time.js";
import { getGoals } from "./goals.js";

const CHART_COLORS = {
  efficiency: "#fb923c",
  duration: "#38bdf8",
  sleep: "#ef4444",
  rise: "#86efac",
  grid: "#475569",
  text: "#94a3b8",
  monday: "#fbbf24",
  goal: "#e2e8f0",
  underslept: "#f87171",
  normalSleep: "#34d399",
  overslept: "#fbbf24",
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

/** Classifies a night's total sleep time against a goal duration, using the goal +/- 1hr
 * as the "normal" band — anything shorter counts as underslept, anything longer as overslept. */
function classifyDurationBucket(totalSleepTimeMinutes, goalMinutes) {
  if (totalSleepTimeMinutes < goalMinutes - 60) return "under";
  if (totalSleepTimeMinutes > goalMinutes + 60) return "over";
  return "normal";
}

function groupBucketsByPeriod(rows, period, goalMinutes) {
  const groups = new Map();
  for (const row of rows) {
    const tst = row.metrics.totalSleepTimeMinutes;
    if (tst === null || tst === undefined || Number.isNaN(tst)) continue;
    const key = periodKey(row.entry_date, period);
    if (!groups.has(key)) groups.set(key, { under: 0, normal: 0, over: 0 });
    groups.get(key)[classifyDurationBucket(tst, goalMinutes)]++;
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, counts]) => ({ key, ...counts }));
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
 * Non-day periods (week/month) keep the raw label and default color.
 *
 * autoSkip is disabled and the skip step is computed from the label count alone (not
 * per-canvas pixel width) — otherwise Chart.js picks a different density on each chart
 * depending on how much plot width its own y-axis labels leave (e.g. wider "7h 30m" duration
 * ticks vs narrower "90%" efficiency ticks), so charts end up showing labels at different
 * frequencies even though they cover the same dates. A fixed step keeps every day chart in
 * sync, and Mondays are always shown regardless of step so the highlight never gets skipped. */
function xAxisTicksOptions(labels, period) {
  if (period !== "day") return { color: CHART_COLORS.text };
  const step = Math.max(1, Math.ceil(labels.length / 12));
  return {
    autoSkip: false,
    color: (ctx) => {
      const label = ctx.tick ? labels[ctx.tick.value] : undefined;
      return label && isMonday(label) ? CHART_COLORS.monday : CHART_COLORS.text;
    },
    callback: (value) => {
      const label = labels[value];
      if (!label) return "";
      return isMonday(label) || value % step === 0 ? formatDayLabel(label) : "";
    },
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

      <div class="card">
        <div class="period-toggle" id="consistency-period-toggle">
          <button type="button" data-period="week" class="active">Week</button>
          <button type="button" data-period="month">Month</button>
        </div>
        <div class="chart-wrap"><canvas id="consistency-chart"></canvas></div>
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
  const consistencyToggle = container.querySelector("#consistency-period-toggle");
  const consistencyCanvas = container.querySelector("#consistency-chart");

  let rows = [];
  let efficiencyPeriod = "day";
  let efficiencyChart = null;
  let durationPeriod = "day";
  let durationChart = null;
  let timesChart = null;
  let timeToSleepChart = null;
  let timeToRiseChart = null;
  let consistencyPeriod = "week";
  let consistencyChart = null;

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
    const { efficiencyGoalPct } = getGoals();
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
          {
            label: "Goal",
            data: labels.map(() => efficiencyGoalPct),
            borderColor: CHART_COLORS.goal,
            borderDash: [6, 4],
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0,
            fill: false,
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
        plugins: {
          legend: { labels: { color: CHART_COLORS.text } },
          tooltip: {
            callbacks: {
              label: (ctx) =>
                `${ctx.dataset.label}: ${ctx.parsed.y === null ? "–" : ctx.parsed.y.toFixed(1) + "%"}`,
            },
          },
        },
      },
    });
  }

  function renderDurationChart(rowsForChart) {
    const grouped = groupByPeriod(rowsForChart, durationPeriod);
    const labels = grouped.map((g) => g.key);
    const { durationGoalMinutes } = getGoals();
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
          {
            label: "Goal",
            data: labels.map(() => durationGoalMinutes),
            borderColor: CHART_COLORS.goal,
            borderDash: [6, 4],
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0,
            fill: false,
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        scales: {
          y: {
            min: 0,
            grid: { color: CHART_COLORS.grid },
            ticks: { color: CHART_COLORS.text, stepSize: 30, callback: (v) => formatMinutes(v) },
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

  /** minutesSinceNoon() alone can go backwards partway through a night: it categorizes
   * any AM-looking clock value as "the far side of midnight" and any PM-looking value as
   * "the near side", which breaks as soon as wake/rising falls after noon (a lie-in) -
   * that point wraps back to a low value instead of continuing to climb, producing a
   * reversed/zero-length bar segment. Unwrapping the already-shifted sequence forces it
   * to keep climbing, the same way unwrapSequence() does for raw clock times elsewhere. */
  function unwrapNightMinutes(bedClock, sleepClock, wakeClock, riseClock) {
    const shifted = [bedClock, sleepClock, wakeClock, riseClock].map(minutesSinceNoon);
    const unwrapped = [shifted[0]];
    for (let i = 1; i < shifted.length; i++) {
      let cur = shifted[i];
      while (cur < unwrapped[i - 1]) cur += 1440;
      unwrapped.push(cur);
    }
    return unwrapped;
  }

  function renderTimesChart(rowsForChart) {
    const sorted = [...rowsForChart].sort((a, b) => (a.entry_date < b.entry_date ? -1 : 1));
    const labels = sorted.map((r) => r.entry_date);
    const unwrapped = sorted.map((r) =>
      unwrapNightMinutes(
        r.bed_time.slice(0, 5),
        r.sleep_time.slice(0, 5),
        r.wake_time.slice(0, 5),
        r.rising_time.slice(0, 5),
      ),
    );
    const bedMins = unwrapped.map((u) => u[0]);
    const sleepMins = unwrapped.map((u) => u[1]);
    const wakeMins = unwrapped.map((u) => u[2]);
    const riseMins = unwrapped.map((u) => u[3]);

    if (timesChart) timesChart.destroy();
    timesChart = new Chart(timesCanvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Time to fall asleep",
            data: bedMins.map((b, i) => [b, sleepMins[i]]),
            backgroundColor: CHART_COLORS.sleep,
            stack: "night",
          },
          {
            label: "Asleep",
            data: sleepMins.map((s, i) => [s, wakeMins[i]]),
            backgroundColor: CHART_COLORS.duration,
            stack: "night",
          },
          {
            label: "Time to get out of bed",
            data: wakeMins.map((w, i) => [w, riseMins[i]]),
            backgroundColor: CHART_COLORS.rise,
            stack: "night",
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        scales: {
          y: {
            stacked: false,
            grid: { color: CHART_COLORS.grid },
            ticks: {
              color: CHART_COLORS.text,
              stepSize: 60,
              callback: (v) => clockFromMinutesSinceNoon(v),
            },
          },
          x: {
            stacked: true,
            grid: { color: CHART_COLORS.grid },
            ticks: xAxisTicksOptions(labels, "day"),
          },
        },
        plugins: {
          legend: { labels: { color: CHART_COLORS.text } },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const [from, to] = ctx.raw;
                return `${ctx.dataset.label}: ${clockFromMinutesSinceNoon(from)} – ${clockFromMinutesSinceNoon(to)}`;
              },
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

  function renderConsistencyChart(rowsForChart) {
    const { durationGoalMinutes } = getGoals();
    const grouped = groupBucketsByPeriod(rowsForChart, consistencyPeriod, durationGoalMinutes);
    const labels = grouped.map((g) => g.key);
    if (consistencyChart) consistencyChart.destroy();
    consistencyChart = new Chart(consistencyCanvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Underslept",
            data: grouped.map((g) => g.under),
            backgroundColor: CHART_COLORS.underslept,
          },
          {
            label: "Normal",
            data: grouped.map((g) => g.normal),
            backgroundColor: CHART_COLORS.normalSleep,
          },
          {
            label: "Overslept",
            data: grouped.map((g) => g.over),
            backgroundColor: CHART_COLORS.overslept,
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        scales: {
          x: {
            stacked: true,
            grid: { color: CHART_COLORS.grid },
            ticks: xAxisTicksOptions(labels, consistencyPeriod),
          },
          y: {
            stacked: true,
            beginAtZero: true,
            ticks: { color: CHART_COLORS.text, precision: 0 },
            grid: { color: CHART_COLORS.grid },
          },
        },
        plugins: {
          legend: { labels: { color: CHART_COLORS.text } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y} night${ctx.parsed.y === 1 ? "" : "s"}`,
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
    renderConsistencyChart(filtered);
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

  consistencyToggle.addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-period]");
    if (!btn) return;
    consistencyToggle.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
    consistencyPeriod = btn.dataset.period;
    renderConsistencyChart(filteredRows());
  });

  tagFilter.addEventListener("change", renderAll);

  window.addEventListener("goals-updated", () => renderAll());

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
