#!/usr/bin/env node
/**
 * fetch-hnrss.mjs — Pulse IA: Hacker News via hnrss.org
 *
 * hnrss.org devuelve RSS 2.0 con filtro de keywords pre-aplicado
 * (mejor que el Algolia broad que tenía antes). Configurado para:
 *   query = AI OR LLM OR GPT OR Claude OR Gemini
 *   count = 25 items
 *   sortBy = created_at desc
 *
 * Dedicado a HN porque:
 *   - HN vía Algolia API daba 25 AI-relevant pero requería 2 hops
 *   - hnrss.org hace el filtrado server-side y devuelve RSS limpio
 *   - 1 solo feed en vez de multi-queries
 *
 * Uso: node scripts/news/fetch-hnrss.mjs
 *
 * Salidas:
 *   - .cache/test-fetches/hackernews-ai-{date}.json
 *   - .cache/hackernews-ai.json
 */

import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const TEST_DIR = join(ROOT, '.cache', 'test-fetches');
const CACHE = join(ROOT, '.cache');

const FEED_URL = 'https://hnrss.org/newest?q=AI+OR+LLM+OR+GPT+OR+Claude+OR+Gemini&count=25';
const TOP_N = 25;
const SOURCE = {
  id: 'hackernews-ai',
  name: 'Hacker News AI (via hnrss.org)',
  url: FEED_URL,
  type: 'hnrss',
  language: 'en',
  category_hint: 'discussion',
  tier: 1,
};

function decodeEntities(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
function cleanText(s) { return decodeEntities(s).replace(/\s+/g, ' ').trim(); }
function stripHtml(html) { return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }

async function fetchHN(attempt = 1) {
  const res = await fetch(FEED_URL, {
    headers: { 'User-Agent': 'pulse-ia/0.2', Accept: 'application/rss+xml' },
  });
  if (res.status === 429 && attempt < 3) {
    await new Promise((r) => setTimeout(r, 3000 * attempt));
    return fetchHN(attempt + 1);
  }
  if (!res.ok) throw new Error(`hnrss ${res.status}`);
  return res.text();
}

function parseRSS(xml) {
  const items = [];
  const itemRegex = /<item[\s>]([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRegex.exec(xml)) !== null) {
    const block = m[1];
    const titleMatch = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const linkMatch = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    const guidMatch = block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i);
    const pubDateMatch = block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i);
    const descMatch = block.match(/<description[^>]*>([\s\S]*?)<\/description>/i);
    const commentsMatch = block.match(/<comments[^>]*>([\s\S]*?)<\/comments>/i);

    if (!titleMatch || !linkMatch) continue;
    items.push({
      title: cleanText(titleMatch[1]),
      url: cleanText(linkMatch[1]),
      guid: guidMatch ? cleanText(guidMatch[1]) : null,
      published_at: pubDateMatch ? new Date(cleanText(pubDateMatch[1])).toISOString() : null,
      summary: descMatch ? stripHtml(cleanText(descMatch[1])).slice(0, 1500) : null,
      comments_url: commentsMatch ? cleanText(commentsMatch[1]) : null,
    });
  }
  return items.slice(0, TOP_N);
}

function normalizeItem(raw, fetchedAt) {
  return {
    source_id: SOURCE.id,
    source_name: SOURCE.name,
    source_url: SOURCE.url,
    source_language: 'en',
    source_category_hint: 'discussion',
    id_on_source: raw.guid ?? raw.url ?? raw.title?.slice(0, 80),
    title: raw.title,
    url: raw.url,
    summary: raw.summary ?? null,
    submitted_at: raw.published_at ?? null,
    fetched_at: fetchedAt,
    score: null,
    comments: null,
  };
}

async function main() {
  const fetchedAt = new Date().toISOString();
  if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
  if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true });

  console.log('📡 Fetching Hacker News AI (hnrss.org filter)…');
  const xml = await fetchHN();
  const items = parseRSS(xml);
  console.log(`   📥 ${items.length} HN posts con keywords AI/ML/LLM`);
  const normalized = items.map((it) => normalizeItem(it, fetchedAt));

  const payload = {
    fetched_at: fetchedAt,
    source: 'hackernews-ai',
    endpoint: FEED_URL,
    type: 'hnrss',
    language: 'en',
    total: items.length,
    items: normalized,
  };

  const testFile = join(TEST_DIR, `hackernews-ai-${fetchedAt.slice(0, 10)}.json`);
  writeFileSync(testFile, JSON.stringify(payload, null, 2));
  console.log(`   💾 Test: ${testFile}`);

  const cacheFile = join(CACHE, 'hackernews-ai.json');
  writeFileSync(cacheFile, JSON.stringify(payload, null, 2));
  console.log(`   💾 Cache: ${cacheFile}`);

  if (normalized.length > 0) {
    const t = normalized[0];
    console.log(`   🥇 Top: "${t.title.slice(0, 70)}…"`);
    console.log(`   🔗 ${t.url.slice(0, 80)}…`);
  }
}

main().catch((e) => {
  console.error('💥 fetch-hnrss.mjs:', e.message);
  process.exit(1);
});
