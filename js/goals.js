import { addMinutesToClock, parseClockTime } from "./time.js";

const STORAGE_KEY = "sleep-diary-goals";
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

export function getGoals() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_GOALS };
    const parsed = JSON.parse(raw);
    return {
      durationGoalMinutes: Number.isFinite(parsed.durationGoalMinutes)
        ? parsed.durationGoalMinutes
        : DEFAULT_GOALS.durationGoalMinutes,
      efficiencyGoalPct: Number.isFinite(parsed.efficiencyGoalPct)
        ? parsed.efficiencyGoalPct
        : DEFAULT_GOALS.efficiencyGoalPct,
      minWakeTime: validClock(parsed.minWakeTime, DEFAULT_GOALS.minWakeTime),
      maxWakeTime: validClock(parsed.maxWakeTime, DEFAULT_GOALS.maxWakeTime),
    };
  } catch {
    return { ...DEFAULT_GOALS };
  }
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

function setGoals(goals) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(goals));
  window.dispatchEvent(new CustomEvent("goals-updated"));
}

export function initGoalsView(container) {
  const goals = getGoals();

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
      <p id="goal-wake-time-error" class="error-message" hidden></p>
      <p class="hint" id="goal-bed-time-derived"></p>

      <button type="button" class="primary" id="goals-save">Save goals</button>
      <p id="goals-saved-msg" class="form-feedback" hidden>Saved.</p>
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

  durationInput.value = goals.durationGoalMinutes / 60;
  efficiencyInput.value = goals.efficiencyGoalPct;
  minWakeInput.value = goals.minWakeTime;
  maxWakeInput.value = goals.maxWakeTime;

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
  updateWakeTimeValidation();
  updateBedTimeDerived();

  saveBtn.addEventListener("click", () => {
    if (!updateWakeTimeValidation()) return;
    const hours = parseFloat(durationInput.value);
    const pct = parseFloat(efficiencyInput.value);
    setGoals({
      durationGoalMinutes: Number.isFinite(hours)
        ? Math.round(hours * 60)
        : DEFAULT_GOALS.durationGoalMinutes,
      efficiencyGoalPct: Number.isFinite(pct) ? pct : DEFAULT_GOALS.efficiencyGoalPct,
      minWakeTime: validClock(minWakeInput.value, DEFAULT_GOALS.minWakeTime),
      maxWakeTime: validClock(maxWakeInput.value, DEFAULT_GOALS.maxWakeTime),
    });
    updateBedTimeDerived();
    savedMsg.hidden = false;
    setTimeout(() => {
      savedMsg.hidden = true;
    }, 1500);
  });
}
