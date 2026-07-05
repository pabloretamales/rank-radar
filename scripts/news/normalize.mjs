#!/usr/bin/env node
/**
 * normalize.mjs — Pulse IA items normalizer + dedupe + score
 *
 * Lee los 5 archivos crudos de .cache/*.json, los normaliza a NewsItem,
 * deduplica items que aparecen en múltiples fuentes, calcula score de
 * relevancia, y guarda el resultado en .cache/news-normalized.json.
 *
 * Output: .cache/news-normalized.json (ready for summarize.mjs)
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const CACHE = join(ROOT, '.cache');

const SOURCES = [
  { id: 'huggingface-papers', file: 'huggingface-papers.json' },
  { id: 'hackernews', file: 'hackernews.json' },
  { id: 'reddit', file: 'reddit.json' },
  { id: 'arxiv', file: 'arxiv.json' },
  { id: 'github-ai', file: 'github-ai.json' },
];

const OUT = join(CACHE, 'news-normalized.json');

// Categorización por keywords (heurística V1, simple y rápida)
const CATEGORY_RULES = [
  { cat: 'paper', kw: ['paper', 'arxiv', 'research', 'study', 'benchmark', 'training', 'model', 'transformer', 'diffusion', 'rag', 'rlhf', 'fine-tun', 'attention', 'tokeniz'] },
  { cat: 'tool', kw: ['library', 'framework', 'sdk', 'api', 'cli', 'tool', 'package', 'npm', 'pip', 'release v', 'github.com', 'open source', 'repo'] },
  { cat: 'industry', kw: ['openai', 'anthropic', 'google', 'microsoft', 'meta', 'nvidia', 'apple', 'salesforce', 'partnership', 'acquisition', 'raises', 'funding', 'valuation', 'billion'] },
  { cat: 'discussion', kw: ['show hn', 'ask hn', 'launch hn', 'discussion', 'opinion', 'thread', 'r/'] },
];

const CATEGORY_WEIGHTS = {
  paper: 75,
  industry: 90,
  model: 95,
  tool: 70,
  discussion: 50,
  startup: 80,
  uncategorized: 40,
};

function categorize(title, url) {
  const text = `${title} ${url}`.toLowerCase();
  for (const { cat, kw } of CATEGORY_RULES) {
    for (const k of kw) {
      if (text.includes(k)) return cat;
    }
  }
  // Heurística extra para "model" — keywords muy AI-específicas
  if (/\b(gpt|claude|gemini|llama|mistral|qwen|deepseek|stable[- ]diffusion)\s*\d/i.test(title)) {
    return 'model';
  }
  return 'uncategorized';
}

/**
 * Normalización de un item de cualquier fetcher a NewsItem shape común.
 */
function normalizeItem(raw, sourceId) {
  // Cada fetcher tiene su propio shape; acá unificamos.
  const item = {
    source_id: sourceId,
    source_name: raw.source_name ?? sourceId,
    source_url: raw.source_url ?? '',
    id_on_source: raw.id_on_source ?? String(raw.id ?? raw.url),
    title: (raw.title ?? '').trim(),
    url: raw.url ?? '',
    canonical_url: canonicalizeUrl(raw.url ?? ''),
    fetched_at: raw.fetched_at ?? new Date().toISOString(),
    submitted_at: raw.submitted_at ?? raw.created_at ?? null,
    raw,
  };

  // Engagement heuristic: puntaje combinado de upvotes/scores/comentarios
  // según lo que cada fuente expone
  let engagement = 0;
  if (typeof raw.score === 'number') engagement += raw.score * 1.0;
  if (typeof raw.upvotes === 'number') engagement += raw.upvotes * 1.0;
  if (typeof raw.stars === 'number') engagement += Math.min(raw.stars / 5, 200); // stars capped
  if (typeof raw.comments === 'number') engagement += raw.comments * 0.5;
  if (typeof raw.num_comments === 'number') engagement += raw.num_comments * 0.5;
  if (typeof raw.hn_points === 'number') engagement += raw.hn_points * 1.0;

  item.engagement_raw = engagement;

  // Categoría heurística
  item.category = categorize(item.title, item.url);

  // Description / abstract (M3 los usa para resumir)
  item.description = raw.selftext ?? raw.description ?? raw.repo_description ?? raw.abstract ?? null;
  item.abstract = raw.abstract ?? null;
  item.authors = raw.authors ?? [];
  item.comments_count = raw.comments ?? raw.num_comments ?? null;
  item.score_on_source = raw.score ?? raw.upvotes ?? raw.stars ?? null;

  return item;
}

/**
 * Canonicaliza URL para dedupe (lowercase host, sin protocol, sin trailing slash,
 * sin tracking params).
 */
function canonicalizeUrl(url) {
  try {
    const u = new URL(url);
    let h = u.host.toLowerCase().replace(/^www\./, '');
    let p = u.pathname.replace(/\/$/, '').toLowerCase();
    // Quitar query params de tracking comunes
    const params = u.searchParams;
    for (const k of [...params.keys()]) {
      if (/^(utm_|fbclid|gclid|ref|src)/i.test(k)) params.delete(k);
    }
    const q = params.toString();
    return `${h}${p}${q ? '?' + q : ''}`;
  } catch {
    return url.toLowerCase();
  }
}

/**
 * Hash estable para dedupe: usa canonical_url si existe, sino título normalizado.
 */
function itemHash(item) {
  if (item.canonical_url) {
    return createHash('sha1').update(item.canonical_url).digest('hex').slice(0, 16);
  }
  return createHash('sha1').update(item.title.toLowerCase().trim()).digest('hex').slice(0, 16);
}

