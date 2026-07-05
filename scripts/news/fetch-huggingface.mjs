#!/usr/bin/env node
/**
 * fetch-huggingface.mjs — Pulse IA source 1/6
 *
 * Hugging Face Daily Papers — curated by AK (@akhaliq), public JSON API.
 * ~5-10 papers/day, high quality, research-focused.
 *
 * Endpoint: GET https://huggingface.co/api/daily_papers
 * Docs:     https://huggingface.co/docs/api-inference/
 *
 * Usage: node scripts/news/fetch-huggingface.mjs
 * Env:    (none — public endpoint)
 *
 * Output:
 *   - .cache/test-fetches/huggingface-{date}.json (raw, para inspección)
 *   - .cache/huggingface-papers.json (raw para pipeline)
 */

import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const TEST_DIR = join(ROOT, '.cache', 'test-fetches');
const CACHE = join(ROOT, '.cache', 'huggingface-papers.json');

const ENDPOINT = 'https://huggingface.co/api/daily_papers';

async function fetchDailyPapers() {
  const res = await fetch(ENDPOINT, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'pulse-ia/0.1 (rank-radar)',
    },
  });
  if (!res.ok) {
    throw new Error(`HF daily_papers ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Normaliza un paper HF a shape común NewsItem (parcial, faltan campos que se
 * rellenan en normalize.mjs del pipeline).
 */
function normalizePaper(p, fetchedAt) {
  const paper = p.paper ?? p;
  return {
    source_id: 'huggingface-papers',
    source_name: 'Hugging Face Daily Papers',
    source_url: 'https://huggingface.co/papers',
    id_on_source: paper.id ?? paper.paperId ?? null,
    title: paper.title ?? '(sin título)',
    url: paper.id ? `https://huggingface.co/papers/${paper.id}` : (paper.paperUrl ?? ''),
    abstract: paper.summary ?? paper.abstract ?? null,
    authors: Array.isArray(paper.authors)
      ? paper.authors.map((a) => (typeof a === 'string' ? a : a?.name)).filter(Boolean)
      : [],
    submitted_at: paper.publishedAt ?? paper.submittedAt ?? null,
    upvotes: paper.upvotes ?? p.num_likes ?? 0,
    github_repo: paper.ai_repos?.[0] ?? null,
    fetched_at: fetchedAt,
  };
}

async function main() {
  const fetchedAt = new Date().toISOString();
  if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
  if (!existsSync(dirname(CACHE))) mkdirSync(dirname(CACHE), { recursive: true });

  console.log('📡 Fetching Hugging Face Daily Papers…');
  const raw = await fetchDailyPapers();
  const items = Array.isArray(raw) ? raw.map((p) => normalizePaper(p, fetchedAt)) : [];
  console.log(`   📄 ${items.length} papers`);

  const payload = {
    fetched_at: fetchedAt,
    source: 'huggingface-papers',
    endpoint: ENDPOINT,
    count: items.length,
    items,
  };

  // Save test (raw) — para inspección rápida
  const testFile = join(TEST_DIR, `huggingface-${fetchedAt.slice(0, 10)}.json`);
  writeFileSync(testFile, JSON.stringify(payload, null, 2));
  console.log(`   💾 Test: ${testFile}`);

  // Save para pipeline
  writeFileSync(CACHE, JSON.stringify(payload, null, 2));
  console.log(`   💾 Cache: ${CACHE}`);

  // Sample
  if (items.length > 0) {
    const top = items[0];
    console.log(`   🥇 Top: "${top.title.slice(0, 80)}…" → ${top.url}`);
    console.log(`   👥 Authors: ${top.authors.slice(0, 3).join(', ')}…`);
  }
}

main().catch((e) => {
  console.error('💥 fetch-huggingface.mjs:', e.message);
  process.exit(1);
});
