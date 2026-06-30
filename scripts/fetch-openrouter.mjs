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

async function fetchApps(sort, startDate, endDate) {
  let url = `${APP_ENDPOINT}?sort=${sort}&limit=${MAX_FETCH}`;
  if (startDate) url += `&start_date=${startDate}`;
  if (endDate) url += `&end_date=${endDate}`;
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

// Helper: fetch 3 modes (popular, trending, by-tokens) for a window
async function fetchAppsByWindow(startDate, endDate) {
  const [pop, trend] = await Promise.all([
    fetchApps('popular', startDate, endDate),
    fetchApps('trending', startDate, endDate).catch((e) => {
      console.warn(`     ⚠️  trending (${startDate}..${endDate}) falló: ${e.message}`);
      return { data: [] };
    }),
  ]);
  await new Promise((r) => setTimeout(r, 250));
  // Por tokens = mismo set reordenado por tokens (mismo endpoint, distinto sort interno).
  const byTokensData = pop.data ?? [];
  const meta = pop.meta ?? trend.meta ?? {};
  return {
    popular: normalizeApps(pop.data ?? []).slice(0, TOP_N),
    trending: normalizeApps(trend.data ?? []).slice(0, TOP_N),
    by_tokens: normalizeApps(
      [...byTokensData].sort((a, b) => Number(b.total_tokens || 0) - Number(a.total_tokens || 0))
    ).slice(0, TOP_N),
    meta,
  };
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

/**
 * Top modelos por total_tokens en una ventana (default 30 días).
 * Devuelve ranking diario desde /api/v1/datasets/rankings-daily; agregamos
 * por model_permaslug y ordenamos desc. Cross-match con el catálogo para
 * enriquecer con name/modalities/etc.
 */
async function fetchModelsByTokens(days = 30) {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days);
  const startStr = start.toISOString().slice(0, 10);
  const endStr = end.toISOString().slice(0, 10);
  const url = `${APP_ENDPOINT.replace('app-rankings', 'rankings-daily')}?start_date=${startStr}&end_date=${endStr}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/json',
      'User-Agent': 'rankradar',
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`rankings-daily ${res.status}: ${text.slice(0, 200)}`);
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

  console.log('📡 Fetching OpenRouter: apps (3 windows) + catalog…');

  // Apps — 3 ventanas tipo UI oficial de OR: Hoy / Una semana / Un mes.
  // Pablo 2026-06-29 20:21 CLT: la UI de OpenRouter muestra los mismos rankings
  // de apps pero con esos 3 periodos. Cada ventana es un único ranking
  // (popular/trending devuelven mismo set en ventana corta, by-tokens es el
  // mismo set reordenado — Pablo pidió un solo "Global Ranking").
  const today = new Date();
  today.setUTCDate(today.getUTCDate() - 1); // OR suele tener datos hasta ayer
  const yyyymmdd = (d) => d.toISOString().slice(0, 10);
  const dayEnd = yyyymmdd(today);
  const dayStart = yyyymmdd(today);
  const weekStart = yyyymmdd(new Date(today.getTime() - 6 * 24 * 3600 * 1000));
  const monthStart = yyyymmdd(new Date(today.getTime() - 29 * 24 * 3600 * 1000));

  console.log(`   apps: day=${dayStart} week=${weekStart}..${dayEnd} month=${monthStart}..${dayEnd}`);
  // Cada ventana trae 1 ranking (popular). trending y by-tokens se mantienen
  // en el JSON por compatibilidad pero no se exponen en UI (eran idénticos).
  const apps1d = await fetchAppsByWindow(dayStart, dayEnd);
  const apps7d = await fetchAppsByWindow(weekStart, dayEnd);
  const apps30d = await fetchAppsByWindow(monthStart, dayEnd);
  console.log(`     1d=${apps1d.popular.length} 7d=${apps7d.popular.length} 30d=${apps30d.popular.length}`);

  // Models catalog (público, sin auth)
  const catalog = await fetchModelsCatalog();
  console.log(`   catalog modelos: ${catalog.length}`);

  // Slimeado para cross-match con AA (mantiene slug, context, modalities, pricing)
  const catalogSlim = catalog.map((m) => {
    const arch = m.architecture ?? {};
    return {
      id: m.id,
      canonical_slug: m.canonical_slug ?? null,
      name: m.name ?? m.id,
      context_length: m.context_length ?? null,
      modalities: [
        ...(arch.input_modalities ?? []),
        ...(arch.output_modalities ?? []).map((x) => `→${x}`),
      ],
      n_inputs: (arch.input_modalities ?? []).length,
      n_outputs: (arch.output_modalities ?? []).length,
      pricing_prompt: Number(m.pricing?.prompt ?? 0) || null,
      pricing_completion: Number(m.pricing?.completion ?? 0) || null,
      created_human: m.created ? new Date(m.created * 1000).toISOString().slice(0, 10) : null,
      url: m.hugging_face_id
        ? `https://huggingface.co/${m.hugging_face_id}`
        : `https://openrouter.ai/models/${m.canonical_slug ?? m.id}`,
    };
  });

  // Derivados: apps + recientes (catálogo) + ranking por uso (rankings-daily).
  // Pablo (2026-06-29): el dashboard se centra en modelos por uso de tokens,
  // con 4 ventanas: hoy (1d), semana (7d), mes (30d), trending (delta 7d).
  const byRecent = rankModels(catalog, (m) => m.created ?? null, TOP_N);

  // Func helper para cross-match con catálogo de OR
  function crossMatch(perma) {
    if (!perma) return null;
    let match = catalogByIdGlobal.get(perma);
    if (!match) {
      const stripped = perma.replace(/-\d{8}$/, '');
      match = catalogByIdGlobal.get(stripped);
    }
    if (!match) {
      for (const m of catalog) {
        if (m.id && perma.replace(/-\d{8}$/, '').startsWith(m.id)) {
          match = m; break;
        }
      }
    }
    return match;
  }
  function buildModelsByTokensRow(perma, total, i, meta) {
    const match = crossMatch(perma);
    return {
      rank: i + 1,
      id: match?.id ?? perma,
      name: match?.name ?? perma,
      slug: match?.canonical_slug ?? null,
      total_tokens: total,
      total_tokens_human: formatTokens(total),
      perma,
      url: match?.url ?? `https://openrouter.ai/models/${perma}`,
      modalities: match?.modalities ?? [],
      context_length: match?.context_length ?? null,
      pricing_prompt: match?.pricing_prompt ?? null,
      pricing_completion: match?.pricing_completion ?? null,
      window: meta,
    };
  }
  async function tokensInWindow(days) {
    const j = await fetchModelsByTokens(days);
    const daily = j?.data ?? [];
    const totals = new Map();
    for (const e of daily) {
      const slug = e.model_permaslug;
      const t = Number(e.total_tokens);
      if (!Number.isFinite(t) || !slug) continue;
      totals.set(slug, (totals.get(slug) ?? 0) + t);
    }
    return { totals, meta: j?.meta ?? {} };
  }

  const catalogByIdGlobal = new Map();
  for (const m of catalog) catalogByIdGlobal.set(m.id, m);

  const WINDOW_TODAY   = { key: 'today',    days: 1,  i18n: 'today'    };
  const WINDOW_WEEK    = { key: 'week',     days: 7,  i18n: 'week'     };
  const WINDOW_MONTH   = { key: 'month',    days: 30, i18n: 'month'    };
  // Para trending: 7d recientes vs 7d anteriores.
  const WINDOW_TREND_CUR  = { key: 'trend_cur',  days: 7,  i18n: 'trend_cur'  };
  const WINDOW_TREND_PREV = { key: 'trend_prev', days: 14, i18n: 'trend_prev' }; // se agregan los últimos 14d pero descartando los 7 ya usados como "current"

  let modelsByTokens = { today: [], week: [], month: [], trending: [], meta: {} };
  let lastMeta = {};
  try {
    // Hacemos las 4 fetches en serie (poco volumen).
    const today = await tokensInWindow(WINDOW_TODAY.days);
    lastMeta = today.meta;
    const todayTop = [...today.totals.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, TOP_N)
      .map(([p, t], i) => buildModelsByTokensRow(p, t, i, 'today'));
    const week   = await tokensInWindow(WINDOW_WEEK.days);
    const weekTop = [...week.totals.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, TOP_N)
      .map(([p, t], i) => buildModelsByTokensRow(p, t, i, 'week'));
    const month  = await tokensInWindow(WINDOW_MONTH.days);
    const monthTop = [...month.totals.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, TOP_N)
      .map(([p, t], i) => buildModelsByTokensRow(p, t, i, 'month'));
    // Trending = (semana actual) - (semana anterior).
    // Para la semana anterior, fetch de 14d y descartamos los 7 más recientes.
    const recent14 = await tokensInWindow(14);
    const sumLast7 = new Map();
    const sumPrev7 = new Map();
    if (recent14.meta?.end_date) {
      const endDate = new Date(recent14.meta.end_date + 'T00:00:00Z');
      const todayMs = endDate.getTime();
      for (const e of recent14.meta?.data ?? []) {}
    }
    // Recalcular con split por fecha:
    const recent14Json = await fetchModelsByTokens(14);
    const splitEndDate = new Date(recent14Json.meta?.end_date + 'T00:00:00Z');
    const startDateMs = splitEndDate.getTime() - 6 * 24 * 3600 * 1000; // inclusive de los 7 días más recientes
    for (const e of recent14Json.data ?? []) {
      const dt = new Date(e.date + 'T00:00:00Z').getTime();
      const map = dt > startDateMs ? sumLast7 : sumPrev7;
      const slug = e.model_permaslug;
      const t = Number(e.total_tokens);
      if (!Number.isFinite(t) || !slug) continue;
      map.set(slug, (map.get(slug) ?? 0) + t);
    }
    const trending = [];
    for (const [slug, recent7] of sumLast7.entries()) {
      const prev7 = sumPrev7.get(slug) ?? 0;
      const excess = recent7 - prev7;
      if (excess > 0) trending.push({ slug, recent7, prev7, excess });
    }
    trending.sort((a, b) => b.excess - a.excess);
    const trendingTop = trending.slice(0, TOP_N).map((t, i) => {
      const match = crossMatch(t.slug);
      return {
        rank: i + 1,
        id: match?.id ?? t.slug,
        name: match?.name ?? t.slug,
        slug: match?.canonical_slug ?? null,
        total_tokens: t.excess, // mostramos el excess como el valor principal
        total_tokens_human: formatTokens(t.excess),
        recent7: t.recent7,
        recent7_human: formatTokens(t.recent7),
        prev7: t.prev7,
        prev7_human: formatTokens(t.prev7),
        perma: t.slug,
        url: match?.url ?? `https://openrouter.ai/models/${t.slug}`,
        modalities: match?.modalities ?? [],
        context_length: match?.context_length ?? null,
        window: 'trending',
      };
    });

    modelsByTokens = {
      today: todayTop,
      week: weekTop,
      month: monthTop,
      trending: trendingTop,
      meta: lastMeta,
    };
    console.log(
      `   models_by_tokens: today=${todayTop.length} week=${weekTop.length} month=${monthTop.length} trending=${trendingTop.length}`
    );
  } catch (e) {
    console.warn(`   ⚠️  rankings-daily falló: ${e.message}`);
  }

  const payload = {
    fetched_at: new Date().toISOString(),
    source: 'OpenRouter',
    api: { apps: APP_ENDPOINT, models: MODELS_ENDPOINT },
    apps_meta: apps30d.meta ?? {},
    rankings_meta: lastMeta,
    top_n: TOP_N,
    rankings: {
      // Apps: Global Ranking con 3 periodos (Hoy / Esta semana / Este mes).
      apps_today:  apps1d.popular,
      apps_week:   apps7d.popular,
      apps_month:  apps30d.popular,
      // Modelos: derivado honesto del catálogo (no es ranking de uso oficial)
      by_recent: byRecent,
      // Modelos por uso (rankings-daily) en 4 ventanas
      ...modelsByTokens,
    },
    apps_meta_windowed: {
      today:  apps1d.meta,
      week:   apps7d.meta,
      month:  apps30d.meta,
    },
    models_total: catalog.length,
    catalog: catalogSlim,
  };

  writeFileSync(CACHE, JSON.stringify(payload, null, 2));
  writeFileSync(OUT, JSON.stringify(payload, null, 2));
  console.log(`💾 Saved: ${OUT}`);
  const r = payload.rankings;
  console.log(
    `   apps: today=${r.apps_today.length} week=${r.apps_week.length} month=${r.apps_month.length}` +
      ` | by_recent: ${r.by_recent.length}` +
      ` | mbt: today=${r.today.length} week=${r.week.length} month=${r.month.length} trending=${r.trending.length}`
  );
}

main().catch((e) => {
  console.error('💥', e.message);
  process.exit(1);
});
