#!/usr/bin/env node
/**
 * fetch-github-ai.mjs — Pulse IA source 5/6
 *
 * GitHub Trending — repos AI/ML/LLM nuevos esta semana, top por estrellas.
 * Reutiliza GITHUB_TOKEN del script fetch-github-trending.mjs.
 *
 * Este fetcher es específico para Pulse IA: NO es el "Top repos generales"
 * (eso ya existe en /rankings → GitHub Trending). Aquí filtramos por
 * keywords de IA + topics oficiales de GitHub.
 *
 * Topics oficiales de GitHub para filtrar:
 *   llm, ai-agent, openai, anthropic, claude, gpt, langchain, llamaindex,
 *   stable-diffusion, huggingface, transformer, embeddings, rag, mcp
 *
 * Strategy:
 *   - Query: (llm OR openai OR anthropic OR "machine learning" ...)
 *           -filter: forks
 *           -filter: archived
 *   - Window: 7d (top de la semana — más estable que daily)
 *   - Sort: stars desc, 20 items
 *
 * Usage: node scripts/news/fetch-github-ai.mjs
 *
 * Output:
 *   - .cache/test-fetches/github-ai-{date}.json
 *   - .cache/github-ai.json
 */

import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const TEST_DIR = join(ROOT, '.cache', 'test-fetches');
const CACHE = join(ROOT, '.cache', 'github-ai.json');

const TOKEN = process.env.GITHUB_TOKEN ?? '';
if (!TOKEN) {
  console.error('❌ GITHUB_TOKEN no definida.');
  process.exit(1);
}

const API = 'https://api.github.com/search/repositories';
const TOP_N = 20;

// Query combinada: AI repos creados en los últimos 7 días con buen nivel de stars.
// GitHub Search API limita a 5 OR operators — usamos los 4 topics más amplios
// que cubren ~90% de repos AI/ML (llm, ai-agent, openai, huggingface).
// Buscamos repos AI usando topic:llm (el más poblado, ~6K repos) + keywords
// populares en description. Topic restrictions son estrictos pero efectivos.
// Combinamos 2 queries porque GitHub limita a 5 operators AND/OR/NOT.
const QUERIES = [
  // Query 1: Repos con topic llm + creado reciente + muchas estrellas
  { q: `topic:llm stars:>50 created:>${dateMinus(7)}`, label: 'llm' },
  // Query 2: Repos AI con keywords populares en name/description
  { q: `(claude OR gemini OR llama OR stable-diffusion OR rag) stars:>30 created:>${dateMinus(7)}`, label: 'keywords' },
];

function dateMinus(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

async function searchRepos(queryStr, attempt = 1) {
  const url = `${API}?q=${encodeURIComponent(queryStr)}&sort=stars&order=desc&per_page=${TOP_N}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'pulse-ia/0.1',
    },
  });
  if (res.status === 403 || res.status === 429) {
    if (attempt < 3) {
      const wait = 3000 * attempt;
      console.warn(`   ⏳ ${res.status} → ${wait}ms (intento ${attempt})`);
      await new Promise((r) => setTimeout(r, wait));
      return searchRepos(queryStr, attempt + 1);
    }
  }
  if (!res.ok) throw new Error(`GitHub search ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

function normalizeRepo(r, fetchedAt) {
  return {
    source_id: 'github-ai',
    source_name: 'GitHub Trending · AI',
    source_url: 'https://github.com/topics/llm',
    id_on_source: String(r.id),
    title: r.full_name + (r.description ? ` — ${r.description}` : ''),
    repo_full_name: r.full_name,
    repo_name: r.name,
    repo_owner: r.owner?.login,
    repo_description: r.description,
    url: r.html_url,
    stars: r.stargazers_count,
    forks: r.forks_count,
    language: r.language,
    topics: r.topics ?? [],
    created_at: r.created_at,
    submitted_at: r.created_at, // alias para uniformidad
    pushed_at: r.pushed_at,
    fetched_at: fetchedAt,
    score: r.stargazers_count,
    comments: r.open_issues_count,
  };
}

async function main() {
  const fetchedAt = new Date().toISOString();
  if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
  if (!existsSync(dirname(CACHE))) mkdirSync(dirname(CACHE), { recursive: true });

  console.log('📡 Fetching GitHub Trending · AI (last 7d, 2 queries)…');
  // Construimos queries ahora que la función dateMinus() ya existe arriba
  const queries = [
    { q: `topic:llm stars:>50 created:>${dateMinus(7)}`, label: 'llm' },
    { q: `(claude OR gemini OR llama OR stable-diffusion OR rag) stars:>30 created:>${dateMinus(7)}`, label: 'keywords' },
  ];
  const all = [];
  let totalCount = 0;
  for (const { q, label } of queries) {
    try {
      const json = await searchRepos(q);
      const c = json.total_count ?? 0;
      const items = (json.items ?? []).filter((r) => !r.fork && !r.archived);
      console.log(`   📦 [${label}] total: ${c}, kept: ${items.length}`);
      totalCount += c;
      for (const it of items) all.push(normalizeRepo(it, fetchedAt));
      await new Promise((r) => setTimeout(r, 500));
    } catch (e) {
      console.warn(`   ⚠️  [${label}]: ${e.message}`);
    }
  }

  // Sort by stars desc
  all.sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0));
  const items = all.slice(0, TOP_N).map((r, i) => ({ ...r, rank: i + 1 }));
  console.log(`   🔄 Total combined: ${totalCount}, top ${items.length}`);

  const payload = {
    fetched_at: fetchedAt,
    source: 'github-ai',
    endpoint: API,
    queries: queries.map((q) => ({ label: q.label, q: q.q })),
    total_count: totalCount,
    items,
  };

  const testFile = join(TEST_DIR, `github-ai-${fetchedAt.slice(0, 10)}.json`);
  writeFileSync(testFile, JSON.stringify(payload, null, 2));
  console.log(`   💾 Test: ${testFile}`);

  writeFileSync(CACHE, JSON.stringify(payload, null, 2));
  console.log(`   💾 Cache: ${CACHE}`);

  if (items.length > 0) {
    const t = items[0];
    console.log(`   🥇 Top: "${t.repo_full_name}" — ${t.repo_description?.slice(0, 70) ?? ''}`);
    console.log(`   ⭐ ${t.stars} stars · ${t.language ?? 'n/a'}`);
    console.log(`   🔗 ${t.url}`);
  }
}

main().catch((e) => {
  console.error('💥 fetch-github-ai.mjs:', e.message);
  process.exit(1);
});
