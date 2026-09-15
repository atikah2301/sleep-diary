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
