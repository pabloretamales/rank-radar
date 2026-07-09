#!/usr/bin/env node
/**
 * fetch-exploreyc.mjs
 *
 * Trae YC companies recientes desde la API de ExploreYC (free tier 5 req/día)
 * y produce dos JSON commiteados:
 *   - public/data/exploreyc-today.json   → top 5 AI-relevant del día
 *   - public/data/exploreyc-history.json → base acumulada, dedupe por id, sin repetir
 *
 * Estrategia de cuota (restricción dura: 5 req/día rolling 24h):
 *   - 1 call/día en operación normal → GET /companies?source=yc&limit=100
 *   - Cache "ya se corrió hoy" en .cache/exploreyc-last-date.txt → skip silent.
 *   - 429 → warning + skip (NO reintentar en el mismo día).
 *
 * Filtro AI:
 *   - ExploreYC tiene 10 industries (B2B, Software, etc) → no hay "AI" como slug.
 *   - Score keyword-based en name + one_liner + long_description + subindustry.
 *   - Solo se puntúan los N más recientes (no las 100).
 *
 * Coste histórico:
 *   - Sin reintentos, este script consume ~30 req/mes = OK con tier free.
 *   - Deja buffer para regeneraciones manuales / debugging.
 */

import {
  writeFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AI_KEYWORDS, AI_WEIGHTS, AI_MIN_SCORE } from './lib/ai-keywords.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const CACHE = join(ROOT, '.cache', 'exploreyc-last-date.txt');
const OUT_TODAY = join(ROOT, 'public', 'data', 'exploreyc-today.json');
const OUT_HISTORY = join(ROOT, 'public', 'data', 'exploreyc-history.json');

const API_BASE = 'https://api.exploreyc.com/api/v1';
const TOP_N = 5;              // cantidad que va al "today"
const FETCH_LIMIT = 100;      // cantidad pedida a la API
const TOP_AI_POOL = 30;       // solo los N más recientes se puntúan (ahorra CPU)

// ----- .env loader (sin dependencia externa) -----
function loadDotenv() {
  const envPath = join(ROOT, '.env');
  if (!existsSync(envPath)) return;
  for (const raw of readFileSync(envPath, 'utf-8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadDotenv();

const KEY = process.env.EYC_API_KEY;
if (!KEY) {
  console.error('❌ EYC_API_KEY no definida. Agregala a .env (chmod 600).');
  process.exit(2);
}

// ----- helpers -----
const TODAY = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC

function cacheSaysRanToday() {
  return existsSync(CACHE) && readFileSync(CACHE, 'utf-8').trim() === TODAY;
}

function markRanToday() {
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, TODAY);
}

function readJson(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return fallback;
  }
}

async function apiGet(path, label) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${KEY}`,
      Accept: 'application/json',
      'User-Agent': 'rankradar-exploreyc/1.0',
    },
  });
  const remaining = res.headers.get('x-ratelimit-remaining');
  const reset = res.headers.get('x-ratelimit-reset');
  if (res.status === 429) {
    const retryAfter = res.headers.get('retry-after');
    throw new Error(
      `429 rate-limit on ${label} (retry-after=${retryAfter ?? '?'}s, reset=${reset ?? '?'})`
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${label} ${res.status}: ${text.slice(0, 200)}`);
  }
  console.log(`  ✓ ${label}: HTTP ${res.status} (rate-limit remaining=${remaining ?? '?'})`);
  return {
    json: await res.json(),
    remaining: remaining != null ? Number(remaining) : null,
    reset: reset != null ? Number(reset) : null,
  };
}

function scoreCompany(c) {
  const haystack = ' ' + [
    c.name,
    c.one_liner,
    c.long_description,
    c.subindustry,
    c.industry,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9\-\.\s]/g, ' ')
    .replace(/\s+/g, ' ') + ' ';

  const signals = [];
  let score = 0;
  for (const kw of AI_KEYWORDS.strong) {
    if (haystack.includes(kw)) {
      score += AI_WEIGHTS.strong;
      signals.push(`strong:${kw.trim()}`);
    }
  }
  for (const kw of AI_KEYWORDS.medium) {
    if (haystack.includes(kw)) {
      score += AI_WEIGHTS.medium;
      signals.push(`medium:${kw.trim()}`);
    }
  }
  // dedupe + cap
  return { score: Math.min(score, 99), signals: [...new Set(signals)] };
}

