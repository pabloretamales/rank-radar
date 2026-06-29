#!/usr/bin/env node
/**
 * fetch-openrouter.mjs
 *
 * Trae:
 *  (a) Rankings de APPS: popular + trending
 *  (b) Catálogo de MODELOS vía /api/v1/models (338 modelos)
 *      y produce 4 rankings derivados (no hay endpoint público de "model-rankings"
 *      por uso, así que usamos métricas derivadas del catálogo oficial):
 *        - by_context      → context_length DESC
 *        - by_recent       → created DESC (más nuevos primero)
 *        - by_cheapest     → pricing.prompt ASC (excluye free=0)
 *        - by_multimodal   → prioriza modelos con más input_modalities
 *
 * Endpoint app-rankings: GET https://openrouter.ai/api/v1/datasets/app-rankings
 * Endpoint models catalog: GET https://openrouter.ai/api/v1/models  (público, sin auth)
 * Auth (solo app-rankings): cualquier OPENROUTER_API_KEY
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

const APP_ENDPOINT = 'https://openrouter.ai/api/v1/datasets/app-rankings';
const MODELS_ENDPOINT = 'https://openrouter.ai/api/v1/models';
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

async function fetchApps(sort) {
  const url = `${APP_ENDPOINT}?sort=${sort}&limit=${MAX_FETCH}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/json',
      'User-Agent': 'rankradar',
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`apps/${sort} ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function fetchModelsCatalog() {
  const res = await fetch(MODELS_ENDPOINT, {
    headers: { Accept: 'application/json', 'User-Agent': 'rankradar' },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`models catalog ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  return json.data ?? [];
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

/** Rankings derivados del catálogo de modelos. Asigna rank, name, score. */
function rankModels(models, scoreFn, topN, descending = true) {
  return [...models]
    .filter((m) => scoreFn(m) != null)
    .sort((a, b) => {
      const va = scoreFn(a);
      const vb = scoreFn(b);
      if (typeof va !== 'number' || typeof vb !== 'number') return 0;
      return descending ? vb - va : va - vb;
    })
    .slice(0, topN)
    .map((m, i) => {
      const arch = m.architecture ?? {};
      const modalities = [
        ...(arch.input_modalities ?? []),
        ...(arch.output_modalities ?? []).map((x) => `→${x}`),
      ];
      const pricing = m.pricing ?? {};
      const prompt = Number(pricing.prompt ?? 0);
      const completion = Number(pricing.completion ?? 0);
      return {
        rank: i + 1,
        id: m.id,
        slug: m.canonical_slug ?? m.id,
        name: m.name ?? m.id,
        description: m.description ?? '',
        context_length: m.context_length ?? null,
        modalities,
        n_inputs: (arch.input_modalities ?? []).length,
        n_outputs: (arch.output_modalities ?? []).length,
        created_ts: m.created ?? null,
        created_human: m.created ? new Date(m.created * 1000).toISOString().slice(0, 10) : null,
        pricing_prompt: Number.isFinite(prompt) ? prompt : null,
        pricing_completion: Number.isFinite(completion) ? completion : null,
        score: scoreFn(m),
        url: m.hugging_face_id
          ? `https://huggingface.co/${m.hugging_face_id}`
          : `https://openrouter.ai/models/${m.canonical_slug ?? m.id}`,
      };
    });
}

async function main() {
  if (!existsSync(dirname(CACHE))) mkdirSync(dirname(CACHE), { recursive: true });

  console.log('📡 Fetching OpenRouter: apps + catalog…');

  // Apps
  const popular = await fetchApps('popular');
  console.log(`   apps popular: ${popular.data?.length ?? 0}`);
  await new Promise((r) => setTimeout(r, 250));

  const trending = await fetchApps('trending').catch((e) => {
    console.warn(`   ⚠️  trending falló: ${e.message}`);
    return { data: [] };
  });
  console.log(`   apps trending: ${trending.data?.length ?? 0}`);

  // Models catalog (público, sin auth)
  const catalog = await fetchModelsCatalog();
  console.log(`   catalog modelos: ${catalog.length}`);

  // Derivados
  const byContext = rankModels(catalog, (m) => m.context_length ?? null, TOP_N);
  const byRecent = rankModels(catalog, (m) => m.created ?? null, TOP_N);
  const byCheapest = rankModels(
    catalog,
    (m) => {
      const p = Number(m.pricing?.prompt ?? NaN);
      return Number.isFinite(p) && p > 0 ? p : null;
    },
    TOP_N,
    false
  );
  const byMultimodal = rankModels(
    catalog,
    (m) => (m.architecture?.input_modalities?.length ?? 0) + (m.architecture?.output_modalities?.length ?? 0) * 0.5,
    TOP_N
  );

  const payload = {
    fetched_at: new Date().toISOString(),
    source: 'OpenRouter',
    api: { apps: APP_ENDPOINT, models: MODELS_ENDPOINT },
    apps_meta: popular.meta ?? {},
    top_n: TOP_N,
    rankings: {
      // Apps
      apps_popular: normalizeApps(popular.data ?? []).slice(0, TOP_N),
      apps_trending: normalizeApps(trending.data ?? []).slice(0, TOP_N),
      by_tokens: normalizeApps(
        [...(popular.data ?? [])]
          .sort((a, b) => Number(b.total_tokens || 0) - Number(a.total_tokens || 0))
          .slice(0, TOP_N)
      ),
      // Modelos (catálogo)
      by_context: byContext,
      by_recent: byRecent,
      by_cheapest: byCheapest,
      by_multimodal: byMultimodal,
    },
    models_total: catalog.length,
  };

  writeFileSync(CACHE, JSON.stringify(payload, null, 2));
  writeFileSync(OUT, JSON.stringify(payload, null, 2));
  console.log(`💾 Saved: ${OUT}`);
  const r = payload.rankings;
  console.log(
    `   apps: ${r.apps_popular.length}/${r.apps_trending.length}/${r.by_tokens.length}` +
      ` | modelos: ${r.by_context.length}/${r.by_recent.length}/${r.by_cheapest.length}/${r.by_multimodal.length}`
  );
}

main().catch((e) => {
  console.error('💥', e.message);
  process.exit(1);
});
