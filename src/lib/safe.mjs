/**
 * Third-party data (GitHub, OpenRouter, Artificial Analysis, ExploreYC) ends up
 * in href/src attributes. Anything that is not plain http(s) is dropped, so a
 * `javascript:` or `data:` URL from an API cannot execute on our pages.
 *
 * @param {string | null | undefined} url
 * @param {string} fallback
 * @returns {string}
 */
export function safeUrl(url, fallback = '#') {
  if (!url) return fallback;
  try {
    const parsed = new URL(String(url).trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : fallback;
  } catch {
    return fallback; // relative or malformed — not something an API should be handing us
  }
}
