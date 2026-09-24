import { supabase } from "./supabase-client.js";
import { isOnline, onConnectivityChange } from "./device.js";
import { fetchWithOfflineFallback } from "./offline-cache.js";

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

function sortOldestFirst(notes) {
  return [...notes].sort((a, b) => sortKey(a) - sortKey(b));
}

function noteToExportBlock(note) {
  const meta = formatNoteMeta(note);
  const header = meta ? `${note.heading}\n${meta}` : note.heading;
  return note.body ? `${header}\n\n${note.body}` : header;
}

function notesToExportText(notes) {
  return sortOldestFirst(notes).map(noteToExportBlock).join("\n\n---\n\n");
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
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
      <p class="error-message" aria-live="polite" hidden>Heading is required.</p>
      <p class="offline-hint" hidden>You're offline — reconnect to save.</p>
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
      <button type="button" id="therapy-export" class="secondary">Export notes</button>
    </div>
    <div id="therapy-list"></div>
    <p id="therapy-error" class="error-message" aria-live="polite" hidden></p>
  `;

  const listEl = container.querySelector("#therapy-list");
  const errorEl = container.querySelector("#therapy-error");
  const addBtn = container.querySelector("#therapy-add");
  const exportBtn = container.querySelector("#therapy-export");

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
    const cardOfflineMsgEl = card.querySelector(".offline-hint");
    const cardSaveBtn = card.querySelector('[data-action="save"]');

    headingInput.value = source.heading ?? "";
    dateInput.value = source.session_date ?? "";
    timeInput.value = source.session_time ? source.session_time.slice(0, 5) : "";
    bodyInput.value = source.body ?? "";

    function applyOfflineState() {
      cardSaveBtn.disabled = !isOnline();
      cardOfflineMsgEl.hidden = isOnline();
    }
    applyOfflineState();
    onConnectivityChange(applyOfflineState);

    card.querySelector('[data-action="cancel"]').addEventListener("click", () => {
      editingId = null;
      draft = null;
      render();
    });

    cardSaveBtn.addEventListener("click", async () => {
      if (!isOnline()) {
        cardErrorEl.textContent = "You're offline — reconnect to save.";
        cardErrorEl.hidden = false;
        return;
      }
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

  exportBtn.addEventListener("click", () => {
    if (notes.length === 0) return;
    downloadTextFile(`therapy-notes-${todayIsoDate()}.txt`, notesToExportText(notes));
  });

  listEl.addEventListener("click", (event) => {
    const card = event.target.closest(".therapy-entry");
    if (!card || card.classList.contains("editing")) return;
    editingId = Number(card.dataset.id);
    draft = null;
    render();
  });

  async function loadNotes() {
    const { data, error } = await fetchWithOfflineFallback("therapy_notes", () =>
      supabase.from("therapy_notes").select("*"),
    );

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
