// Pure streak arithmetic, shared by the Convex mutation (convex/streaks.ts)
// and the server card logic (server/streak/service.ts). No Convex or Node
// dependencies so it is trivially unit-testable.

// Whole-day difference between two YYYY-MM-DD strings (b - a). Positive when b
// is later. Parsed as UTC midnights so DST never skews the count — callers have
// already resolved each date in the user's timezone, so this is pure
// calendar-day arithmetic on the string values.
export function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

export interface StreakState {
  currentStreak: number;
  longestStreak: number;
  totalDays: number;
  lastActiveDate: string;
}

export interface StreakAdvance {
  currentStreak: number;
  longestStreak: number;
  totalDays: number;
  changed: boolean; // false when today was already counted
  reset: boolean; // true when a 2+ day gap dropped the streak back to 1
}

// Apply a texting day to a prior streak state. `null` prev means first-ever
// activity. Same-day (or backwards clock) is a no-op; a consecutive day
// extends the streak; any gap of 2+ days resets it to 1.
export function advanceStreak(prev: StreakState | null, today: string): StreakAdvance {
  if (!prev) {
    return { currentStreak: 1, longestStreak: 1, totalDays: 1, changed: true, reset: false };
  }
  const diff = dayDiff(prev.lastActiveDate, today);
  if (diff <= 0) {
    return {
      currentStreak: prev.currentStreak,
      longestStreak: prev.longestStreak,
      totalDays: prev.totalDays,
      changed: false,
      reset: false,
    };
  }
  const currentStreak = diff === 1 ? prev.currentStreak + 1 : 1;
  const longestStreak = Math.max(prev.longestStreak, currentStreak);
  return {
    currentStreak,
    longestStreak,
    totalDays: prev.totalDays + 1,
    changed: true,
    reset: diff > 1,
  };
}

export type CardState = "today" | "alive" | "broken";

// What the morning card should show, given the stored streak and today's date.
// - texted today already   → "today"  (show current streak)
// - texted yesterday       → "alive"  (still going, show current)
// - missed a day or more   → "broken" (show 0; the card nudges a restart)
export function cardState(
  lastActiveDate: string,
  currentStreak: number,
  today: string,
): { state: CardState; streak: number } {
  const diff = dayDiff(lastActiveDate, today);
  if (diff <= 0) return { state: "today", streak: currentStreak };
  if (diff === 1) return { state: "alive", streak: currentStreak };
  return { state: "broken", streak: 0 };
}