/**
 * Distancia de Levenshtein para títulos similares (no idénticos).
 * Usada para detectar duplicados cross-source con URLs distintas.
 */
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1];
      else dp[i][j] = 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

function similarity(a, b) {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 0;
  return 1 - levenshtein(a, b) / max;
}

/**
 * Dedupe: agrupa items con misma canonical_url O títulos muy similares (>0.85).
 * Cuando se agrupan: merge sources array, mantener el de mayor engagement.
 */
function dedupe(items) {
  const groups = [];
  for (const item of items) {
    let merged = false;
    for (const g of groups) {
      const titleSim = similarity(item.title.toLowerCase(), g.title.toLowerCase());
      if (itemHash(item) === itemHash(g) || titleSim > 0.85) {
        // Merge
        if (!g.sources.includes(item.source_id)) g.sources.push(item.source_id);
        g.engagement_raw = Math.max(g.engagement_raw, item.engagement_raw);
        // Mantener el de mayor engagement como principal
        if (item.engagement_raw > g._rep.engagement_raw) {
          g._rep = item;
          g.title = item.title;
          g.url = item.url;
          g.canonical_url = item.canonical_url;
          g.id = itemHash(item);
        }
        merged = true;
        break;
      }
    }
    if (!merged) {
      groups.push({
        ...item,
        id: itemHash(item), // canonical_url-hash para routing
        sources: [item.source_id],
        _rep: item,
        title: item.title,
        url: item.url,
        canonical_url: item.canonical_url,
      });
    }
  }
  return groups;
}

/**
 * Score de relevancia 0-100:
 *   engagement (peso 0.4) — log-normalizado por engagement crudo
 *   multi_source (peso 0.3) — 1 fuente=0, 2=50, 3+=100
 *   freshness (peso 0.2) — 1.0 si hoy, decay lineal a 0 en 7 días
 *   category (peso 0.1) — peso heurístico de categoría
 */
function computeScore(item, nowMs) {
  const eng = Math.min(Math.log10(Math.max(item.engagement_raw, 1) + 1) * 25, 100);
  const multi = Math.min(item.sources.length, 3) * (100 / 3); // 1=33, 2=67, 3=100
  let fresh = 0;
  if (item.submitted_at) {
    const ageMs = nowMs - new Date(item.submitted_at).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    fresh = Math.max(0, 1 - ageDays / 7) * 100;
  } else {
    fresh = 50; // sin fecha = asume reciente
  }
  const cat = CATEGORY_WEIGHTS[item.category] ?? CATEGORY_WEIGHTS.uncategorized;

  const score = eng * 0.4 + multi * 0.3 + fresh * 0.2 + cat * 0.1;
  return {
    score: Math.round(score),
    breakdown: {
      engagement: Math.round(eng),
      multi_source: Math.round(multi),
      freshness: Math.round(fresh),
      category: Math.round(cat),
    },
  };
}

async function main() {
  if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true });

  console.log('📦 Loading raw items from all sources…');
  const allItems = [];
  for (const src of SOURCES) {
    const f = join(CACHE, src.file);
    if (!existsSync(f)) {
      console.warn(`   ⚠️  Skipping ${src.id}: ${src.file} no existe`);
      continue;
    }
    let raw;
    try {
      const parsed = JSON.parse(readFileSync(f, 'utf-8'));
      raw = parsed.items ?? [];
    } catch (e) {
      console.warn(`   ⚠️  Error reading ${src.file}: ${e.message}`);
      continue;
    }
    const normalized = raw
      .filter((it) => it.url && it.title)
      .map((it) => normalizeItem(it, src.id));
    console.log(`   ✅ ${src.id}: ${normalized.length} items`);
    allItems.push(...normalized);
  }
  console.log(`   📊 Total raw: ${allItems.length}`);

  // Dedupe
  console.log('🔄 Deduplicating…');
  const deduped = dedupe(allItems);
  const multiSourceCount = deduped.filter((it) => it.sources.length > 1).length;
  console.log(`   ✨ ${deduped.length} unique (${multiSourceCount} multi-source)`);

  // Compute scores
  const nowMs = Date.now();
  console.log('📊 Computing scores…');
  for (const item of deduped) {
    item.sources_final = item.sources; // limpia referencia
    delete item._rep;
    const { score, breakdown } = computeScore(item, nowMs);
    item.score = score;
    item.score_breakdown = breakdown;
    item.confirmed_by = item.sources.length;
  }

  // Sort by score desc
  deduped.sort((a, b) => b.score - a.score);

  const payload = {
    generated_at: new Date().toISOString(),
    total_raw: allItems.length,
    total_unique: deduped.length,
    total_multi_source: multiSourceCount,
    sources_summary: SOURCES.map((s) => ({
      id: s.id,
      file: s.file,
      present: existsSync(join(CACHE, s.file)),
    })),
    items: deduped,
  };

  writeFileSync(OUT, JSON.stringify(payload, null, 2));
  console.log(`💾 Saved: ${OUT}`);
  console.log(`   🥇 Top by score: "${deduped[0]?.title.slice(0, 60)}…" (${deduped[0]?.score}/100, ${deduped[0]?.sources.length} sources)`);
  console.log(`   📈 Avg score: ${Math.round(deduped.reduce((s, it) => s + it.score, 0) / Math.max(deduped.length, 1))}`);
}

main().catch((e) => {
  console.error('💥 normalize.mjs:', e.message);
  process.exit(1);
});
