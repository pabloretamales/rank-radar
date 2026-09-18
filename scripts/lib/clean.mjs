/**
 * Free-text fields from the upstream APIs (repo descriptions, YC one-liners,
 * model names) are attacker-controlled: anyone can publish a repo or a company
 * profile. They get committed to the repo and later read by the agent that runs
 * the pipeline, so cap the length and drop control characters — a 4 KB blob of
 * "ignore previous instructions" should not fit in a description field.
 *
 * @param {unknown} value
 * @param {number} max
 * @returns {string}
 */
export function cleanText(value, max = 300) {
  if (value == null) return '';
  return String(value)
    // control chars, zero-width and bidi overrides: used to hide payloads in plain sight
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Same as cleanText but preserves null instead of returning ''. @returns {string | null} */
export function cleanTextOrNull(value, max = 300) {
  const out = cleanText(value, max);
  return out === '' ? null : out;
}
