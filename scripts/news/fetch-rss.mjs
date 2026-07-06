#!/usr/bin/env node
/**
 * fetch-rss.mjs — Pulse IA: fetcher RSS/Atom genérico
 *
 * Lee la lista de feeds desde scripts/news/sources.json y trae los items
 * más recientes de cada uno (top 20 por feed). Parser Atom 1.0 / RSS 2.0
 * minimalista (sin dependencias).
 *
 * Reemplaza los 4 fetchers RSS anteriores (HF, HackerNews, Reddit, arXiv).
 * Ahora los 7 feeds de Lovable CRM:
 *   - TechCrunch AI, The Verge AI, VentureBeat AI, MIT Tech Review AI
 *   - Latent Space, Hacker News AI (via hnrss.org)
 *   - Xataka IA + WWWhatsnew IA (en español)
 *
 * HN via hnrss tiene su propio fetcher dedicado (fetch-hnrss.mjs) porque
 * devuelve JSON en vez de RSS.
 *
 * Uso: node scripts/news/fetch-rss.mjs [--source=ID]
 *      Sin flag: trae todos los RSS del config.
 *      Con flag: solo ese feed (test).
 *
 * Salidas:
 *   - .cache/test-fetches/{source-id}-{date}.json (raw, para inspección)
 *   - .cache/{source-id}.json (cache + items normalizados)
 *
 * Cada feed que falla se loggea como warning y se continúa. El pipeline
 * no se rompe si una feed muere.
 */

import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const TEST_DIR = join(ROOT, '.cache', 'test-fetches');
const CACHE = join(ROOT, '.cache');
const SOURCES_CONFIG = join(__dirname, 'sources.json');

const args = process.argv.slice(2);
const onlySource = args.find((a) => a.startsWith('--source='))?.split('=')[1];

const TOP_N = 20;
const USER_AGENT = 'Mozilla/5.0 (compatible; pulse-ia/0.2; +https://github.com/pabloretamales/rank-radar)';

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

function cleanText(s) {
  return decodeEntities(s).replace(/\s+/g, ' ').trim();
}

function stripCdata(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

/**
 * Parser universal RSS 2.0 / Atom 1.0.
 * Detecta el tipo por el tag raíz y devuelve items uniformes.
 */
function parseFeed(xml) {
  const isAtom = /<feed[\s>]/i.test(xml.slice(0, 1000));
  if (isAtom) return parseAtom(xml);
  return parseRSS(xml);
}

function parseAtom(xml) {
  const items = [];
  const entryRegex = /<entry[^>]*>([\s\S]*?)<\/entry>/gi;
  let m;
  while ((m = entryRegex.exec(xml)) !== null) {
    const block = m[1];
    const titleMatch = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const idMatch = block.match(/<id[^>]*>([\s\S]*?)<\/id>/i);
    const updatedMatch = block.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i);
    const publishedMatch = block.match(/<published[^>]*>([\s\S]*?)<\/published>/i);
    const contentMatch = block.match(/<content[^>]*>([\s\S]*?)<\/content>/i);
    const summaryMatch = block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);
    // Atom puede tener varios <link>. Preferimos el que tiene rel="alternate" o el primero.
    const linkMatches = [...block.matchAll(/<link[^>]+href="([^"]+)"[^>]*>/gi)];
    let url = null;
    for (const lm of linkMatches) {
      if (!lm[0].includes('rel="self"')) { url = lm[1]; break; }
    }
    if (!url && linkMatches.length > 0) url = linkMatches[0][1];
    // Author
    const authorMatch = block.match(/<author[^>]*>[\s\S]*?<name[^>]*>([\s\S]*?)<\/name>[\s\S]*?<\/author>/i);
    const author = authorMatch ? cleanText(authorMatch[1]) : null;

    if (!titleMatch || !url) continue;
    const title = cleanText(titleMatch[1]);
    const summary = (contentMatch ? cleanText(contentMatch[1]) : summaryMatch ? cleanText(summaryMatch[1]) : null);

    items.push({
      title,
      url: url.trim(),
      guid: idMatch ? cleanText(idMatch[1]) : null,
      published_at: updatedMatch ? cleanText(updatedMatch[1]) : (publishedMatch ? cleanText(publishedMatch[1]) : null),
      summary: summary ? stripHtml(summary).slice(0, 1500) : null,
      author,
    });
  }
  return items;
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
    const creatorMatch = block.match(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i);
    const authorMatch = block.match(/<author[^>]*>([\s\S]*?)<\/author>/i);

    if (!titleMatch || !linkMatch) continue;
    const title = cleanText(titleMatch[1]);
    const url = cleanText(linkMatch[1]);

    items.push({
      title,
      url,
      guid: guidMatch ? cleanText(guidMatch[1]) : null,
      published_at: pubDateMatch ? new Date(stripCdata(pubDateMatch[1]).trim()).toISOString() : null,
      summary: descMatch ? stripHtml(cleanText(descMatch[1])).slice(0, 1500) : null,
      author: creatorMatch ? cleanText(creatorMatch[1]) : (authorMatch ? cleanText(authorMatch[1]) : null),
    });
  }
  return items;
}

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function fetchFeed(source, attempt = 1) {
  const res = await fetch(source.url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
    },
  });
  if (res.status === 429 && attempt < 3) {
    const wait = 3000 * attempt;
    console.warn(`      ⏳ 429 → ${wait}ms (intento ${attempt})`);
    await new Promise((r) => setTimeout(r, wait));
    return fetchFeed(source, attempt + 1);
  }
  if (!res.ok) throw new Error(`${source.id} ${res.status}`);
  return res.text();
}

