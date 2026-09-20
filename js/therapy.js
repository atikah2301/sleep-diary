import { supabase } from "./supabase-client.js";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatNoteMeta(note) {
  if (!note.session_date) return "";
  const d = new Date(`${note.session_date}T00:00:00`);
  const dateLabel = `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  return note.session_time ? `${dateLabel}, ${note.session_time.slice(0, 5)}` : dateLabel;
}

/** Sort key: the session date (at session_time if also given, else start of day) when set,
 * else created_at - a note with no date has no absolute chronological position, so it falls
 * back to when it was added rather than being pinned to one end of the list. */
function sortKey(note) {
  if (note.session_date) {
    const time = note.session_time ? note.session_time.slice(0, 5) : "00:00";
    return new Date(`${note.session_date}T${time}:00`).getTime();
  }
  return new Date(note.created_at).getTime();
}

function sortNewestFirst(notes) {
  return [...notes].sort((a, b) => sortKey(b) - sortKey(a));
}

function displayCardHtml(note) {
  const meta = formatNoteMeta(note);
  return `
    <div class="card therapy-entry" data-id="${note.id}">
      <h3>${note.heading}</h3>
      ${meta ? `<p class="therapy-entry-meta">${meta}</p>` : ""}
      ${note.body ? `<p class="therapy-entry-body">${note.body}</p>` : ""}
    </div>
  `;
}

// Only one note is ever editable at a time, so the edit card's field ids don't need to be
// unique per-note - there's never more than one copy of them in the DOM at once.
function editCardHtml(key) {
  return `
    <div class="card therapy-entry editing" data-edit-id="${key}">
      <label for="therapy-heading">Heading</label>
      <input id="therapy-heading" type="text" required />
      <div class="field-row">
        <div>
          <label for="therapy-date">Date (optional)</label>
          <input id="therapy-date" type="date" />
        </div>
        <div>
          <label for="therapy-time">Time (optional)</label>
          <input id="therapy-time" type="time" />
        </div>
      </div>
      <label for="therapy-body">Notes (optional)</label>
      <textarea id="therapy-body" rows="4"></textarea>
      <p class="error-message" hidden>Heading is required.</p>
      <div class="entry-button-row">
        <button type="button" class="secondary" data-action="cancel">Cancel</button>
        <button type="button" class="primary" data-action="save">Save</button>
      </div>
    </div>
  `;
}

const EMPTY_DRAFT = { heading: "", session_date: "", session_time: "", body: "" };

export function initTherapyView(container) {
  container.innerHTML = `
    <div class="entry-button-row">
      <button type="button" id="therapy-add" class="secondary">Add entry</button>
    </div>
    <div id="therapy-list"></div>
    <p id="therapy-error" class="error-message" hidden></p>
  `;

  const listEl = container.querySelector("#therapy-list");
  const errorEl = container.querySelector("#therapy-error");
  const addBtn = container.querySelector("#therapy-add");

  let notes = [];
  // Which single row is being edited: a note id, or "new" for an unsaved draft. Switching this
  // (clicking a different card, or Add entry, while one is already mid-edit) just discards the
  // in-progress edit - nothing is written to Supabase until Save, so there's nothing to lose.
  let editingId = null;
  let draft = null;

  function render() {
    const cards = [];
    if (editingId === "new") cards.push(editCardHtml("new"));
    for (const note of notes) {
      cards.push(note.id === editingId ? editCardHtml(note.id) : displayCardHtml(note));
    }
    listEl.innerHTML = cards.length ? cards.join("") : `<p class="hint">No therapy notes yet.</p>`;

    if (editingId !== null) wireEditCard();
  }

  function wireEditCard() {
    const card = listEl.querySelector(`[data-edit-id="${editingId}"]`);
    if (!card) return;
    const source = editingId === "new" ? draft : notes.find((n) => n.id === editingId);

    const headingInput = card.querySelector("#therapy-heading");
    const dateInput = card.querySelector("#therapy-date");
    const timeInput = card.querySelector("#therapy-time");
    const bodyInput = card.querySelector("#therapy-body");
    const cardErrorEl = card.querySelector(".error-message");

    headingInput.value = source.heading ?? "";
    dateInput.value = source.session_date ?? "";
    timeInput.value = source.session_time ? source.session_time.slice(0, 5) : "";
    bodyInput.value = source.body ?? "";

    card.querySelector('[data-action="cancel"]').addEventListener("click", () => {
      editingId = null;
      draft = null;
      render();
    });

    card.querySelector('[data-action="save"]').addEventListener("click", async () => {
      const heading = headingInput.value.trim();
      if (!heading) {
        cardErrorEl.hidden = false;
        return;
      }
      cardErrorEl.hidden = true;

      const payload = {
        heading,
        session_date: dateInput.value || null,
        session_time: timeInput.value || null,
        body: bodyInput.value || null,
      };

      const isNew = editingId === "new";
      const { data, error } = isNew
        ? await supabase.from("therapy_notes").insert(payload).select().single()
        : await supabase.from("therapy_notes").update(payload).eq("id", editingId).select().single();

      if (error) {
        errorEl.textContent = error.message;
        errorEl.hidden = false;
        return;
      }
      errorEl.hidden = true;

      if (isNew) {
        notes.push(data);
      } else {
        const idx = notes.findIndex((n) => n.id === editingId);
        notes[idx] = data;
      }
      notes = sortNewestFirst(notes);
      editingId = null;
      draft = null;
      render();
    });
  }

  addBtn.addEventListener("click", () => {
    draft = { ...EMPTY_DRAFT };
    editingId = "new";
    render();
  });

  listEl.addEventListener("click", (event) => {
    const card = event.target.closest(".therapy-entry");
    if (!card || card.classList.contains("editing")) return;
    editingId = Number(card.dataset.id);
    draft = null;
    render();
  });

  async function loadNotes() {
    const { data, error } = await supabase.from("therapy_notes").select("*");

    if (error) {
      errorEl.textContent = error.message;
      errorEl.hidden = false;
      return;
    }
    errorEl.hidden = true;

    notes = sortNewestFirst(data ?? []);
    render();
  }

  loadNotes();
}
