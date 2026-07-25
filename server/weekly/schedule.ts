// Pure scheduling logic for the weekly mindset drop. Everything here is
// timezone-aware but deterministic and side-effect free, so it unit-tests
// cleanly. The one tz-dependent primitive is `localParts` (via Intl); the rest
// works in "local ordinal hours" so a ±1h DST shift never changes which week a
// message belongs to.

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

// Mid-week insight nudges land this many days after the drop slot, at the same
// preferred hour. Three of them, spaced across the week.
export const INSIGHT_DAY_OFFSETS = [2, 4, 6] as const;

export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  weekday: number; // 0=Sun .. 6=Sat
}

export interface WeeklyScheduleState {
  preferredWeekday?: number | null;
  preferredHour?: number | null;
  lastDropSlot?: string | null;
  insightsSent?: boolean[] | null;
}

// Local calendar parts of `now` in `timezone`. Weekday is derived from the
// local Y/M/D (calendar day-of-week is tz-independent once you have the date),
// avoiding locale-string parsing.
export function localParts(now: Date, timezone: string): LocalParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(fmt.formatToParts(now).map((x) => [x.type, x.value]));
  const year = Number(p.year);
  const month = Number(p.month);
  const day = Number(p.day);
  const hour = Number(p.hour) % 24; // h23 emits "24" at midnight in some ICU builds
  const minute = Number(p.minute);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { year, month, day, hour, minute, weekday };
}

// A monotonic integer day index for a calendar date (days since epoch).
function dayNumberOf(year: number, month: number, day: number): number {
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000);
}

function keyForSlot(dayNumber: number, hour: number): string {
  const ymd = new Date(dayNumber * 86_400_000).toISOString().slice(0, 10);
  return `${ymd}T${String(hour).padStart(2, "0")}`;
}

// The most recent (preferredWeekday @ preferredHour) at or before `parts`.
// Returns a stable string key like "2026-07-26T19".
export function currentSlot(parts: LocalParts, weekday: number, hour: number): {
  dayNumber: number;
  key: string;
} {
  let back = (parts.weekday - weekday + 7) % 7;
  // If today is the slot weekday but the hour hasn't arrived, the most recent
  // slot was a full week ago.
  if (back === 0 && parts.hour < hour) back = 7;
  const slotDay = dayNumberOf(parts.year, parts.month, parts.day) - back;
  return { dayNumber: slotDay, key: keyForSlot(slotDay, hour) };
}

// True when this week's drop hasn't been sent yet (or, for a brand-new
// schedule, has never been sent). Catch-up safe: if the server was down at the
// exact slot, the drop is still due on the next tick, just delayed.
export function isDropDue(state: WeeklyScheduleState, parts: LocalParts): boolean {
  if (state.preferredWeekday == null || state.preferredHour == null) return false;
  const slot = currentSlot(parts, state.preferredWeekday, state.preferredHour);
  return state.lastDropSlot !== slot.key;
}

// Which mid-week insight indices are due now and not yet sent. Timed by elapsed
// hours since the drop actually went out (drop lands at the user's preferred
// hour, so +2/+4/+6 days lands at ~that hour too) — this avoids the "all at
// once" dump you'd get anchoring a first drop to a slot in the past.
export function dueInsightIndices(
  state: { dropSentAt?: number | null; insightsSent?: boolean[] | null },
  now: number,
): number[] {
  if (!state.dropSentAt) return [];
  const sent = state.insightsSent ?? [false, false, false];
  const due: number[] = [];
  for (let i = 0; i < INSIGHT_DAY_OFFSETS.length; i++) {
    if (sent[i]) continue;
    if (now >= state.dropSentAt + INSIGHT_DAY_OFFSETS[i] * 86_400_000) due.push(i);
  }
  return due;
}

// The slot key for the current period — used by the service to anchor a drop.
export function currentSlotKey(state: WeeklyScheduleState, parts: LocalParts): string | null {
  if (state.preferredWeekday == null || state.preferredHour == null) return null;
  return currentSlot(parts, state.preferredWeekday, state.preferredHour).key;
}

// ---- input parsing for the set_weekly_schedule tool --------------------

export function parseWeekday(input: string): number | null {
  const s = input.trim().toLowerCase();
  // Exact full-name match first.
  const exact = WEEKDAYS.findIndex((w) => w.toLowerCase() === s);
  if (exact >= 0) return exact;
  // Then common abbreviations / 3+ letter prefixes.
  const abbrev: Record<string, number> = {
    sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, weds: 3,
    thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6,
  };
  if (abbrev[s] != null) return abbrev[s];
  const byPrefix = WEEKDAYS.findIndex((w) => s.length >= 3 && w.toLowerCase().startsWith(s));
  return byPrefix >= 0 ? byPrefix : null;
}

// Parse a friendly time into an hour 0-23 (minutes are dropped — the slot is
// hour-granular). Accepts "7pm", "7:30pm", "19", "19:00", "9am", "noon",
// "midnight".
export function parseTimeToHour(input: string): number | null {
  const s = input.trim().toLowerCase();
  if (s === "noon" || s === "midday") return 12;
  if (s === "midnight") return 0;
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let hour = Number(m[1]);
  const ampm = m[3];
  if (ampm) {
    if (hour < 1 || hour > 12) return null;
    if (ampm === "pm" && hour !== 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
  }
  if (hour < 0 || hour > 23) return null;
  return hour;
}

export function describeSlot(weekday: number, hour: number): string {
  const day = WEEKDAYS[weekday] ?? "?";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const suffix = hour < 12 ? "am" : "pm";
  return `${day}s at ${h12}${suffix}`;
}
