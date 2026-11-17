/** Notes can hold up to NOTES_MAX_LENGTH chars; only the first NOTES_SUMMARY_LENGTH reach the PDF. */
export const NOTES_MAX_LENGTH = 300;
export const NOTES_SUMMARY_LENGTH = 100;

export function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The text shown in the PDF/table preview: first 100 chars, then "..." if there is more. */
export function summarizeNotes(notes) {
  const text = notes ?? "";
  return text.length > NOTES_SUMMARY_LENGTH ? `${text.slice(0, NOTES_SUMMARY_LENGTH).trimEnd()}...` : text;
}

/** HTML for the entry form's highlight layer: chars past the cut-off are wrapped in <mark>. */
export function notesHighlightHtml(notes) {
  const head = escapeHtml(notes.slice(0, NOTES_SUMMARY_LENGTH));
  const tail = notes.slice(NOTES_SUMMARY_LENGTH);
  // Trailing newline keeps the layer's height in step with the textarea.
  return `${head}${tail ? `<mark>${escapeHtml(tail)}</mark>` : ""}\n`;
}
