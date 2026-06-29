#!/usr/bin/env node
/**
 * fetch-aa-models.mjs
 *
 * Trae TODOS los modelos de Artificial Analysis y los rankea.
 *
 * Endpoints:
 *  - GET https://artificialanalysis.ai/api/v2/data/llms/models
 *      → 543 modelos con 17 benchmarks detallados (MMLU-Pro, GPQA, HLE,
 *        LiveCodeBench, scicode, math_500, AIME, AIME-25, ifbench, lcr,
 *        terminalbench hard/v2.1, tau2, tau_banking) + pricing + perf.
 *        NO expone artificial_analysis_agentic_index.
 *
 *  - GET https://artificialanalysis.ai/api/v2/language/models/free
 *      → 200 modelos con los 3 índices principales: Intelligence,
 *        Coding, Agentic. Subset exacto del endpoint anterior (100%
 *        overlap por slug). Lo usamos SOLO para enriquecer con
 *        artificial_analysis_agentic_index los modelos del dataset grande.
 *
 * Tier detectado: FREE (sin openrouter_api_id, sin context_window).
 *
 * Output:
 *   - .cache/aa-models.json (raw)
 *   - public/data/aa-models.json (built) con rankings por benchmark
 *
 * Usage: node scripts/fetch-aa-models.mjs
 * Env:   ARTIFICIAL_ANALYSIS_API_KEY
 */

import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CACHE = join(ROOT, '.cache', 'aa-models.json');
const OUT = join(ROOT, 'public', 'data', 'aa-models.json');

const TOKEN = process.env.ARTIFICIAL_ANALYSIS_API_KEY ?? '';
if (!TOKEN) {
  console.error('❌ ARTIFICIAL_ANALYSIS_API_KEY no definida.');
  process.exit(1);
}

const ENDPOINT_DATA = 'https://artificialanalysis.ai/api/v2/data/llms/models';
const ENDPOINT_INDEXES = 'https://artificialanalysis.ai/api/v2/language/models/free';
const TOP_N = 20;

/**
 * Ordena modelos por una métrica y devuelve el top N con rank.
 * field es una función extractora — soporta campos en m.evaluations.* o a
 * top-level (m.median_output_tokens_per_second, etc.).
 */
function rankBy(models, field, topN, descending = true, { minScore = null } = {}) {
  const sorted = [...models]
    .filter((m) => {
      const v = field(m);
      if (v == null) return false;
      if (typeof v !== 'number' || Number.isNaN(v)) return false;
      // minScore=null = sin piso; minScore=0 = filtrar ceros (útil para precios o latencias "no medidas")
      if (minScore !== null && v <= minScore) return false;
      return true;
    })
    .sort((a, b) => {
      const va = field(a);
      const vb = field(b);
      return descending ? vb - va : va - vb;
    })
    .slice(0, topN);
  return sorted.map((m, i) => ({
    rank: i + 1,
    id: m.id,
    name: m.name,
    slug: m.slug,
    creator: m.model_creator?.name,
    creator_slug: m.model_creator?.slug,
    release_date: m.release_date,
    score: field(m),
    pricing: {
      input: m.pricing?.price_1m_input_tokens,
      output: m.pricing?.price_1m_output_tokens,
      blended: m.pricing?.price_1m_blended_3_to_1,
    },
    perf: {
      tokens_per_sec: m.median_output_tokens_per_second,
      ttft_seconds: m.median_time_to_first_token_seconds,
      ttfa_seconds: m.median_time_to_first_answer_token,
    },
  }));
}

const evalField = (k) => (m) => m.evaluations?.[k];
const topLevel = (k) => (m) => m[k];

