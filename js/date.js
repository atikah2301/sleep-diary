const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Formats a Date's local calendar date as "YYYY-MM-DD" (toISOString would convert to UTC
 * first, silently shifting the date by a day whenever the local UTC offset is non-zero). */
export function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Monday (as "YYYY-MM-DD") of the week containing the given date string. */
export function mondayOf(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  const day = d.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday);
  return toDateStr(d);
}

export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

export function formatWeekHeading(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  const day = String(d.getDate()).padStart(2, "0");
  return `${day}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

/** Groups rows (sorted ascending by dateKey) into consecutive runs sharing the same
 * Monday-of-week, so gaps or a non-Monday-aligned range don't break the grouping. */
export function groupByWeek(rows, dateKey = "entry_date") {
  const groups = [];
  let current = null;
  for (const row of rows) {
    const weekStart = mondayOf(row[dateKey]);
    if (!current || current.weekStart !== weekStart) {
      current = { weekStart, rows: [] };
      groups.push(current);
    }
    current.rows.push(row);
  }
  return groups;
}
