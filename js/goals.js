const STORAGE_KEY = "sleep-diary-goals";
const DEFAULT_GOALS = { durationGoalMinutes: 480, efficiencyGoalPct: 95 };

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
    };
  } catch {
    return { ...DEFAULT_GOALS };
  }
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
      <button type="button" class="primary" id="goals-save">Save goals</button>
      <p id="goals-saved-msg" class="hint" hidden>Saved.</p>
    </div>
  `;

  const durationInput = container.querySelector("#goal-duration-hours");
  const efficiencyInput = container.querySelector("#goal-efficiency");
  const saveBtn = container.querySelector("#goals-save");
  const savedMsg = container.querySelector("#goals-saved-msg");

  durationInput.value = goals.durationGoalMinutes / 60;
  efficiencyInput.value = goals.efficiencyGoalPct;

  saveBtn.addEventListener("click", () => {
    const hours = parseFloat(durationInput.value);
    const pct = parseFloat(efficiencyInput.value);
    setGoals({
      durationGoalMinutes: Number.isFinite(hours)
        ? Math.round(hours * 60)
        : DEFAULT_GOALS.durationGoalMinutes,
      efficiencyGoalPct: Number.isFinite(pct) ? pct : DEFAULT_GOALS.efficiencyGoalPct,
    });
    savedMsg.hidden = false;
    setTimeout(() => {
      savedMsg.hidden = true;
    }, 1500);
  });
}
