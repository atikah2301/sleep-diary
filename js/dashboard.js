import { supabase } from "./supabase-client.js";
import { computeMetrics } from "./metrics.js";
import { minutesSinceNoon, clockFromMinutesSinceNoon } from "./time.js";
import { getGoals, getBedTimeGoals } from "./goals.js";
import { mondayOf, addDays, toDateStr } from "./date.js";
import { retryHint } from "./device.js";
import { fetchWithOfflineFallback } from "./offline-cache.js";

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
  nap: "#c084fc",
  wake: "#22d3ee",
  bedtime: "#f472b6",
  trend: "#a78bfa",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const TAG_CATEGORIES = ["", "Office", "WFH", "No alarm"];
const TAG_CATEGORY_LABELS = {
  "": "No particular reason",
  Office: "Office",
  WFH: "WFH",
  "No alarm": "No alarm",
};

const LOCATION_CATEGORIES = ["In my bed, at home", "In a bed, elsewhere", "On the sofa", "Other"];

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

function groupNapCountByPeriod(rows, period) {
  const groups = new Map();
  for (const row of rows) {
    const key = periodKey(row.entry_date, period);
    groups.set(key, (groups.get(key) ?? 0) + (row.nap_count ?? 0));
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, count]) => ({ key, count }));
}

/** Whether a clock time falls within [minClock, maxClock], on the minutesSinceNoon scale
 * so a range spanning midnight (e.g. a bed-time goal of 23:00-00:30) still works. */
function isTimeInRange(clock, minClock, maxClock) {
  let value = minutesSinceNoon(clock);
  let min = minutesSinceNoon(minClock);
  let max = minutesSinceNoon(maxClock);
  if (max < min) max += 1440;
  if (value < min) value += 1440;
  return value >= min && value <= max;
}

function groupTimingConsistencyByPeriod(rows, period, wakeGoals, bedGoals) {
  const groups = new Map();
  for (const row of rows) {
    const key = periodKey(row.entry_date, period);
    if (!groups.has(key)) groups.set(key, { wakeInRange: 0, bedInRange: 0, total: 0 });
    const bucket = groups.get(key);
    bucket.total++;
    if (isTimeInRange(row.wake_time.slice(0, 5), wakeGoals.minWakeTime, wakeGoals.maxWakeTime)) {
      bucket.wakeInRange++;
    }
    if (isTimeInRange(row.bed_time.slice(0, 5), bedGoals.minBedTime, bedGoals.maxBedTime)) {
      bucket.bedInRange++;
    }
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, b]) => ({
      key,
      wakeInRangePct: b.total === 0 ? null : (100 * b.wakeInRange) / b.total,
      bedInRangePct: b.total === 0 ? null : (100 * b.bedInRange) / b.total,
    }));
}