async function fetchJson(url, label) {
  const res = await fetch(url, {
    headers: { 'x-api-key': TOKEN, Accept: 'application/json', 'User-Agent': 'rankradar' },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`AA ${label} ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

async function main() {
  if (!existsSync(dirname(CACHE))) mkdirSync(dirname(CACHE), { recursive: true });

  console.log('📡 Fetching Artificial Analysis — 2 endpoints…');
  // 1) Dataset grande (17 benchmarks)
  const dataJson = await fetchJson(ENDPOINT_DATA, 'data/llms/models');
  const models = dataJson.data ?? [];
  console.log(`   data/llms/models: ${models.length} modelos`);

  // 2) Subset "free" que trae los 3 índices principales (incluye agentic)
  let agenticBySlug = new Map();
  try {
    const idxJson = await fetchJson(ENDPOINT_INDEXES, 'language/models/free');
    const idxModels = idxJson.data ?? [];
    let withAgentic = 0;
    for (const m of idxModels) {
      const v = m.evaluations?.artificial_analysis_agentic_index;
      if (v != null && Number.isFinite(v)) {
        agenticBySlug.set(m.slug, v);
        withAgentic++;
      }
    }
    console.log(`   language/models/free: ${idxModels.length} modelos · ${withAgentic} con agentic_index`);
  } catch (e) {
    console.warn(`   ⚠️  language/models/free falló: ${e.message} — by_agentic quedará vacío`);
  }

  // Enriquecer modelos con agentic_index del subset "free"
  for (const m of models) {
    if (m.evaluations == null) m.evaluations = {};
    if (m.evaluations.artificial_analysis_agentic_index == null) {
      const v = agenticBySlug.get(m.slug);
      if (v != null) m.evaluations.artificial_analysis_agentic_index = v;
    }
  }

  // Detectar tier mediante ausencia de campos Pro
  const isPro = models.some((m) => m.openrouter_api_id || m.context_window || m.modalities);
  console.log(`   tier detectado: ${isPro ? 'PRO 🟢' : 'FREE 🟡'}`);
  const modelsWithAgentic = models.filter((m) => m.evaluations?.artificial_analysis_agentic_index != null).length;
  console.log(`   modelos con agentic_index en el dataset final: ${modelsWithAgentic}`);

  // Construir rankings por las métricas más valiosas
  const rankings = {
    by_intelligence: rankBy(models, evalField('artificial_analysis_intelligence_index'), TOP_N),
    by_coding: rankBy(models, evalField('artificial_analysis_coding_index'), TOP_N),
    by_agentic: rankBy(models, evalField('artificial_analysis_agentic_index'), TOP_N),
    by_math: rankBy(models, evalField('artificial_analysis_math_index'), TOP_N),
    by_mmlu_pro: rankBy(models, evalField('mmlu_pro'), TOP_N),
    by_gpqa: rankBy(models, evalField('gpqa'), TOP_N),
    by_livecodebench: rankBy(models, evalField('livecodebench'), TOP_N),
    by_hle: rankBy(models, evalField('hle'), TOP_N),
    // Performance — campos top-level, no están en evaluations
    by_speed: rankBy(models, topLevel('median_output_tokens_per_second'), TOP_N),
    by_ttft: rankBy(models, topLevel('median_time_to_first_token_seconds'), TOP_N, false, { minScore: 0 }), // excluye ttft=0 ("no medido")
    // Pricing — filtrar precios no listados (=0)
    by_cheapest_blended: rankBy(models, (m) => m.pricing?.price_1m_blended_3_to_1, TOP_N, false, { minScore: 0 }),
    by_cheapest_input: rankBy(models, (m) => m.pricing?.price_1m_input_tokens, TOP_N, false, { minScore: 0 }),
  };

  const payload = {
    fetched_at: new Date().toISOString(),
    source: 'Artificial Analysis',
    api: { data: ENDPOINT_DATA, indexes: ENDPOINT_INDEXES },
    tier: isPro ? 'pro' : 'free',
    models_with_agentic: modelsWithAgentic,
    total_models: models.length,
    rankings,
    // Todos los modelos para vistas tipo "explore" o filtros custom
    models: models.map((m) => ({
      id: m.id,
      name: m.name,
      slug: m.slug,
      creator: m.model_creator?.name,
      creator_slug: m.model_creator?.slug,
      release_date: m.release_date,
      intelligence: m.evaluations?.artificial_analysis_intelligence_index,
      coding: m.evaluations?.artificial_analysis_coding_index,
      agentic: m.evaluations?.artificial_analysis_agentic_index,
      math: m.evaluations?.artificial_analysis_math_index,
      mmlu_pro: m.evaluations?.mmlu_pro,
      gpqa: m.evaluations?.gpqa,
      hle: m.evaluations?.hle,
      livecodebench: m.evaluations?.livecodebench,
      price_input: m.pricing?.price_1m_input_tokens,
      price_output: m.pricing?.price_1m_output_tokens,
      tokens_per_sec: m.median_output_tokens_per_second,
      ttft_seconds: m.median_time_to_first_token_seconds,
    })),
  };

  writeFileSync(CACHE, JSON.stringify(payload, null, 2));
  writeFileSync(OUT, JSON.stringify(payload, null, 2));
  console.log(`💾 Saved: ${OUT}`);
  console.log(`   rankings: ${Object.keys(rankings).length} | top ${TOP_N} cada uno`);
}

main().catch((e) => {
  console.error('💥', e.message);
  process.exit(1);
});
