#!/usr/bin/env node
/**
 * fetch-hackernews.mjs — Pulse IA source 2/6
 *
 * Hacker News — top stories filtered for AI relevance.
 * Free Algolia API, no auth, no rate limit issues para nuestro uso.
 *
 * Strategy:
 *   1. GET /api/v1/search?tags=front_page&hitsPerPage=100 → top 100 stories
 *   2. Filter: keep only stories with AI/ML keywords in title or url
 *   3. Sort by points desc, take top 25
 *
 * Keywords: ai, llm, gpt, claude, gemini, llama, mistral, agent, rag,
 *           transformer, neural, model, machine learning, deep learning,
 *           openai, anthropic, stability, midjourney, diffusion, etc.
 *
 * Usage: node scripts/news/fetch-hackernews.mjs
 *
 * Output:
 *   - .cache/test-fetches/hackernews-{date}.json
 *   - .cache/hackernews.json
 *
 * NOTE: Hacker News migró de Firebase a Algolia. Endpoint clásico
 *       /v0/topstories.json ya NO existe (404). Este usa la nueva API.
 */

import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const TEST_DIR = join(ROOT, '.cache', 'test-fetches');
const CACHE = join(ROOT, '.cache', 'hackernews.json');

const API = 'https://hn.algolia.com/api/v1';

const AI_KEYWORDS = [
  ' ai', 'ai ', ' ai,', 'ai.', ' ai?', 'ai!', 'ai/', 'ai-',
  'llm', 'gpt', 'claude', 'gemini', 'llama', 'mistral', 'qwen', 'deepseek',
  'transformer', 'diffusion', 'rag', 'agent', 'agents', 'agentic',
  'openai', 'anthropic', 'stability ai', 'midjourney', 'hugging face', 'huggingface',
  'machine learning', 'deep learning', 'neural', ' ml ', ' ml,', 'ml/', 'ml-',
  'fine-tun', 'fine tun', 'tokeniz', 'embedding', 'vector db', 'chatbot',
  'copilot', 'code model', 'reasoning model', 'multimodal', 'text-to-',
  'inference', 'prompt', 'context window', 'rlhf', 'dpo',
];

function isAIRelevant(title, url) {
  const t = ` ${(title ?? '').toLowerCase()} `;
  const u = (url ?? '').toLowerCase();
  for (const k of AI_KEYWORDS) {
    if (t.includes(k)) return true;
    if (u.includes(k)) return true;
  }
  return false;
}

async function fetchTopStoriesAlgolia() {
  // Algolia HN search con tag=front_page → top de la portada
  // hitsPerPage=100 para tener buen pool
  const url = `${API}/search?tags=front_page&hitsPerPage=100`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'pulse-ia/0.1' },
  });
  if (!res.ok) throw new Error(`HN Algolia search ${res.status}`);
  const json = await res.json();
  return json.hits ?? [];
}

/**
 * Normaliza un hit de Algolia a nuestro NewsItem (parcial, en normalize.mjs
 * se completan campos como summary_es y score).
 *
 * Shape Algolia de un story:
 *   { objectID, title, url, author, points, num_comments,
 *     created_at: "2026-07-05T21:15:25Z", story_id, _tags: ['story', ...] }
 */
function normalizeItem(hit, fetchedAt) {
  const id = hit.objectID ?? hit.story_id;
  return {
    source_id: 'hackernews',
    source_name: 'Hacker News',
    source_url: 'https://news.ycombinator.com',
    id_on_source: String(id),
    title: hit.title ?? hit.story_title ?? '(sin título)',
    url: hit.url ?? `https://news.ycombinator.com/item?id=${id}`,
    hn_url: `https://news.ycombinator.com/item?id=${id}`,
    score: hit.points ?? 0,
    comments: hit.num_comments ?? 0,
    by: hit.author ?? null,
    submitted_at: hit.created_at ?? null,
    fetched_at: fetchedAt,
  };
}

async function main() {
  const fetchedAt = new Date().toISOString();
  if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
  if (!existsSync(dirname(CACHE))) mkdirSync(dirname(CACHE), { recursive: true });

  console.log('📡 Fetching Hacker News (Algolia) front page…');
  const hits = await fetchTopStoriesAlgolia();
  console.log(`   📦 ${hits.length} stories from front_page`);

  // Filtrar por AI keywords
  const aiItems = hits.filter((it) => it.title && isAIRelevant(it.title, it.url));
  console.log(`   🎯 AI-relevant: ${aiItems.length} / ${hits.length}`);

  // Ordenar por points desc, tomar top 25
  aiItems.sort((a, b) => (b.points ?? 0) - (a.points ?? 0));
  const top = aiItems.slice(0, 25).map((it) => normalizeItem(it, fetchedAt));

  const payload = {
    fetched_at: fetchedAt,
    source: 'hackernews',
    endpoint: `${API}/search?tags=front_page`,
    total_front_page: hits.length,
    ai_relevant: aiItems.length,
    items: top,
  };

  const testFile = join(TEST_DIR, `hackernews-${fetchedAt.slice(0, 10)}.json`);
  writeFileSync(testFile, JSON.stringify(payload, null, 2));
  console.log(`   💾 Test: ${testFile}`);

  writeFileSync(CACHE, JSON.stringify(payload, null, 2));
  console.log(`   💾 Cache: ${CACHE}`);

  if (top.length > 0) {
    const t = top[0];
    console.log(`   🥇 Top: "${t.title.slice(0, 70)}…" (${t.score} pts, ${t.comments} comments)`);
    console.log(`   🔗 ${t.url.slice(0, 80)}…`);
  }
}

main().catch((e) => {
  console.error('💥 fetch-hackernews.mjs:', e.message);
  process.exit(1);
});
