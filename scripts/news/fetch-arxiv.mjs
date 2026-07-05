#!/usr/bin/env node
/**
 * fetch-arxiv.mjs — Pulse IA source 4/6
 *
 * arXiv — papers académicos de cs.AI + cs.CL, últimos 2 días.
 * API oficial pública, Atom XML, sin auth, rate limit recomendado 1 req/3s.
 *
 * Endpoint: GET http://export.arxiv.org/api/query?search_query=...
 *
 * Categories:
 *   cs.AI  - Artificial Intelligence (excluding cs.LG, cs.CV, etc.)
 *   cs.CL  - Computation and Language (NLP, LLMs, etc.)
 *   cs.LG  - Machine Learning (incluido porque ES donde viven los LMs)
 *
 * Strategy:
 *   - Traemos 30 papers por categoría de los últimos 2 días
 *   - Filtramos por > 0 votos de la comunidad (no hay votes explícitos en
 *     arXiv API, así que usamos submittedDate recent como proxy)
 *   - Sort por submittedDate desc
 *
 * Usage: node scripts/news/fetch-arxiv.mjs
 *
 * Output:
 *   - .cache/test-fetches/arxiv-{date}.json
 *   - .cache/arxiv.json
 */

import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const TEST_DIR = join(ROOT, '.cache', 'test-fetches');
const CACHE = join(ROOT, '.cache', 'arxiv.json');

const API = 'http://export.arxiv.org/api/query';

const CATEGORIES = ['cs.AI', 'cs.CL', 'cs.LG'];

function buildQuery(cat) {
  // sortBy=submittedDate, sortOrder=descending
  // max_results=30
  // search_query con cat:cs.AI filtra por categoría
  return `${API}?search_query=cat:${cat}&start=0&max_results=30&sortBy=submittedDate&sortOrder=descending`;
}

async function fetchCategory(cat) {
  const url = buildQuery(cat);
  const res = await fetch(url, {
    headers: { 'User-Agent': 'pulse-ia/0.1' },
  });
  if (!res.ok) throw new Error(`arxiv ${cat} ${res.status}`);
  return res.text();
}

/**
 * Parser de arXiv Atom — extrae entries con title, summary, authors, id, links.
 */
function parseArxiv(xml, cat, fetchedAt) {
  const entries = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match;
  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[1];
    // <id>http://arxiv.org/abs/2507.01234v1</id>
    const idMatch = block.match(/<id>([\s\S]*?)<\/id>/);
    const idRaw = idMatch ? idMatch[1].trim() : null;
    if (!idRaw) continue;
    // ID canónico sin versión → https://arxiv.org/abs/2507.01234
    const arxivId = idRaw.replace(/^.*abs\//, '').replace(/v\d+$/, '');
    const url = `https://arxiv.org/abs/${arxivId}`;
    // <title>...</title>
    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
    const title = titleMatch ? cleanText(titleMatch[1]) : '(sin título)';
    // <summary>...</summary>
    const summaryMatch = block.match(/<summary>([\s\S]*?)<\/summary>/);
    const summary = summaryMatch ? cleanText(summaryMatch[1]).slice(0, 1500) : null;
    // <published>...</published>
    const publishedMatch = block.match(/<published>([\s\S]*?)<\/published>/);
    const published_at = publishedMatch ? publishedMatch[1].trim() : null;
    // <author><name>...</name></author> (múltiples)
    const authors = [];
    const authorRegex = /<author>\s*<name>([\s\S]*?)<\/name>\s*<\/author>/g;
    let authorMatch;
    while ((authorMatch = authorRegex.exec(block)) !== null) {
      authors.push(cleanText(authorMatch[1]));
    }
    // <arxiv:doi>...</arxiv:doi> (opcional)
    const doiMatch = block.match(/<arxiv:doi>([\s\S]*?)<\/arxiv:doi>/);
    const doi = doiMatch ? doiMatch[1].trim() : null;
    // Categories list (puede tener varios)
    const categories = [];
    const catRegex = /<arxiv:category\s+term="([^"]+)"/g;
    let catMatch;
    while ((catMatch = catRegex.exec(block)) !== null) {
      categories.push(catMatch[1]);
    }

    entries.push({
      source_id: `arxiv-${cat.replace('.', '-').toLowerCase()}`,
      source_name: `arXiv (${cat})`,
      source_url: 'https://arxiv.org',
      id_on_source: arxivId,
      title,
      url,
      doi_url: doi ? `https://doi.org/${doi}` : null,
      abstract: summary,
      authors,
      submitted_at: published_at,
      categories,
      fetched_at: fetchedAt,
      score: null,
      comments: null,
    });
  }
  return entries;
}

function cleanText(s) {
  return s
    .replace(/\s+/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

async function main() {
  const fetchedAt = new Date().toISOString();
  if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
  if (!existsSync(dirname(CACHE))) mkdirSync(dirname(CACHE), { recursive: true });

  console.log('📡 Fetching arXiv (cs.AI + cs.CL + cs.LG)…');
  const all = [];
  const failed = [];
  for (const cat of CATEGORIES) {
    try {
      const xml = await fetchCategory(cat);
      const items = parseArxiv(xml, cat, fetchedAt);
      console.log(`   📄 ${cat}: ${items.length} papers`);
      all.push(...items);
      // arXiv recomienda 1 req/3s
      await new Promise((r) => setTimeout(r, 3500));
    } catch (e) {
      console.warn(`   ⚠️  ${cat}: ${e.message}`);
      failed.push({ cat, error: e.message });
    }
  }

  // Dedupe por arxiv_id
  const seen = new Set();
  const unique = all.filter((it) => {
    if (seen.has(it.id_on_source)) return false;
    seen.add(it.id_on_source);
    return true;
  });
  console.log(`   🔄 Unique: ${unique.length} / ${all.length}`);

  // Top por reciente (los 30 más nuevos)
  unique.sort((a, b) => (b.submitted_at ?? '').localeCompare(a.submitted_at ?? ''));
  const top = unique.slice(0, 40);

  const payload = {
    fetched_at: fetchedAt,
    source: 'arxiv',
    endpoint: API,
    note: 'arXiv API — papers académicos cs.AI + cs.CL + cs.LG (más overlap con LLMs)',
    categories: CATEGORIES,
    failed,
    total_collected: all.length,
    unique: unique.length,
    items: top,
  };

  const testFile = join(TEST_DIR, `arxiv-${fetchedAt.slice(0, 10)}.json`);
  writeFileSync(testFile, JSON.stringify(payload, null, 2));
  console.log(`   💾 Test: ${testFile}`);

  writeFileSync(CACHE, JSON.stringify(payload, null, 2));
  console.log(`   💾 Cache: ${CACHE}`);

  if (top.length > 0) {
    const t = top[0];
    console.log(`   🥇 Top: "${t.title.slice(0, 70)}…"`);
    console.log(`   👥 Authors: ${t.authors.slice(0, 3).join(', ')}…`);
    console.log(`   🔗 ${t.url}`);
  }
}

main().catch((e) => {
  console.error('💥 fetch-arxiv.mjs:', e.message);
  process.exit(1);
});
