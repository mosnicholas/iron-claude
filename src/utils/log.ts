/**
 * Strip control characters from a value before interpolating it into a log
 * line. Defends against log forging — an attacker who can influence the value
 * (e.g. a webhook `:device` path param, a Telegram chat id) shouldn't be able
 * to inject `\n` and forge fake log entries that downstream tools might parse
 * as real ones.
 */
export function safeLog(value: unknown, maxLen = 200): string {
  const s = typeof value === "string" ? value : String(value);
  // Stripping control chars (\r\n\t and the rest of C0/C1) is the whole point
  // of this helper — silence eslint's no-control-regex for this one line.
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\r\n\t\x00-\x1f\x7f]/g, " ").slice(0, maxLen);
}
