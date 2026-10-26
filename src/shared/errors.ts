/** The message of a thrown value, for status lines: an Error's message, anything else as a string. */
export function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
