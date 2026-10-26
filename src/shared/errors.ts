/** The message of a thrown value, for status lines: an Error's message, anything else as a string. */
export function errText(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  // An error thrown in the main process reaches a renderer as "Error invoking remote method '<channel>': Error: …":
  // the user reads only the message.
  return text.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, '')
}