function groupByCategory(rows, categoryKey, categories, defaultValue, goalMinutes) {
  const groups = new Map(categories.map((c) => [c, []]));
  for (const row of rows) {
    const key = row[categoryKey] || defaultValue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return categories.map((key) => {
    const entries = groups.get(key) ?? [];
    const validDurations = entries
      .map((e) => e.metrics.totalSleepTimeMinutes)
      .filter((v) => v !== null && v !== undefined && !Number.isNaN(v));
    const normalCount = validDurations.filter(
      (d) => classifyDurationBucket(d, goalMinutes) === "normal",
    ).length;
    return {
      key,
      count: entries.length,
      efficiency: average(entries.map((e) => e.metrics.sleepEfficiencyPct)),
      duration: average(entries.map((e) => e.metrics.totalSleepTimeMinutes)),
      consistency: validDurations.length === 0 ? null : (100 * normalCount) / validDurations.length,
    };
  });
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
    <div id="dashboard-body">
    <div class="card">
      <p id="dash-loading" class="hint">Loading your sleep data…</p>
      <p id="dash-error" class="error-message" aria-live="polite" hidden></p>
      <label>Date range</label>
      <div class="field-row">
        <div>
          <label for="dash-range-from">From</label>
          <input id="dash-range-from" type="date" />
        </div>
        <div>
          <label for="dash-range-to">To</label>
          <input id="dash-range-to" type="date" />
        </div>
      </div>
      <div class="toggle-group" id="dash-range-shortcuts">
        <button type="button" id="dash-range-all">All time</button>
      </div>

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

    <p id="dash-filtered-empty" class="hint" hidden>No entries in the selected range.</p>

    <div class="charts-grid">
      <div class="card">
        <h2 class="chart-title">Sleep efficiency</h2>
        <div class="period-toggle" id="efficiency-period-toggle">
          <button type="button" data-period="day" class="active">Day</button>
          <button type="button" data-period="week">Week</button>
          <button type="button" data-period="month">Month</button>
        </div>
        <div class="chart-wrap"><canvas id="efficiency-chart"></canvas></div>
      </div>

      <div class="card">
        <h2 class="chart-title">Sleep duration</h2>
        <div class="period-toggle" id="duration-period-toggle">
          <button type="button" data-period="day" class="active">Day</button>
          <button type="button" data-period="week">Week</button>
          <button type="button" data-period="month">Month</button>
        </div>
        <div class="chart-wrap"><canvas id="duration-chart"></canvas></div>
      </div>

      <div class="card">
        <h2 class="chart-title">Sleep timeline</h2>
        <div class="chart-wrap"><canvas id="times-chart"></canvas></div>
      </div>

      <div class="card">
        <h2 class="chart-title">Time to fall asleep (mins)</h2>
        <div class="chart-wrap"><canvas id="time-to-sleep-chart"></canvas></div>
      </div>

      <div class="card">
        <h2 class="chart-title">Time to rise (mins)</h2>
        <div class="chart-wrap"><canvas id="time-to-rise-chart"></canvas></div>
      </div>

      <div class="card">
        <h2 class="chart-title">Sleep consistency</h2>
        <div class="period-toggle" id="consistency-period-toggle">
          <button type="button" data-period="week" class="active">Week</button>
          <button type="button" data-period="month">Month</button>
        </div>
        <div class="chart-wrap"><canvas id="consistency-chart"></canvas></div>
      </div>

      <div class="card">
        <h2 class="chart-title">Wake time</h2>
        <div class="chart-wrap"><canvas id="wake-time-chart"></canvas></div>
      </div>

      <div class="card">
        <h2 class="chart-title">Bed time</h2>
        <div class="chart-wrap"><canvas id="bed-time-chart"></canvas></div>
      </div>

      <div class="card">
        <h2 class="chart-title">Wake &amp; bed time consistency</h2>
        <div class="chart-wrap"><canvas id="timing-consistency-chart"></canvas></div>
      </div>

      <div class="card">
        <h2 class="chart-title">Naps per week</h2>
        <div class="chart-wrap"><canvas id="naps-chart"></canvas></div>
      </div>

      <div class="card">
        <h2 class="chart-title">Wake reason breakdown</h2>
        <div class="chart-wrap"><canvas id="tag-breakdown-chart"></canvas></div>
      </div>

      <div class="card">
        <h2 class="chart-title">Sleep location breakdown</h2>
        <div class="chart-wrap"><canvas id="location-breakdown-chart"></canvas></div>
      </div>
    </div>
    </div>
  `;

  const loadingEl = container.querySelector("#dash-loading");
  const errorEl = container.querySelector("#dash-error");
  const dashboardBodyEl = container.querySelector("#dashboard-body");
  const filteredEmptyEl = container.querySelector("#dash-filtered-empty");
  const chartsGridEl = container.querySelector(".charts-grid");
  const fromInput = container.querySelector("#dash-range-from");
  const toInput = container.querySelector("#dash-range-to");
  const allTimeBtn = container.querySelector("#dash-range-all");
  const tagFilterSelect = container.querySelector("#tag-filter");
  const efficiencyToggle = container.querySelector("#efficiency-period-toggle");
  const efficiencyCanvas = container.querySelector("#efficiency-chart");
  const durationToggle = container.querySelector("#duration-period-toggle");
  const durationCanvas = container.querySelector("#duration-chart");
  const timesCanvas = container.querySelector("#times-chart");
  const timeToSleepCanvas = container.querySelector("#time-to-sleep-chart");
  const timeToRiseCanvas = container.querySelector("#time-to-rise-chart");
  const consistencyToggle = container.querySelector("#consistency-period-toggle");
  const consistencyCanvas = container.querySelector("#consistency-chart");
  const wakeTimeCanvas = container.querySelector("#wake-time-chart");
  const bedTimeCanvas = container.querySelector("#bed-time-chart");
  const timingConsistencyCanvas = container.querySelector("#timing-consistency-chart");
  const napsCanvas = container.querySelector("#naps-chart");
  const tagBreakdownCanvas = container.querySelector("#tag-breakdown-chart");
  const locationBreakdownCanvas = container.querySelector("#location-breakdown-chart");

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
  let wakeTimeChart = null;
  let bedTimeChart = null;
  let timingConsistencyChart = null;
  let napsChart = null;
  let tagBreakdownChart = null;
  let locationBreakdownChart = null;

  function dateFilteredRows() {
    const from = fromInput.value || null;
    const to = toInput.value || null;
    return rows.filter((r) => (!from || r.entry_date >= from) && (!to || r.entry_date <= to));
  }

  function tagFilter(rowsIn) {
    if (!tagFilterSelect.value) return rowsIn;
    if (tagFilterSelect.value === "__none__") return rowsIn.filter((r) => !r.tag);
    return rowsIn.filter((r) => r.tag === tagFilterSelect.value);
  }

  function filteredRows() {
    return tagFilter(dateFilteredRows());
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
    const efficiencyValues = grouped.map((g) => g.efficiency);
    const trend = linearTrendDataset(efficiencyValues);
    if (efficiencyChart) efficiencyChart.destroy();
    efficiencyChart = new Chart(efficiencyCanvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Sleep efficiency %",
            data: efficiencyValues,
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
          ...(trend ? [trend] : []),
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
    const durationValues = grouped.map((g) => g.totalSleepTimeMinutes);
    const trend = linearTrendDataset(durationValues);
    if (durationChart) durationChart.destroy();
    durationChart = new Chart(durationCanvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Sleep duration",
            data: durationValues,
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
          ...(trend ? [trend] : []),
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
            label: "Time to fall asleep (mins)",
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
            label: "Time to rise (mins)",
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
    const values = sorted.map((r) => r.metrics[metricsKey]);
    const trend = linearTrendDataset(values);
    if (chart) chart.destroy();
    return new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label,
            data: values,
            borderColor: color,
            backgroundColor: color,
            tension: 0.25,
            spanGaps: true,
          },
          ...(trend ? [trend] : []),
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

  /** A flat dashed reference-line dataset, matching the existing "Goal" line style used by
   * renderEfficiencyChart/renderDurationChart. */
  /** Ordinary-least-squares fit over the index (not the date), so gaps between entries don't
   * skew the slope - each point counts equally regardless of how many days it's spaced from
   * its neighbours. Returns null when there are fewer than 2 real (non-null) points to fit. */
  function linearTrendDataset(values) {
    const points = values
      .map((v, i) => ({ i, v }))
      .filter((p) => p.v !== null && p.v !== undefined && !Number.isNaN(p.v));
    if (points.length < 2) return null;
    const n = points.length;
    const sumX = points.reduce((s, p) => s + p.i, 0);
    const sumY = points.reduce((s, p) => s + p.v, 0);
    const sumXY = points.reduce((s, p) => s + p.i * p.v, 0);
    const sumXX = points.reduce((s, p) => s + p.i * p.i, 0);
    const denom = n * sumXX - sumX * sumX;
    if (denom === 0) return null;
    const slope = (n * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / n;
    return {
      label: "Trend",
      data: values.map((_, i) => slope * i + intercept),
      borderColor: CHART_COLORS.trend,
      borderDash: [2, 3],
      borderWidth: 2,
      pointRadius: 0,
      tension: 0,
      fill: false,
    };
  }

  function goalLineDataset(label, minutesSinceNoonValue, labels) {
    return {
      label,
      data: labels.map(() => minutesSinceNoonValue),
      borderColor: CHART_COLORS.goal,
      borderDash: [6, 4],
      borderWidth: 1.5,
      pointRadius: 0,
      tension: 0,
      fill: false,
    };
  }

  function clockChartOptions(labels) {
    return {
      maintainAspectRatio: false,
      scales: {
        y: {
          grid: { color: CHART_COLORS.grid },
          ticks: { color: CHART_COLORS.text, stepSize: 60, callback: (v) => clockFromMinutesSinceNoon(v) },
        },
        x: { grid: { color: CHART_COLORS.grid }, ticks: xAxisTicksOptions(labels, "day") },
      },
      plugins: {
        legend: { labels: { color: CHART_COLORS.text } },
        tooltip: {
          callbacks: {
            label: (ctx) =>
              `${ctx.dataset.label}: ${ctx.parsed.y === null ? "–" : clockFromMinutesSinceNoon(ctx.parsed.y)}`,
          },
        },
      },
    };
  }

  function renderWakeTimeChart(rowsForChart) {
    const sorted = [...rowsForChart].sort((a, b) => (a.entry_date < b.entry_date ? -1 : 1));
    const labels = sorted.map((r) => r.entry_date);
    const { minWakeTime, maxWakeTime } = getGoals();
    const wakeValues = sorted.map((r) => minutesSinceNoon(r.wake_time.slice(0, 5)));
    const trend = linearTrendDataset(wakeValues);
    if (wakeTimeChart) wakeTimeChart.destroy();
    wakeTimeChart = new Chart(wakeTimeCanvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Wake time",
            data: wakeValues,
            showLine: false,
            pointRadius: 4,
            pointBackgroundColor: CHART_COLORS.wake,
            borderColor: CHART_COLORS.wake,
          },
          goalLineDataset("Earliest goal", minutesSinceNoon(minWakeTime), labels),
          goalLineDataset("Latest goal", minutesSinceNoon(maxWakeTime), labels),
          ...(trend ? [trend] : []),
        ],
      },
      options: clockChartOptions(labels),
    });
  }

  function renderBedTimeChart(rowsForChart) {
    const sorted = [...rowsForChart].sort((a, b) => (a.entry_date < b.entry_date ? -1 : 1));
    const labels = sorted.map((r) => r.entry_date);
    const { minBedTime, maxBedTime } = getBedTimeGoals(getGoals());
    const bedValues = sorted.map((r) => minutesSinceNoon(r.bed_time.slice(0, 5)));
    const trend = linearTrendDataset(bedValues);
    if (bedTimeChart) bedTimeChart.destroy();
    bedTimeChart = new Chart(bedTimeCanvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Bed time",
            data: bedValues,
            showLine: false,
            pointRadius: 4,
            pointBackgroundColor: CHART_COLORS.bedtime,
            borderColor: CHART_COLORS.bedtime,
          },
          goalLineDataset("Earliest goal", minutesSinceNoon(minBedTime), labels),
          goalLineDataset("Latest goal", minutesSinceNoon(maxBedTime), labels),
          ...(trend ? [trend] : []),
        ],
      },
      options: clockChartOptions(labels),
    });
  }

  function renderTimingConsistencyChart(rowsForChart) {
    const goals = getGoals();
    const bedGoals = getBedTimeGoals(goals);
    const grouped = groupTimingConsistencyByPeriod(rowsForChart, "week", goals, bedGoals);
    const labels = grouped.map((g) => g.key);
    if (timingConsistencyChart) timingConsistencyChart.destroy();
    timingConsistencyChart = new Chart(timingConsistencyCanvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Wake time in range %",
            data: grouped.map((g) => g.wakeInRangePct),
            borderColor: CHART_COLORS.wake,
            backgroundColor: CHART_COLORS.wake,
            tension: 0.25,
            spanGaps: true,
          },
          {
            label: "Bed time in range %",
            data: grouped.map((g) => g.bedInRangePct),
            borderColor: CHART_COLORS.bedtime,
            backgroundColor: CHART_COLORS.bedtime,
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
          x: { grid: { color: CHART_COLORS.grid }, ticks: xAxisTicksOptions(labels, "week") },
        },
        plugins: {
          legend: { labels: { color: CHART_COLORS.text } },
          tooltip: {
            callbacks: {
              label: (ctx) =>
                `${ctx.dataset.label}: ${ctx.parsed.y === null ? "–" : ctx.parsed.y.toFixed(0) + "%"}`,
            },
          },
        },
      },
    });
  }

  function renderNapsChart(rowsForChart) {
    const grouped = groupNapCountByPeriod(rowsForChart, "week");
    const labels = grouped.map((g) => g.key);
    if (napsChart) napsChart.destroy();
    napsChart = new Chart(napsCanvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Naps",
            data: grouped.map((g) => g.count),
            backgroundColor: CHART_COLORS.nap,
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        scales: {
          x: { grid: { color: CHART_COLORS.grid }, ticks: xAxisTicksOptions(labels, "week") },
          y: {
            beginAtZero: true,
            ticks: { color: CHART_COLORS.text, precision: 0 },
            grid: { color: CHART_COLORS.grid },
          },
        },
        plugins: {
          legend: { labels: { color: CHART_COLORS.text } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y} nap${ctx.parsed.y === 1 ? "" : "s"}`,
            },
          },
        },
      },
    });
  }

  function renderBreakdownChart(chart, canvas, grouped, labels) {
    if (chart) chart.destroy();
    return new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Sleep efficiency %",
            data: grouped.map((g) => g.efficiency),
            backgroundColor: CHART_COLORS.efficiency,
            yAxisID: "y",
          },
          {
            label: "Consistency %",
            data: grouped.map((g) => g.consistency),
            backgroundColor: CHART_COLORS.normalSleep,
            yAxisID: "y",
          },
          {
            label: "Sleep duration",
            data: grouped.map((g) => g.duration),
            backgroundColor: CHART_COLORS.duration,
            yAxisID: "y1",
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        scales: {
          x: { grid: { color: CHART_COLORS.grid }, ticks: { color: CHART_COLORS.text } },
          y: {
            min: 0,
            max: 100,
            position: "left",
            grid: { color: CHART_COLORS.grid },
            ticks: { color: CHART_COLORS.text, callback: (v) => `${v}%` },
          },
          y1: {
            min: 0,
            position: "right",
            grid: { drawOnChartArea: false },
            ticks: { color: CHART_COLORS.text, callback: (v) => formatMinutes(v) },
          },
        },
        plugins: {
          legend: { labels: { color: CHART_COLORS.text } },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                if (ctx.parsed.y === null || ctx.parsed.y === undefined) return `${ctx.dataset.label}: –`;
                return ctx.dataset.yAxisID === "y1"
                  ? `${ctx.dataset.label}: ${formatMinutes(ctx.parsed.y)}`
                  : `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%`;
              },
            },
          },
        },
      },
    });
  }

  function renderTagBreakdownChart(rowsForChart) {
    const { durationGoalMinutes } = getGoals();
    const grouped = groupByCategory(rowsForChart, "tag", TAG_CATEGORIES, "", durationGoalMinutes);
    const labels = grouped.map((g) => `${TAG_CATEGORY_LABELS[g.key]} (${g.count})`);
    tagBreakdownChart = renderBreakdownChart(tagBreakdownChart, tagBreakdownCanvas, grouped, labels);
  }

  function renderLocationBreakdownChart(rowsForChart) {
    const { durationGoalMinutes } = getGoals();
    const grouped = groupByCategory(
      rowsForChart,
      "sleep_location",
      LOCATION_CATEGORIES,
      "In my bed, at home",
      durationGoalMinutes,
    );
    const labels = grouped.map((g) => `${g.key} (${g.count})`);
    locationBreakdownChart = renderBreakdownChart(
      locationBreakdownChart,
      locationBreakdownCanvas,
      grouped,
      labels,
    );
  }

  function renderAll() {
    if (rows.length === 0) return;
    const filtered = filteredRows();
    const filteredEmpty = filtered.length === 0;
    filteredEmptyEl.hidden = !filteredEmpty;
    chartsGridEl.hidden = filteredEmpty;
    renderSummary(filtered);
    if (filteredEmpty) return;
    renderEfficiencyChart(filtered);
    renderDurationChart(filtered);
    renderTimesChart(filtered);
    renderConsistencyChart(filtered);
    renderWakeTimeChart(filtered);
    renderBedTimeChart(filtered);
    renderTimingConsistencyChart(filtered);
    renderNapsChart(filtered);
    renderTagBreakdownChart(dateFilteredRows());
    renderLocationBreakdownChart(dateFilteredRows());
    timeToSleepChart = renderMinutesDiffChart(
      timeToSleepChart,
      timeToSleepCanvas,
      filtered,
      "Time to fall asleep (mins)",
      CHART_COLORS.sleep,
      "sleepOnsetLatencyMinutes",
    );
    timeToRiseChart = renderMinutesDiffChart(
      timeToRiseChart,
      timeToRiseCanvas,
      filtered,
      "Time to rise (mins)",
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

  tagFilterSelect.addEventListener("change", renderAll);

  fromInput.value = addDays(mondayOf(toDateStr(new Date())), -21);
  toInput.value = toDateStr(new Date());
  fromInput.addEventListener("change", renderAll);
  toInput.addEventListener("change", renderAll);

  allTimeBtn.addEventListener("click", () => {
    if (rows.length === 0) return;
    fromInput.value = rows[0].entry_date;
    toInput.value = rows[rows.length - 1].entry_date;
    renderAll();
  });

  window.addEventListener("goals-updated", () => renderAll());

  loadEntries();

  async function loadEntries() {
    loadingEl.hidden = false;
    const { data, error } = await fetchWithOfflineFallback("diary_entries", () =>
      supabase.from("diary_entries").select("*").order("entry_date", { ascending: true }),
    );
    loadingEl.hidden = true;

    if (error) {
      errorEl.textContent = `${error.message} ${retryHint()}`;
      errorEl.hidden = false;
      return;
    }

    rows = (data ?? []).map((row) => ({ ...row, metrics: computeMetrics(row) }));
    if (rows.length === 0) {
      dashboardBodyEl.innerHTML = `
        <div class="card">
          <p>No entries yet — add your first night in the Entry tab.</p>
        </div>
      `;
      return;
    }
    renderAll();
  }
}