function normalizeItem(source, raw, fetchedAt) {
  return {
    source_id: source.id,
    source_name: source.name,
    source_url: source.url,
    source_language: source.language ?? 'en',
    source_category_hint: source.category_hint ?? null,
    id_on_source: raw.guid ?? raw.url ?? raw.title?.slice(0, 80),
    title: raw.title,
    url: raw.url,
    summary: raw.summary ?? null,
    author: raw.author ?? null,
    submitted_at: raw.published_at ?? null,
    fetched_at: fetchedAt,
    score: null,
    comments: null,
  };
}

async function processSource(source, fetchedAt) {
  const xml = await fetchFeed(source);
  const items = parseFeed(xml);
  const top = items.slice(0, TOP_N).map((it) => normalizeItem(source, it, fetchedAt));
  console.log(`   📥 ${source.id.padEnd(22)}: ${items.length} → top ${top.length}`);

  return {
    fetched_at: fetchedAt,
    source: source.id,
    endpoint: source.url,
    type: source.type,
    language: source.language,
    total: items.length,
    items: top,
  };
}

async function main() {
  const fetchedAt = new Date().toISOString();
  if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
  if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true });

  if (!existsSync(SOURCES_CONFIG)) {
    console.error(`❌ No existe ${SOURCES_CONFIG}`);
    process.exit(1);
  }
  const config = JSON.parse(readFileSync(SOURCES_CONFIG, 'utf-8'));
  let sources = config.sources ?? [];
  // Solo los type=rss (hnrss se procesa con su fetcher dedicado)
  sources = sources.filter((s) => s.type === 'rss');
  if (onlySource) sources = sources.filter((s) => s.id === onlySource);

  console.log(`📡 Fetching ${sources.length} RSS feeds (Lovable CRM validation)…`);
  const failed = [];
  for (const source of sources) {
    try {
      const result = await processSource(source, fetchedAt);
      const outFile = join(CACHE, `${source.id}.json`);
      writeFileSync(outFile, JSON.stringify(result, null, 2));
      const testFile = join(TEST_DIR, `${source.id}-${fetchedAt.slice(0, 10)}.json`);
      writeFileSync(testFile, JSON.stringify(result, null, 2));
    } catch (e) {
      console.warn(`   ⚠️  ${source.id}: ${e.message} (skipping)`);
      failed.push({ source: source.id, error: e.message });
    }
    // Delay amable entre feeds
    if (sources.indexOf(source) < sources.length - 1) {
      await new Promise((r) => setTimeout(r, 800));
    }
  }

  if (failed.length > 0) {
    console.log(`\n   ⚠️  ${failed.length} feed(s) failed: ${failed.map((f) => f.source).join(', ')}`);
  }
  console.log(`💾 ${sources.length - failed.length} feeds written to .cache/{id}.json`);
  if (sources.length > 0) {
    const first = sources[0];
    console.log(`   🥇 Sample from ${first.id}: "${first.name}"`);
  }
}

main().catch((e) => {
  console.error('💥 fetch-rss.mjs:', e.message);
  process.exit(1);
});
