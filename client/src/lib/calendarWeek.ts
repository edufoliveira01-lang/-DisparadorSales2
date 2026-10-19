/** Calendar dates are handled in UTC so a week never shifts with the browser's time zone. */
export function shiftCalendarDate(reference: string, days: number): string {
  const [year, month, day] = reference.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export function calendarWeek(reference: string): string[] {
  const dayOfWeek = new Date(`${reference}T12:00:00Z`).getUTCDay();
  const monday = shiftCalendarDate(reference, -((dayOfWeek + 6) % 7));
  return Array.from({ length: 7 }, (_, index) =>
    shiftCalendarDate(monday, index),
  );
}
