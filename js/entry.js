import { supabase } from "./supabase-client.js";
import { computeMetrics } from "./metrics.js";
import { minutesBetweenClocks, addMinutesToClock, unwrapSequence } from "./time.js";

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

function formatDateLabel(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

// Plausibility ceilings for each leg of the bed->sleep->wake->rise sequence. unwrapSequence()
// always resolves times forward by adding a day, so a genuine ordering mistake (e.g. sleep
// time typed before bed time) doesn't show up as "negative" - it shows up as an implausibly
// long wrapped gap. These bounds are generous on purpose (long lie-ins, slow mornings) so they
// only catch gaps no real night would produce.
const ORDER_STEPS = [
  { message: "Sleep time can't be before bed time.", maxGapMinutes: 12 * 60 },
  { message: "Wake time can't be before sleep time.", maxGapMinutes: 20 * 60 },
  { message: "Rising time can't be before wake time.", maxGapMinutes: 12 * 60 },
];

function getOrderIssues(bedTime, sleepTime, wakeTime, risingTime) {
  const unwrapped = unwrapSequence([bedTime, sleepTime, wakeTime, risingTime]);
  return ORDER_STEPS.filter((step, i) => unwrapped[i + 1] - unwrapped[i] > step.maxGapMinutes).map(
    (step) => step.message,
  );
}

function validateNonNegativeInteger(inputEl, errorEl) {
  const raw = inputEl.value.trim();
  const value = Number(raw);
  const isValid = raw !== "" && Number.isInteger(value) && value >= 0;
  errorEl.hidden = isValid;
  if (!isValid) errorEl.textContent = "Must be a whole number, 0 or greater.";
  return isValid;
}

const DEFAULT_SLEEP_LOCATION = "In my bed, at home";

const EMPTY_FORM = {
  bed_time: "",
  sleep_time: "",
  awakenings_count: 0,
  awake_minutes: 0,
  wake_time: "",
  rising_time: "",
  tag: "",
  sleep_location: DEFAULT_SLEEP_LOCATION,
  notes: "",
};

export function initEntryView(container) {
  container.innerHTML = `
    <div id="entry-mode-banner" class="mode-banner" hidden>
      <p class="mode-banner-text">Editing entry for <strong id="entry-mode-date"></strong></p>
      <button type="button" id="entry-mode-cancel" class="mode-banner-cancel">Cancel edit</button>
      <p id="entry-mode-cancel-feedback" class="mode-banner-feedback" hidden>Entry left unchanged.</p>
    </div>

    <form id="entry-form" class="card">
      <label for="entry-date">For the night of...</label>
      <input id="entry-date" type="date" required />

      <label for="bed-time">I got into bed at...</label>
      <input id="bed-time" type="time" required />

      <label>I fell asleep at...</label>
      <div class="toggle-group" id="sleep-mode-toggle">
        <button type="button" data-mode="time" class="active">Exact time</button>
        <button type="button" data-mode="duration">Minutes to fall asleep</button>
      </div>
      <input id="sleep-time-input" type="time" />
      <input id="sleep-duration-input" type="number" min="0" step="1" placeholder="Minutes" hidden />
      <p id="sleep-hint" class="hint"></p>

      <label for="awakenings-count">I woke up ? times in the night...</label>
      <input id="awakenings-count" type="number" min="0" step="1" value="0" />
      <p id="awakenings-error" class="error-message" hidden></p>

      <label for="awake-minutes">I was awake in the night for ? minutes...</label>
      <input id="awake-minutes" type="number" min="0" step="1" value="0" />
      <p id="awake-minutes-error" class="error-message" hidden></p>

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

      <label for="sleep-location-select">The place I fell asleep was...</label>
      <select id="sleep-location-select">
        <option value="In my bed, at home">In my bed, at home</option>
        <option value="In a bed, elsewhere">In a bed, elsewhere</option>
        <option value="On the sofa">On the sofa</option>
        <option value="Other">Other</option>
      </select>

      <label for="notes">Notes (optional)</label>
      <textarea id="notes" rows="2"></textarea>

      <p id="entry-error" class="error-message" hidden></p>
      <button type="submit" class="primary" id="entry-submit">Save entry</button>
      <p id="entry-no-changes-msg" class="form-feedback" hidden>No changes to save.</p>
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
  const awakeningsErrorEl = container.querySelector("#awakenings-error");
  const awakeMinutesInput = container.querySelector("#awake-minutes");
  const awakeMinutesErrorEl = container.querySelector("#awake-minutes-error");
  const wakeTimeInput = container.querySelector("#wake-time");
  const risingTimeInput = container.querySelector("#rising-time");
  const tagSelect = container.querySelector("#tag-select");
  const sleepLocationSelect = container.querySelector("#sleep-location-select");
  const notesInput = container.querySelector("#notes");
  const form = container.querySelector("#entry-form");
  const submitBtn = container.querySelector("#entry-submit");
  const errorEl = container.querySelector("#entry-error");
  const summaryEl = container.querySelector("#entry-summary");
  const modeBanner = container.querySelector("#entry-mode-banner");
  const modeDateEl = container.querySelector("#entry-mode-date");
  const modeCancelBtn = container.querySelector("#entry-mode-cancel");
  const cancelFeedbackEl = container.querySelector("#entry-mode-cancel-feedback");
  const entryTabButton = document.querySelector('nav.tabs button[data-tab="entry"]');
  const noChangesMsgEl = container.querySelector("#entry-no-changes-msg");

  let sleepMode = "time";
  let savedSnapshot = null;
  let isDirty = false;
  let showingCancelFeedback = false;
  let cancelFeedbackTimer = null;
  let noChangesTimer = null;

  function setSleepMode(mode) {
    sleepMode = mode;
    sleepModeToggle.querySelectorAll("button").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === mode);
    });
    sleepTimeInput.hidden = mode !== "time";
    sleepDurationInput.hidden = mode !== "duration";
    updateSleepHint();
    updateFormValidity();
    updateEditingState();
  }

  function updateFormValidity() {
    const awakeningsOk = validateNonNegativeInteger(awakeningsInput, awakeningsErrorEl);
    const awakeMinutesOk = validateNonNegativeInteger(awakeMinutesInput, awakeMinutesErrorEl);

    const bedTime = bedTimeInput.value;
    const sleepTime = resolveSleepTime();
    const wakeTime = wakeTimeInput.value;
    const risingTime = risingTimeInput.value;
    const orderIssues =
      bedTime && sleepTime && wakeTime && risingTime
        ? getOrderIssues(bedTime, sleepTime, wakeTime, risingTime)
        : [];

    errorEl.hidden = orderIssues.length === 0;
    if (orderIssues.length > 0) errorEl.textContent = orderIssues.join(" ");

    submitBtn.disabled = !awakeningsOk || !awakeMinutesOk || orderIssues.length > 0;
  }

  function snapshotFromForm() {
    return {
      bed_time: bedTimeInput.value,
      sleep_time: resolveSleepTime(),
      awakenings_count: awakeningsInput.value,
      awake_minutes: awakeMinutesInput.value,
      wake_time: wakeTimeInput.value,
      rising_time: risingTimeInput.value,
      tag: tagSelect.value,
      sleep_location: sleepLocationSelect.value,
      notes: notesInput.value,
    };
  }

  function updateEditingState() {
    const hasExistingEntry = savedSnapshot !== null;
    isDirty = hasExistingEntry && JSON.stringify(snapshotFromForm()) !== JSON.stringify(savedSnapshot);

    let tabLabel = "New entry";
    if (hasExistingEntry) tabLabel = isDirty ? "Edit entry" : "View entry";
    if (entryTabButton) {
      entryTabButton.textContent = tabLabel;
      entryTabButton.classList.toggle("editing", hasExistingEntry && isDirty);
    }
    submitBtn.textContent = hasExistingEntry ? "Update entry" : "Save entry";

    if (hasExistingEntry) modeDateEl.textContent = formatDateLabel(dateInput.value);
    if (!showingCancelFeedback) modeBanner.hidden = !(hasExistingEntry && isDirty);
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

  [bedTimeInput, sleepTimeInput, sleepDurationInput, wakeTimeInput, risingTimeInput].forEach((el) =>
    el.addEventListener("input", () => {
      updateSleepHint();
      updateFormValidity();
      updateEditingState();
    }),
  );

  [awakeningsInput, awakeMinutesInput].forEach((el) =>
    el.addEventListener("input", () => {
      updateFormValidity();
      updateEditingState();
    }),
  );

  tagSelect.addEventListener("change", updateEditingState);
  sleepLocationSelect.addEventListener("change", updateEditingState);
  notesInput.addEventListener("input", updateEditingState);

  function applyEntryToForm(entry) {
    bedTimeInput.value = entry.bed_time?.slice(0, 5) ?? "";
    sleepTimeInput.value = entry.sleep_time?.slice(0, 5) ?? "";
    awakeningsInput.value = entry.awakenings_count ?? 0;
    awakeMinutesInput.value = entry.awake_minutes ?? 0;
    wakeTimeInput.value = entry.wake_time?.slice(0, 5) ?? "";
    risingTimeInput.value = entry.rising_time?.slice(0, 5) ?? "";
    tagSelect.value = entry.tag ?? "";
    sleepLocationSelect.value = entry.sleep_location ?? DEFAULT_SLEEP_LOCATION;
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
    savedSnapshot = data ? snapshotFromForm() : null;
    updateEditingState();
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

  dateInput.addEventListener("change", () => {
    showingCancelFeedback = false;
    clearTimeout(cancelFeedbackTimer);
    cancelFeedbackEl.hidden = true;
    modeCancelBtn.hidden = false;
    loadEntryForDate(dateInput.value);
  });

  modeCancelBtn.addEventListener("click", () => {
    if (!savedSnapshot) return;
    applyEntryToForm(savedSnapshot);
    updateFormValidity();

    showingCancelFeedback = true;
    clearTimeout(cancelFeedbackTimer);
    updateEditingState();
    modeCancelBtn.hidden = true;
    cancelFeedbackEl.hidden = false;
    modeBanner.hidden = false;

    cancelFeedbackTimer = setTimeout(() => {
      showingCancelFeedback = false;
      cancelFeedbackEl.hidden = true;
      modeCancelBtn.hidden = false;
      updateEditingState();
    }, 2000);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorEl.hidden = true;

    if (savedSnapshot && !isDirty) {
      clearTimeout(noChangesTimer);
      noChangesMsgEl.hidden = false;
      noChangesTimer = setTimeout(() => {
        noChangesMsgEl.hidden = true;
      }, 2000);
      return;
    }

    const payload = {
      entry_date: dateInput.value,
      bed_time: bedTimeInput.value,
      sleep_time: resolveSleepTime(),
      awakenings_count: Number(awakeningsInput.value || 0),
      awake_minutes: Number(awakeMinutesInput.value || 0),
      wake_time: wakeTimeInput.value,
      rising_time: risingTimeInput.value,
      tag: tagSelect.value || null,
      sleep_location: sleepLocationSelect.value,
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

    savedSnapshot = snapshotFromForm();
    updateEditingState();
    showSummaryIfComplete();
  });

  dateInput.value = yesterdayISO();
  loadEntryForDate(dateInput.value);
}
