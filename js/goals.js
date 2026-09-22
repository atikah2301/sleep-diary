import { addMinutesToClock, parseClockTime } from "./time.js";
import { supabase } from "./supabase-client.js";

const DEFAULT_GOALS = {
  durationGoalMinutes: 480,
  efficiencyGoalPct: 95,
  minWakeTime: "07:00",
  maxWakeTime: "08:00",
};

const CLOCK_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function validClock(value, fallback) {
  return typeof value === "string" && CLOCK_RE.test(value) ? value : fallback;
}

let cachedGoals = { ...DEFAULT_GOALS };

function mapRowToGoals(row) {
  return {
    durationGoalMinutes: Number.isFinite(row.duration_goal_minutes)
      ? row.duration_goal_minutes
      : DEFAULT_GOALS.durationGoalMinutes,
    efficiencyGoalPct: Number.isFinite(row.efficiency_goal_pct)
      ? row.efficiency_goal_pct
      : DEFAULT_GOALS.efficiencyGoalPct,
    minWakeTime: validClock(row.min_wake_time?.slice(0, 5), DEFAULT_GOALS.minWakeTime),
    maxWakeTime: validClock(row.max_wake_time?.slice(0, 5), DEFAULT_GOALS.maxWakeTime),
  };
}

export function getGoals() {
  return { ...cachedGoals };
}

/** Fetches the singleton goals row from Supabase and refreshes the in-memory cache that
 * getGoals() reads from, so goals stay in sync across devices/browsers. */
export async function loadGoals() {
  const { data, error } = await supabase.from("user_goals").select("*").eq("id", 1).single();
  if (error) return { error };
  cachedGoals = mapRowToGoals(data);
  window.dispatchEvent(new CustomEvent("goals-updated"));
  return { error: null };
}

async function setGoals(goals) {
  const { error } = await supabase
    .from("user_goals")
    .update({
      duration_goal_minutes: goals.durationGoalMinutes,
      efficiency_goal_pct: goals.efficiencyGoalPct,
      min_wake_time: goals.minWakeTime,
      max_wake_time: goals.maxWakeTime,
    })
    .eq("id", 1);
  if (error) return { error };
  cachedGoals = { ...goals };
  window.dispatchEvent(new CustomEvent("goals-updated"));
  return { error: null };
}

/** Derives the bed-time goal range from the wake-time goal range and the duration goal:
 * to hit a given wake time after sleeping for the duration goal, bed time must be that many
 * minutes earlier (wrapping to the previous day, which addMinutesToClock already handles). */
export function getBedTimeGoals(goals) {
  return {
    minBedTime: addMinutesToClock(goals.minWakeTime, -goals.durationGoalMinutes),
    maxBedTime: addMinutesToClock(goals.maxWakeTime, -goals.durationGoalMinutes),
  };
}

