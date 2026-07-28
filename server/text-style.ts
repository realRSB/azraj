// Mechanical cleanup of the tells that make a text read as machine-written.
//
// The voice prompt already forbids these. This is the belt to that suspenders:
// prompts are probabilistic and the model does slip, usually on the em-dash. A
// regex is not.
//
// Applied where the reply is PRODUCED (the dispatcher) rather than only where
// it's sent, so the stored message, the debug dashboard, and the delivered
// iMessage all show the same text. Sanitizing only at send time meant history
// disagreed with what the user actually received.

/**
 * Normalize em/en dashes to something a person would type on a phone.
 *
 * A spaced dash is doing the work of a comma ("timing, the content, or both").
 * An unspaced one is standing in for a range or a compound, where a plain
 * hyphen is what someone would have typed anyway.
 */
export function normalizeDashes(text: string): string {
  return text.replace(/\s+[—–]\s+/g, ", ").replace(/[—–]/g, "-");
}

/**
 * Full cleanup for a user-facing reply. Kept separate from markdown stripping,
 * which only matters for SMS/iMessage delivery — these fixes apply everywhere.
 */
export function cleanReplyText(text: string): string {
  return normalizeDashes(text);
}
