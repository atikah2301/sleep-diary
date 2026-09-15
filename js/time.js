// Clock-time helpers. All "clock" values are "HH:MM" 24h strings. Bedtimes and the
// times that follow (sleep, wake, rising) can cross midnight, so most of this module
// is about resolving that unambiguously without ever needing full timestamps.

const MINUTES_PER_DAY = 1440;

export function parseClockTime(clock) {
  const [h, m] = clock.split(":").map(Number);
  return h * 60 + m;
}

export function formatClockTime(minutesSinceMidnight) {
  const wrapped =
    ((minutesSinceMidnight % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const h = Math.floor(wrapped / 60);
  const m = Math.round(wrapped % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Given an ordered sequence of clock times that are each chronologically at or
 * after the previous one (e.g. [bed_time, sleep_time, wake_time, rising_time]),
 * returns them as minutes-since-`times[0]`, adding a day wherever needed so the
 * sequence never goes backwards. This is how midnight-crossing is handled
 * everywhere in the app.
 */
export function unwrapSequence(times) {
  const minutes = times.map(parseClockTime);
  const unwrapped = [minutes[0]];
  for (let i = 1; i < minutes.length; i++) {
    let cur = minutes[i];
    while (cur < unwrapped[i - 1]) {
      cur += MINUTES_PER_DAY;
    }
    unwrapped.push(cur);
  }
  return unwrapped;
}

/** Minutes from one clock time to a later one, assuming at most one midnight crossing. */
export function minutesBetweenClocks(fromClock, toClock) {
  const [from, to] = unwrapSequence([fromClock, toClock]);
  return to - from;
}

/** Adds a duration (minutes) to a clock time, wrapping past midnight if needed. */
export function addMinutesToClock(clock, minutesToAdd) {
  return formatClockTime(parseClockTime(clock) + minutesToAdd);
}

/**
 * Re-anchors a clock time to "minutes since the previous noon" instead of
 * "minutes since midnight". Night-time clock values (evening bed times, small-hours
 * wake times) end up on a single continuous scale with no midnight discontinuity,
 * which is what makes averaging/charting bed/wake times across nights work correctly.
 */
export function minutesSinceNoon(clock) {
  const raw = parseClockTime(clock);
  const shifted = raw - 12 * 60;
  return shifted < 0 ? shifted + MINUTES_PER_DAY : shifted;
}

/** Inverse of minutesSinceNoon, for turning chart values back into "HH:MM" labels. */
export function clockFromMinutesSinceNoon(minutes) {
  return formatClockTime(minutes + 12 * 60);
}