export function initGoalsView(container) {
  container.innerHTML = `
    <div class="card">
      <h2>Goals</h2>
      <p class="hint">
        Set your target averages. The Sleep duration chart in Trends shows your duration goal
        as a dashed reference line.
      </p>
      <label for="goal-duration-hours">Average sleep duration goal (hours)</label>
      <input id="goal-duration-hours" type="number" step="0.1" min="0" max="24" />
      <label for="goal-efficiency">Average sleep efficiency goal (%)</label>
      <input id="goal-efficiency" type="number" step="0.1" min="0" max="100" />

      <label for="goal-min-wake-time">Earliest wake time goal</label>
      <input id="goal-min-wake-time" type="time" />
      <label for="goal-max-wake-time">Latest wake time goal</label>
      <input id="goal-max-wake-time" type="time" />
      <p id="goal-wake-time-error" class="error-message" aria-live="polite" hidden></p>
      <p class="hint" id="goal-bed-time-derived"></p>

      <button type="button" class="primary" id="goals-save">Save goals</button>
      <p id="goals-saved-msg" class="form-feedback" aria-live="polite" hidden>Saved.</p>
      <p id="goals-error" class="error-message" aria-live="polite" hidden></p>
    </div>
  `;

  const durationInput = container.querySelector("#goal-duration-hours");
  const efficiencyInput = container.querySelector("#goal-efficiency");
  const minWakeInput = container.querySelector("#goal-min-wake-time");
  const maxWakeInput = container.querySelector("#goal-max-wake-time");
  const wakeTimeErrorEl = container.querySelector("#goal-wake-time-error");
  const bedTimeDerivedEl = container.querySelector("#goal-bed-time-derived");
  const saveBtn = container.querySelector("#goals-save");
  const savedMsg = container.querySelector("#goals-saved-msg");
  const errorEl = container.querySelector("#goals-error");

  function applyGoalsToInputs(goals) {
    durationInput.value = goals.durationGoalMinutes / 60;
    efficiencyInput.value = goals.efficiencyGoalPct;
    minWakeInput.value = goals.minWakeTime;
    maxWakeInput.value = goals.maxWakeTime;
    updateWakeTimeValidation();
    updateBedTimeDerived();
  }

  function wakeTimeOrderValid() {
    if (!CLOCK_RE.test(minWakeInput.value) || !CLOCK_RE.test(maxWakeInput.value)) return true;
    return parseClockTime(minWakeInput.value) < parseClockTime(maxWakeInput.value);
  }

  function updateWakeTimeValidation() {
    const valid = wakeTimeOrderValid();
    wakeTimeErrorEl.hidden = valid;
    if (!valid) wakeTimeErrorEl.textContent = "Earliest wake time goal must be before the latest wake time goal.";
    saveBtn.disabled = !valid;
    return valid;
  }

  function updateBedTimeDerived() {
    const hours = parseFloat(durationInput.value);
    const { minBedTime, maxBedTime } = getBedTimeGoals({
      durationGoalMinutes: Number.isFinite(hours) ? Math.round(hours * 60) : DEFAULT_GOALS.durationGoalMinutes,
      minWakeTime: validClock(minWakeInput.value, DEFAULT_GOALS.minWakeTime),
      maxWakeTime: validClock(maxWakeInput.value, DEFAULT_GOALS.maxWakeTime),
    });
    bedTimeDerivedEl.textContent = `Bed time goal (derived): ${minBedTime}–${maxBedTime}`;
  }

  [durationInput, minWakeInput, maxWakeInput].forEach((el) =>
    el.addEventListener("input", () => {
      updateWakeTimeValidation();
      updateBedTimeDerived();
    }),
  );
  applyGoalsToInputs(getGoals());

  saveBtn.addEventListener("click", async () => {
    if (!updateWakeTimeValidation()) return;
    errorEl.hidden = true;
    const hours = parseFloat(durationInput.value);
    const pct = parseFloat(efficiencyInput.value);
    const { error } = await setGoals({
      durationGoalMinutes: Number.isFinite(hours)
        ? Math.round(hours * 60)
        : DEFAULT_GOALS.durationGoalMinutes,
      efficiencyGoalPct: Number.isFinite(pct) ? pct : DEFAULT_GOALS.efficiencyGoalPct,
      minWakeTime: validClock(minWakeInput.value, DEFAULT_GOALS.minWakeTime),
      maxWakeTime: validClock(maxWakeInput.value, DEFAULT_GOALS.maxWakeTime),
    });
    if (error) {
      errorEl.textContent = error.message;
      errorEl.hidden = false;
      return;
    }
    updateBedTimeDerived();
    savedMsg.hidden = false;
    setTimeout(() => {
      savedMsg.hidden = true;
    }, 1500);
  });

  loadGoals().then(({ error }) => {
    if (error) {
      errorEl.textContent = error.message;
      errorEl.hidden = false;
      return;
    }
    applyGoalsToInputs(getGoals());
  });
}
