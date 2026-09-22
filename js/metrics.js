import { unwrapSequence } from "./time.js";

/**
 * Computes the derived sleep metrics for one diary entry. This is the single
 * source of truth for the formulas — used by the entry form (instant feedback),
 * the trends dashboard, and export. Nothing here is ever persisted to the database;
 * it's always recomputed from the raw stored fields.
 *
 * @param {{bed_time: string, sleep_time: string, wake_time: string, rising_time: string, awake_minutes: number}} entry
 */
export function computeMetrics(entry) {
  const [bed, sleep, wake, rising] = unwrapSequence([
    entry.bed_time,
    entry.sleep_time,
    entry.wake_time,
    entry.rising_time,
  ]);

  const timeInBedMinutes = rising - bed;
  const sleepOnsetLatencyMinutes = sleep - bed;
  const awakeAfterWakingMinutes = rising - wake;
  const awakeMinutes = entry.awake_minutes ?? 0;

  const totalSleepTimeMinutes =
    timeInBedMinutes - sleepOnsetLatencyMinutes - awakeMinutes - awakeAfterWakingMinutes;

  const sleepEfficiencyPct =
    timeInBedMinutes > 0 ? (totalSleepTimeMinutes / timeInBedMinutes) * 100 : null;

  return {
    timeInBedMinutes,
    sleepOnsetLatencyMinutes,
    awakeAfterWakingMinutes,
    totalSleepTimeMinutes,
    sleepEfficiencyPct,
  };
}

function avg(values) {
  const clean = values.filter((v) => v !== null && v !== undefined && !Number.isNaN(v));
  if (clean.length === 0) return null;
  return clean.reduce((a, b) => a + b, 0) / clean.length;
}

/**
 * Computes a weekly summary row matching the paper diary's convention: sleep efficiency
 * is the ratio of the week's average total sleep time to its average time in bed (not an
 * average of nightly efficiency percentages).
 *
 * @param {Array<{metrics: object, awakenings_count?: number, awake_minutes?: number, nap_count?: number, nap_minutes?: number}>} nights
 */
export function computeWeekSummary(nights) {
  const real = nights.filter((n) => n.metrics?.timeInBedMinutes !== undefined);
  if (real.length === 0) return null;

  const avgTimeInBed = avg(real.map((n) => n.metrics.timeInBedMinutes));
  const avgTotalSleepTime = avg(real.map((n) => n.metrics.totalSleepTimeMinutes));

  return {
    nightsCount: real.length,
    metrics: {
      timeInBedMinutes: avgTimeInBed,
      totalSleepTimeMinutes: avgTotalSleepTime,
      sleepEfficiencyPct:
        avgTimeInBed > 0 ? (avgTotalSleepTime / avgTimeInBed) * 100 : null,
      sleepOnsetLatencyMinutes: avg(real.map((n) => n.metrics.sleepOnsetLatencyMinutes)),
      awakeAfterWakingMinutes: avg(real.map((n) => n.metrics.awakeAfterWakingMinutes)),
    },
    awakenings_count: avg(real.map((n) => n.awakenings_count)),
    awake_minutes: avg(real.map((n) => n.awake_minutes)),
    nap_count: avg(real.map((n) => n.nap_count)),
    nap_minutes: avg(real.map((n) => n.nap_minutes)),
  };
}
