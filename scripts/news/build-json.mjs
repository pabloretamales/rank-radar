#!/usr/bin/env node
/**
 * build-json.mjs — Pulse IA: escribe JSON final + actualiza manifest
 *
 * Lee .cache/news-summarized.json (output de summarize.mjs) y produce
 *   - public/data/news-YYYY-MM-DD.json  (snap completo del día)
 *   - public/data/news-latest.json      (symlink/copia del más reciente)
 *   - public/data/manifest.json         (extendido con sección news)
 *
 * Output final es lo que consume la UI Astro.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const CACHE = join(ROOT, '.cache');
const DATA = join(ROOT, 'public', 'data');

const INPUT = join(CACHE, 'news-summarized.json');
const MANIFEST = join(DATA, 'manifest.json');

const TOP_N = 50; // cuántos items guardar (top por score)

function readIfExists(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (e) {
    console.warn(`⚠️  ${path}: ${e.message}`);
    return null;
  }
}

function buildNewsItem(it) {
  return {
    id: it.id, // hash de canonical_url
    title: it.title,
    url: it.url,
    canonical_url: it.canonical_url ?? null,
    sources: it.sources_final ?? it.sources ?? [it.source_id],
    source_names: [...new Set((it.sources_final ?? it.sources ?? [it.source_id]).map((sid) => {
      // Resolver nombre friendly del source
      const M = {
        'techcrunch-ai': 'TechCrunch AI',
        'theverge-ai': 'The Verge AI',
        'venturebeat-ai': 'VentureBeat AI',
        'mit-techreview-ai': 'MIT Tech Review',
        'latent-space': 'Latent Space',
        'hackernews-ai': 'Hacker News',
        'xataka-ia': 'Xataka IA',
        'wwwhatsnew-ia': 'WWWhatsnew',
      };
      return M[sid] ?? sid;
    }))],
    confirmed_by: it.confirmed_by ?? 1,
    category: it.category,
    summary_es: it.summary_es ?? null,
    summary_failed: it.summary_failed ?? false,
    authors: it.authors ?? [],
    submitted_at: it.submitted_at ?? null,
    fetched_at: it.fetched_at,
    engagement: typeof it.engagement_raw === 'number' ? Math.round(it.engagement_raw) : 0,
    score: it.score,
    score_breakdown: it.score_breakdown,
    description: it.description ? it.description.slice(0, 400) : null,
  };
}

async function main() {
  if (!existsSync(INPUT)) {
    console.error(`❌ No existe ${INPUT}. Corré summarize.mjs primero.`);
    process.exit(1);
  }

  console.log('🧱 Building news JSON output…');
  const data = JSON.parse(readFileSync(INPUT, 'utf-8'));
  const items = (data.items ?? []).map(buildNewsItem);
  const today = new Date().toISOString().slice(0, 10);

  // Filtrar score > 0 y ordenar desc
  const filtered = items
    .filter((it) => it.score >= 0 && it.title && it.url)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_N);

  const snapshot = {
    date: today,
    generated_at: new Date().toISOString(),
    total_items: filtered.length,
    total_raw: data.total_items ?? null,
    cache_stats: {
      cached: data.cached ?? 0,
      generated: data.generated ?? 0,
      failed: data.failed ?? 0,
      skipped: data.skipped ?? 0,
    },
    sources_active: data.sources_active ?? [...new Set(items.flatMap((it) => it.sources ?? []))],
    items: filtered,
  };

  // 1. Snapshot del día
  const snapshotPath = join(DATA, `news-${today}.json`);
  writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
  console.log(`   💾 ${snapshotPath}`);

  // 2. news-latest.json (la UI lee este)
  const latestPath = join(DATA, 'news-latest.json');
  writeFileSync(latestPath, JSON.stringify(snapshot, null, 2));
  console.log(`   💾 ${latestPath}`);

  // 3. Actualizar manifest con sección news
  const manifest = readIfExists(MANIFEST) ?? {};
  if (manifest && typeof manifest === 'object') {
    manifest.generated_at = new Date().toISOString();
    manifest.news = {
      date: today,
      fetched_at: data.generated_at ?? snapshot.generated_at,
      total_items: filtered.length,
      multi_source_count: filtered.filter((it) => it.confirmed_by > 1).length,
      path: '/data/news-latest.json',
      snapshot_path: `/data/news-${today}.json`,
    };
    // Paths
    manifest.paths = manifest.paths ?? {};
    manifest.paths.news_latest = '/data/news-latest.json';
    manifest.paths.news_snapshot = `/data/news-${today}.json`;
    writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
    console.log(`   💾 ${MANIFEST} (extended)`);
  }

  console.log('');
  console.log(`📊 Summary:`);
  console.log(`   Date: ${today}`);
  console.log(`   Items: ${filtered.length}`);
  console.log(`   Multi-source: ${filtered.filter((it) => it.confirmed_by > 1).length}`);
  console.log(`   Categories: ${[...new Set(filtered.map((it) => it.category))].join(', ')}`);
  console.log(`   Top score: ${filtered[0]?.score} (${filtered[0]?.title.slice(0, 50)}…)`);
}

main().catch((e) => {
  console.error('💥 build-json.mjs:', e.message);
  process.exit(1);
});
