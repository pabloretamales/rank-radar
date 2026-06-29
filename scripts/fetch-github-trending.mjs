#!/usr/bin/env node
/**
 * fetch-github-trending.mjs
 *
 * Top 20 repos por estrellas para cada ventana:
 *   - 1d:   created:>YYYY-MM-DD (hoy)        → repos NUEVOS del día
 *   - 7d:   created:>YYYY-MM-DD (hace 7d)   → repos NUEVOS de la semana
 *   - 30d:  created:>YYYY-MM-DD (hace 30d)  → repos NUEVOS del mes
 *   - 90d:  created:>YYYY-MM-DD (hace 90d)  → repos NUEVOS del trimestre
 *   - all:  stars:>50000 + sort=stars        → ranking estable histórico
 *
 * Caveat: "top nuevos por ventana" mide lo más popular entre repos
 * recién creados en esa ventana — NO trending real con deltas. Es lo
 * mismo que muestra github.com/trending. Suficiente para el 90% de
 * los casos. Para deltas reales habría que trackear snapshots diarios
 * en una DB. Upgrade opcional, fuera del scope del MVP.
 *
 * Output: .cache/github-windows.json (raw)
 *         public/data/github-windows.json (built)
 *
 * Usage: node scripts/fetch-github-trending.mjs
 * Env:   GITHUB_TOKEN
 */

import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CACHE = join(ROOT, '.cache', 'github-windows.json');
const OUT = join(ROOT, 'public', 'data', 'github-windows.json');

const TOKEN = process.env.GITHUB_TOKEN ?? '';
if (!TOKEN) {
  console.error('❌ GITHUB_TOKEN no definida.');
  process.exit(1);
}

const TOP_N = 20;
const TODAY = new Date();

function dateMinus(days) {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Realiza una llamada a GitHub Search API con retry exponencial básico. */
async function searchRepos(query, sort, order, perPage, attempt = 1) {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=${sort}&order=${order}&per_page=${perPage}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'rankradar',
    },
  });
  if (res.status === 403 && attempt < 4) {
    // Rate limit — esperar más cada vez
    const wait = 2000 * attempt;
    console.warn(`   ⏳ 429/403 → ${wait}ms (intento ${attempt})`);
    await new Promise((r) => setTimeout(r, wait));
    return searchRepos(query, sort, order, perPage, attempt + 1);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub search "${query}" ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

function normalizeRepo(r) {
  return {
    rank: 0, // se asigna después
    full_name: r.full_name,
    name: r.name,
    owner: r.owner?.login,
    description: r.description,
    html_url: r.html_url,
    stargazers_count: r.stargazers_count,
    forks_count: r.forks_count,
    language: r.language,
    topics: r.topics ?? [],
    created_at: r.created_at,
    pushed_at: r.pushed_at,
    updated_at: r.updated_at,
    license: r.license?.spdx_id ?? null,
    open_issues_count: r.open_issues_count,
    watchers_count: r.subscribers_count ?? r.watchers_count,
    archived: r.archived,
    private: r.private,
  };
}

async function fetchWindow(label, query, sort, order) {
  const json = await searchRepos(query, sort, order, TOP_N);
  const items = (json.items ?? []).filter((r) => !r.fork && !r.archived);
  const trimmed = items.slice(0, TOP_N).map((r, i) => ({
    ...normalizeRepo(r),
    rank: i + 1,
  }));
  console.log(`   ${label.padEnd(6)}: ${trimmed.length}/${items.length} repos`);
  return {
    label,
    query,
    total_count: json.total_count ?? 0,
    items: trimmed,
    fetched_at: new Date().toISOString(),
  };
}

async function main() {
  if (!existsSync(dirname(CACHE))) mkdirSync(dirname(CACHE), { recursive: true });

  console.log('📡 Fetching GitHub Search — top 20 per window…');
  const windows = [
    ['1d', `created:>${dateMinus(0)}`, 'stars', 'desc'],
    ['7d', `created:>${dateMinus(7)}`, 'stars', 'desc'],
    ['30d', `created:>${dateMinus(30)}`, 'stars', 'desc'],
    ['90d', `created:>${dateMinus(90)}`, 'stars', 'desc'],
    ['all', 'stars:>50000', 'stars', 'desc'],
  ];

  const results = [];
  for (const [label, q, sort, order] of windows) {
    try {
      const w = await fetchWindow(label, q, sort, order);
      results.push(w);
      // Pequeña pausa para ser amable con rate limit (5000 req/h authenticated)
      await new Promise((r) => setTimeout(r, 250));
    } catch (e) {
      console.error(`   ❌ ${label}: ${e.message}`);
      results.push({ label, query: q, total_count: 0, items: [], error: e.message });
    }
  }

  const payload = {
    fetched_at: new Date().toISOString(),
    source: 'GitHub Search API',
    api: 'https://api.github.com/search/repositories',
    top_n: TOP_N,
    windows: results,
  };

  writeFileSync(CACHE, JSON.stringify(payload, null, 2));
  writeFileSync(OUT, JSON.stringify(payload, null, 2));
  console.log(`💾 Saved: ${OUT}`);
  console.log(`   Total items: ${results.reduce((s, w) => s + w.items.length, 0)}`);
}

main().catch((e) => {
  console.error('💥', e.message);
  process.exit(1);
});
