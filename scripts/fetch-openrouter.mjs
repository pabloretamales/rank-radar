#!/usr/bin/env node
/**
 * fetch-openrouter.mjs
 *
 * Rankings de apps de OpenRouter (popular + trending + categories).
 * Endpoint: GET https://openrouter.ai/api/v1/datasets/app-rankings
 * Auth:    Bearer OPENROUTER_API_KEY (cualquier key, incluso con 0
 *          crédito — el endpoint no consume tokens de inferencia).
 * Rate:    30 req/min, 500 req/día por key.
 *
 * Output:
 *   - .cache/openrouter.json (raw)
 *   - public/data/openrouter.json (built) con rankings
 *
 * Usage: node scripts/fetch-openrouter.mjs
 * Env:   OPENROUTER_API_KEY
 */

import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CACHE = join(ROOT, '.cache', 'openrouter.json');
const OUT = join(ROOT, 'public', 'data', 'openrouter.json');

const TOKEN = process.env.OPENROUTER_API_KEY ?? '';
if (!TOKEN) {
  console.error('❌ OPENROUTER_API_KEY no definida.');
  process.exit(1);
}

const ENDPOINT = 'https://openrouter.ai/api/v1/datasets/app-rankings';
const TOP_N = 20;
const MAX_FETCH = Math.max(TOP_N + 5, 50);

function formatTokens(n) {
  const num = Number(n) || 0;
  if (num >= 1e12) return (num / 1e12).toFixed(2) + 'T';
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
  return String(num);
}

async function fetchRankings(sort, limit) {
  const url = `${ENDPOINT}?sort=${sort}&limit=${limit}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/json',
      'User-Agent': 'rankradar',
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenRouter ${sort} ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

function normalizeApps(apps) {
  return apps
    .filter((a) => a && a.app_name)
    .map((a) => ({
      rank: a.rank,
      app_id: a.app_id,
      app_name: a.app_name,
      total_tokens: a.total_tokens,
      total_tokens_human: formatTokens(a.total_tokens),
      total_requests: a.total_requests,
      total_requests_human: formatTokens(a.total_requests),
    }));
}

async function main() {
  if (!existsSync(dirname(CACHE))) mkdirSync(dirname(CACHE), { recursive: true });

  console.log('📡 Fetching OpenRouter rankings…');

  const popular = await fetchRankings('popular', MAX_FETCH);
  console.log(`   popular: ${popular.data?.length ?? 0} apps`);
  await new Promise((r) => setTimeout(r, 300));

  const trending = await fetchRankings('trending', MAX_FETCH).catch((e) => {
    console.warn(`   ⚠️  trending falló: ${e.message}`);
    return { data: [] };
  });
  console.log(`   trending: ${trending.data?.length ?? 0} apps`);

  const byTokens = [...(popular.data ?? [])]
    .sort((a, b) => Number(b.total_tokens || 0) - Number(a.total_tokens || 0))
    .slice(0, TOP_N)
    .map((a, i) => ({ ...a, rank_by_tokens: i + 1 }));

  const payload = {
    fetched_at: new Date().toISOString(),
    source: 'OpenRouter',
    api: ENDPOINT,
    meta: popular.meta ?? {},
    top_n: TOP_N,
    rankings: {
      popular: normalizeApps(popular.data ?? []).slice(0, TOP_N),
      trending: normalizeApps(trending.data ?? []).slice(0, TOP_N),
      by_tokens: normalizeApps(byTokens),
    },
  };

  writeFileSync(CACHE, JSON.stringify(payload, null, 2));
  writeFileSync(OUT, JSON.stringify(payload, null, 2));
  console.log(`💾 Saved: ${OUT}`);
  console.log(
    `   popular: ${payload.rankings.popular.length} | trending: ${payload.rankings.trending.length} | by_tokens: ${payload.rankings.by_tokens.length}`
  );
}

main().catch((e) => {
  console.error('💥', e.message);
  process.exit(1);
});
