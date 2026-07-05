#!/usr/bin/env node
/**
 * fetch-reddit.mjs — Pulse IA source 3/6
 *
 * Reddit r/MachineLearning + r/LocalLLaMA — top del día, vía RSS público.
 *
 * NOTA IMPORTANTE: Reddit bloqueó el acceso JSON público sin OAuth desde
 * 2023 (`.json` y `/top.json` devuelven 403/HTML). El `.rss` legacy sigue
 * funcionando sin auth y devuelve ~25 items por subreddit en formato
 * Atom 1.0. Este fetcher usa RSS como workaround.
 *
 * Si en el futuro conseguimos una API key de Reddit (OAuth client_credentials
 * o Data API access), migrar a JSON para tener más metadata.
 *
 * Endpoints:
 *   https://www.reddit.com/r/{sub}/.rss
 *
 * Strategy:
 *   - Parse Atom XML con regex simple (no agregamos deps)
 *   - Top 25 por subreddit
 *   - Dedupe entre subreddits
 *
 * Usage: node scripts/news/fetch-reddit.mjs
 *
 * Output:
 *   - .cache/test-fetches/reddit-{date}.json
 *   - .cache/reddit.json
 */

import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const TEST_DIR = join(ROOT, '.cache', 'test-fetches');
const CACHE = join(ROOT, '.cache', 'reddit.json');

const SUBREDDITS = ['MachineLearning', 'LocalLLaMA'];

async function fetchRSS(sub, attempt = 1) {
  const url = `https://www.reddit.com/r/${sub}/.rss`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; pulse-ia/0.1; +https://github.com/pabloretamales/rank-radar)',
      Accept: 'application/atom+xml, application/xml',
    },
  });
  if (res.status === 429 && attempt < 4) {
    const wait = 5000 * attempt; // 5s, 10s, 15s
    console.warn(`      ⏳ 429 → esperando ${wait}ms (intento ${attempt})`);
    await new Promise((r) => setTimeout(r, wait));
    return fetchRSS(sub, attempt + 1);
  }
  if (!res.ok) throw new Error(`reddit rss ${sub} ${res.status}`);
  return res.text();
}

/**
 * Parser de Atom 1.0 minimal — extrae <entry> con title, link, updated, content.
 * No usamos deps (feedparser, etc.) porque el RSS de Reddit es predecible.
 */
function parseAtom(xml, sub, fetchedAt) {
  const entries = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match;
  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[1];
    // <title>...</title>
    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
    const title = titleMatch ? decodeXmlEntities(titleMatch[1].trim()) : null;
    // <link href="..."/> (preferimos el que NO termina en comentarios)
    const linkMatches = [...block.matchAll(/<link\s+href="([^"]+)"\s*\/>/g)];
    let url = null;
    for (const lm of linkMatches) {
      const href = lm[1];
      if (!href.includes('/comments/')) {
        url = href;
        break;
      }
    }
    if (!url && linkMatches.length > 0) url = linkMatches[0][1];
    // <updated>2026-07-05T21:15:25+00:00</updated>
    const updatedMatch = block.match(/<updated>([\s\S]*?)<\/updated>/);
    const submitted_at = updatedMatch ? new Date(updatedMatch[1].trim()).toISOString() : null;
    // <content type="html">...</content> (puede estar truncado por Reddit)
    const contentMatch = block.match(/<content[^>]*>([\s\S]*?)<\/content>/);
    const selftext = contentMatch
      ? decodeXmlEntities(contentMatch[1].replace(/<[^>]+>/g, '').trim()).slice(0, 400)
      : null;

    if (!title || !url) continue;
    entries.push({
      source_id: `reddit-${sub.toLowerCase()}`,
      source_name: `r/${sub}`,
      source_url: `https://www.reddit.com/r/${sub}`,
      id_on_source: url.split('/').pop() ?? title.slice(0, 20),
      title,
      url,
      reddit_url: `https://www.reddit.com/r/${sub}/comments/${url.split('/comments/')[1] ?? ''}`,
      selftext,
      submitted_at,
      fetched_at: fetchedAt,
      // RSS no trae score/comments — los dejamos null
      score: null,
      comments: null,
      by: null,
    });
  }
  return entries;
}

function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

async function main() {
  const fetchedAt = new Date().toISOString();
  if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
  if (!existsSync(dirname(CACHE))) mkdirSync(dirname(CACHE), { recursive: true });

  console.log('📡 Fetching Reddit r/MachineLearning + r/LocalLLaMA (RSS)…');
  const all = [];
  const failed = [];
  for (const sub of SUBREDDITS) {
    try {
      const xml = await fetchRSS(sub);
      // Pausa extra para ser amable
      await new Promise((r) => setTimeout(r, 1500));
      const items = parseAtom(xml, sub, fetchedAt);
      console.log(`   📥 r/${sub}: ${items.length} posts`);
      all.push(...items);
      // Delay amable entre subreddits (RSS también rate-limita)
      await new Promise((r) => setTimeout(r, 2000));
    } catch (e) {
      console.warn(`   ⚠️  r/${sub}: ${e.message} (skipping)`);
      failed.push({ sub, error: e.message });
    }
    // Delay generoso entre subs para evitar 429
    if (SUBREDDITS.indexOf(sub) < SUBREDDITS.length - 1) {
      await new Promise((r) => setTimeout(r, 4000));
    }
  }

  // Dedupe por título
  const seen = new Set();
  const unique = all.filter((it) => {
    const k = it.title.toLowerCase().slice(0, 80);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  console.log(`   🔄 Unique: ${unique.length} / ${all.length}`);

  const payload = {
    fetched_at: fetchedAt,
    source: 'reddit',
    endpoint: 'https://www.reddit.com/r/{sub}/.rss',
    note: 'Using RSS public endpoint (JSON blocked by Reddit 2023 — OAuth API needed for full metadata)',
    subreddits: SUBREDDITS,
    failed,
    total_collected: all.length,
    unique: unique.length,
    items: unique.slice(0, 30),
  };

  const testFile = join(TEST_DIR, `reddit-${fetchedAt.slice(0, 10)}.json`);
  writeFileSync(testFile, JSON.stringify(payload, null, 2));
  console.log(`   💾 Test: ${testFile}`);

  writeFileSync(CACHE, JSON.stringify(payload, null, 2));
  console.log(`   💾 Cache: ${CACHE}`);

  if (payload.items.length > 0) {
    const t = payload.items[0];
    console.log(`   🥇 Top: "${t.title.slice(0, 70)}…" (${t.source_id.replace('reddit-','r/')})`);
    console.log(`   🔗 ${t.url.slice(0, 80)}…`);
  }
}

main().catch((e) => {
  console.error('💥 fetch-reddit.mjs:', e.message);
  process.exit(1);
});
