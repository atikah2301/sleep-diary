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

function renderNoteCard(note) {
  const meta = formatNoteMeta(note);
  return `
    <div class="card" data-id="${note.id}">
      <h3>${note.heading}</h3>
      ${meta ? `<p class="therapy-entry-meta">${meta}</p>` : ""}
      ${note.body ? `<p class="therapy-entry-body">${note.body}</p>` : ""}
    </div>
  `;
}

export function initTherapyView(container) {
  container.innerHTML = `
    <div id="therapy-list"></div>
    <p id="therapy-error" class="error-message" hidden></p>
  `;

  const listEl = container.querySelector("#therapy-list");
  const errorEl = container.querySelector("#therapy-error");

  async function loadNotes() {
    const { data, error } = await supabase.from("therapy_notes").select("*");

    if (error) {
      errorEl.textContent = error.message;
      errorEl.hidden = false;
      return;
    }
    errorEl.hidden = true;

    const notes = sortNewestFirst(data ?? []);
    listEl.innerHTML = notes.length
      ? notes.map(renderNoteCard).join("")
      : `<p class="hint">No therapy notes yet.</p>`;
  }

  loadNotes();
}