function normalize(c) {
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    one_liner: c.one_liner ?? '',
    description: c.long_description ?? '',
    website: c.website ?? null,
    batch: c.batch ?? null,
    industry: c.industry ?? null,
    subindustry: c.subindustry ?? null,
    country: c.country ?? null,
    location: c.all_locations ?? null,
    team_size: c.team_size ?? null,
    stage: c.stage ?? null,
    is_hiring: c.is_hiring ?? false,
    top_company: c.top_company ?? false,
    status: c.status ?? null,
    logo: c.small_logo_thumb_url ?? null,
    created_at: c.created_at ?? null,
    updated_at: c.updated_at ?? null,
  };
}

function pickTop(relevant, n) {
  // 1° por AI score DESC, 2° por created_at DESC (más reciente primero)
  return [...relevant]
    .sort((a, b) => {
      if (b.ai_score !== a.ai_score) return b.ai_score - a.ai_score;
      return (b.created_at ?? '').localeCompare(a.created_at ?? '');
    })
    .slice(0, n);
}

// ----- main -----
async function main() {
  console.log('🌐 fetch-exploreyc.mjs — starting…');
  console.log(`   date (UTC): ${TODAY}`);

  if (cacheSaysRanToday()) {
    console.log(`⏭️   Ya se ejecutó hoy. Saliendo sin gastar API.`);
    process.exit(0);
  }

  // 1 request al día. /companies?source=yc&limit=100
  const { json, remaining, reset } = await apiGet(
    `/companies?source=yc&limit=${FETCH_LIMIT}`,
    'companies?source=yc'
  );

  const total = json.total ?? null;
  const companies = (json.companies ?? []).map(normalize);
  console.log(`📦 Recibidos ${companies.length} companies (total YC en dataset=${total})`);

  if (companies.length === 0) {
    console.warn('⚠️  Sin companies en la respuesta. Abort.');
    process.exit(1);
  }

  // re-sort por created_at DESC y solo puntúo los N más recientes (TOP_AI_POOL)
  const sortedByDate = [...companies].sort((a, b) =>
    (b.created_at ?? '').localeCompare(a.created_at ?? '')
  );
  const topRecent = sortedByDate.slice(0, TOP_AI_POOL);
  const scored = topRecent.map((c) => {
    const { score, signals } = scoreCompany(c);
    return { ...c, ai_score: score, ai_signals: signals };
  });
  const relevant = scored.filter((c) => c.ai_score >= AI_MIN_SCORE);
  const todayPicks = pickTop(relevant, TOP_N);

  console.log(
    `🎯 Pool: ${topRecent.length} | AI-relevant (≥${AI_MIN_SCORE}): ${relevant.length} | top ${TOP_N}: ${todayPicks.length}`
  );

  // ----- merge con history (dedupe por id, sin repetir) -----
  const prevHistory = readJson(OUT_HISTORY, { items: [] });
  const histMap = new Map(
    (prevHistory.items ?? []).map((it) => [it.id, it])
  );
  for (const c of todayPicks) {
    const existing = histMap.get(c.id);
    if (existing) {
      existing.last_seen = TODAY;
      existing.times_featured = (existing.times_featured ?? 1) + 1;
    } else {
      histMap.set(c.id, {
        ...c,
        first_seen: TODAY,
        last_seen: TODAY,
        times_featured: 1,
      });
    }
  }
  const history = [...histMap.values()].sort((a, b) =>
    (b.created_at ?? '').localeCompare(a.created_at ?? '')
  );

  const todayDoc = {
    schema: 'exploreyc-today/v1',
    fetched_at: new Date().toISOString(),
    date: TODAY,
    source: 'yc',
    rate_limit: { remaining, reset },
    totals: {
      yc_companies_seen: companies.length,
      yc_total_in_dataset: total,
      ai_scored_pool: topRecent.length,
      ai_relevant: relevant.length,
      shown: todayPicks.length,
    },
    items: todayPicks,
  };

  const historyDoc = {
    schema: 'exploreyc-history/v1',
    fetched_at: todayDoc.fetched_at,
    total: history.length,
    items: history,
  };

  mkdirSync(dirname(OUT_TODAY), { recursive: true });
  writeFileSync(OUT_TODAY, JSON.stringify(todayDoc, null, 2));
  writeFileSync(OUT_HISTORY, JSON.stringify(historyDoc, null, 2));
  markRanToday();

  console.log(`💾 Saved: ${OUT_TODAY} (${todayPicks.length} items)`);
  console.log(`💾 Saved: ${OUT_HISTORY} (${history.length} items total, no-repeat)`);
  console.log(`✅ Done. Rate-limit remaining after run: ${remaining}`);
}

main().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
