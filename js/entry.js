import { supabase } from "./supabase-client.js";
import { computeMetrics } from "./metrics.js";
import { minutesBetweenClocks, addMinutesToClock } from "./time.js";

function yesterdayISO() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function formatMinutes(mins) {
  if (mins === null || Number.isNaN(mins)) return "–";
  const h = Math.floor(Math.abs(mins) / 60);
  const m = Math.abs(mins) % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

const EMPTY_FORM = {
  bed_time: "",
  sleep_time: "",
  awakenings_count: 0,
  awake_minutes: 0,
  wake_time: "",
  rising_time: "",
  tag: "",
  notes: "",
};

export function initEntryView(container) {
  container.innerHTML = `
    <form id="entry-form" class="card">
      <label for="entry-date">For the night of...</label>
      <input id="entry-date" type="date" required />

      <label for="bed-time">I got into bed at...</label>
      <input id="bed-time" type="time" required />

      <label>Fell asleep</label>
      <div class="toggle-group" id="sleep-mode-toggle">
        <button type="button" data-mode="time" class="active">Exact time</button>
        <button type="button" data-mode="duration">Minutes to fall asleep</button>
      </div>
      <input id="sleep-time-input" type="time" />
      <input id="sleep-duration-input" type="number" min="0" step="1" placeholder="Minutes" hidden />
      <p id="sleep-hint" class="hint"></p>

      <label for="awakenings-count">I woke up ? times in the night...</label>
      <input id="awakenings-count" type="number" min="0" step="1" value="0" />

      <label for="awake-minutes">I was awake in the night for ? minutes...</label>
      <input id="awake-minutes" type="number" min="0" step="1" value="0" />

      <label for="wake-time">My final wake time was...</label>
      <input id="wake-time" type="time" required />

      <label for="rising-time">I got out of bed at...</label>
      <input id="rising-time" type="time" required />

      <label for="tag-select">My wake time was affected by... (optional)</label>
      <select id="tag-select">
        <option value="">Alarm set for other reason</option>
        <option value="Office">Office — waking earlier to commute</option>
        <option value="WFH">WFH — waking before 9am</option>
        <option value="No alarm">No alarm — no plan the next day</option>
      </select>

      <label for="notes">Notes (optional)</label>
      <textarea id="notes" rows="2"></textarea>

      <p id="entry-error" class="error-message" hidden></p>
      <button type="submit" class="primary">Save entry</button>
    </form>

    <div id="entry-summary" class="card" hidden>
      <div class="summary-grid">
        <div class="stat">
          <div class="value" id="stat-tib">–</div>
          <div class="label">Time in bed</div>
        </div>
        <div class="stat">
          <div class="value" id="stat-tst">–</div>
          <div class="label">Total sleep time</div>
        </div>
        <div class="stat" style="grid-column: 1 / -1">
          <div class="value good" id="stat-efficiency">–</div>
          <div class="label">Sleep efficiency</div>
        </div>
      </div>
    </div>
  `;

  const dateInput = container.querySelector("#entry-date");
  const bedTimeInput = container.querySelector("#bed-time");
  const sleepModeToggle = container.querySelector("#sleep-mode-toggle");
  const sleepTimeInput = container.querySelector("#sleep-time-input");
  const sleepDurationInput = container.querySelector("#sleep-duration-input");
  const sleepHint = container.querySelector("#sleep-hint");
  const awakeningsInput = container.querySelector("#awakenings-count");
  const awakeMinutesInput = container.querySelector("#awake-minutes");
  const wakeTimeInput = container.querySelector("#wake-time");
  const risingTimeInput = container.querySelector("#rising-time");
  const tagSelect = container.querySelector("#tag-select");
  const notesInput = container.querySelector("#notes");
  const form = container.querySelector("#entry-form");
  const errorEl = container.querySelector("#entry-error");
  const summaryEl = container.querySelector("#entry-summary");

  let sleepMode = "time";

  function setSleepMode(mode) {
    sleepMode = mode;
    sleepModeToggle.querySelectorAll("button").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === mode);
    });
    sleepTimeInput.hidden = mode !== "time";
    sleepDurationInput.hidden = mode !== "duration";
    updateSleepHint();
  }

  function updateSleepHint() {
    const bedTime = bedTimeInput.value;
    if (!bedTime) {
      sleepHint.textContent = "";
      return;
    }
    try {
      if (sleepMode === "time" && sleepTimeInput.value) {
        const latency = minutesBetweenClocks(bedTime, sleepTimeInput.value);
        sleepHint.textContent = `≈ ${latency} min to fall asleep`;
      } else if (sleepMode === "duration" && sleepDurationInput.value !== "") {
        const latency = Number(sleepDurationInput.value);
        const clock = addMinutesToClock(bedTime, latency);
        sleepHint.textContent = `≈ fell asleep at ${clock}`;
      } else {
        sleepHint.textContent = "";
      }
    } catch {
      sleepHint.textContent = "";
    }
  }

  function resolveSleepTime() {
    const bedTime = bedTimeInput.value;
    if (sleepMode === "time") {
      return sleepTimeInput.value;
    }
    const latency = Number(sleepDurationInput.value || 0);
    return addMinutesToClock(bedTime, latency);
  }

  sleepModeToggle.addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-mode]");
    if (!btn) return;

    // carry the value across when switching modes, so nothing is lost visually
    if (btn.dataset.mode === "duration" && sleepMode === "time" && bedTimeInput.value && sleepTimeInput.value) {
      sleepDurationInput.value = minutesBetweenClocks(bedTimeInput.value, sleepTimeInput.value);
    } else if (btn.dataset.mode === "time" && sleepMode === "duration" && bedTimeInput.value && sleepDurationInput.value !== "") {
      sleepTimeInput.value = addMinutesToClock(bedTimeInput.value, Number(sleepDurationInput.value));
    }

    setSleepMode(btn.dataset.mode);
  });

  [bedTimeInput, sleepTimeInput, sleepDurationInput].forEach((el) =>
    el.addEventListener("input", updateSleepHint),
  );

  function applyEntryToForm(entry) {
    bedTimeInput.value = entry.bed_time?.slice(0, 5) ?? "";
    sleepTimeInput.value = entry.sleep_time?.slice(0, 5) ?? "";
    awakeningsInput.value = entry.awakenings_count ?? 0;
    awakeMinutesInput.value = entry.awake_minutes ?? 0;
    wakeTimeInput.value = entry.wake_time?.slice(0, 5) ?? "";
    risingTimeInput.value = entry.rising_time?.slice(0, 5) ?? "";
    tagSelect.value = entry.tag ?? "";
    notesInput.value = entry.notes ?? "";
    setSleepMode("time");
    updateSleepHint();
    showSummaryIfComplete();
  }

  async function loadEntryForDate(date) {
    errorEl.hidden = true;
    const { data, error } = await supabase
      .from("diary_entries")
      .select("*")
      .eq("entry_date", date)
      .maybeSingle();

    if (error) {
      errorEl.textContent = error.message;
      errorEl.hidden = false;
      return;
    }
    applyEntryToForm(data ?? EMPTY_FORM);
  }

  function currentFormEntry() {
    return {
      bed_time: bedTimeInput.value,
      sleep_time: resolveSleepTime(),
      wake_time: wakeTimeInput.value,
      rising_time: risingTimeInput.value,
      awake_minutes: Number(awakeMinutesInput.value || 0),
    };
  }

  function showSummaryIfComplete() {
    const entry = currentFormEntry();
    if (!entry.bed_time || !entry.sleep_time || !entry.wake_time || !entry.rising_time) {
      summaryEl.hidden = true;
      return;
    }
    const metrics = computeMetrics(entry);
    container.querySelector("#stat-tib").textContent = formatMinutes(metrics.timeInBedMinutes);
    container.querySelector("#stat-tst").textContent = formatMinutes(metrics.totalSleepTimeMinutes);
    container.querySelector("#stat-efficiency").textContent =
      metrics.sleepEfficiencyPct === null ? "–" : `${metrics.sleepEfficiencyPct.toFixed(1)}%`;
    summaryEl.hidden = false;
  }

  dateInput.addEventListener("change", () => loadEntryForDate(dateInput.value));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorEl.hidden = true;

    const payload = {
      entry_date: dateInput.value,
      bed_time: bedTimeInput.value,
      sleep_time: resolveSleepTime(),
      awakenings_count: Number(awakeningsInput.value || 0),
      awake_minutes: Number(awakeMinutesInput.value || 0),
      wake_time: wakeTimeInput.value,
      rising_time: risingTimeInput.value,
      tag: tagSelect.value || null,
      notes: notesInput.value || null,
    };

    const { error } = await supabase
      .from("diary_entries")
      .upsert(payload, { onConflict: "entry_date" });

    if (error) {
      errorEl.textContent = error.message;
      errorEl.hidden = false;
      return;
    }

    showSummaryIfComplete();
  });

  dateInput.value = yesterdayISO();
  loadEntryForDate(dateInput.value);
}
