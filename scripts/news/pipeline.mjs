#!/usr/bin/env node
/**
 * pipeline.mjs — Orquestador Pulse IA
 *
 * Ejecuta el pipeline completo en secuencia. Las 7 fuentes son las mismas
 * que usa Lovable CRM en supabase/functions/aggregate-noticias-ia/index.ts
 * (validadas por Pablo 2026-07-05).
 *
 *   1. fetch-rss.mjs   (TechCrunch, The Verge, VentureBeat, MIT TR, Latent Space, Xataka, WWWhatsnew)
 *   2. fetch-hnrss.mjs (Hacker News AI via hnrss.org)
 *   3. normalize.mjs   (unifica + dedupe + score)
 *   4. summarize.mjs   (M3 batch + cache)
 *   5. build-json.mjs  (public/data/news-YYYY-MM-DD.json)
 *
 * Uso:
 *   node scripts/news/pipeline.mjs                   # full
 *   node scripts/news/pipeline.mjs --skip-fetch      # skip fetchers
 *   node scripts/news/pipeline.mjs --skip-m3         # skip M3 summarize
 */

import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const args = process.argv.slice(2);
const SKIP_FETCH = args.includes('--skip-fetch');
const SKIP_M3 = args.includes('--skip-m3');

function runScript(script) {
  console.log(`\n▶ ${script}`);
  const result = spawnSync('node', [join(__dirname, script)], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    console.error(`\n❌ ${script} failed with status ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

async function main() {
  const start = Date.now();
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Pulse IA — Pipeline (Lovable CRM sources)');
  console.log(`  ${new Date().toISOString()}`);
  console.log(`  Mode: ${SKIP_FETCH ? 'no-fetch' : 'full'} | ${SKIP_M3 ? 'no-m3' : 'with-m3'}`);
  console.log('═══════════════════════════════════════════════════════════════');

  // 1. Fetchers
  if (!SKIP_FETCH) {
    runScript('fetch-rss.mjs');
    runScript('fetch-hnrss.mjs');
  } else {
    console.log('\n⏭  Skipping fetchers (using cache from .cache/)');
  }

  // 2. Normalize
  runScript('normalize.mjs');

  // 3. Summarize (M3)
  if (!SKIP_M3) {
    if (!process.env.MINIMAX_API_KEY) {
      console.warn('\n⚠️  MINIMAX_API_KEY no definida, usando fallback a descripción original');
    }
    runScript('summarize.mjs');
  } else {
    console.log('\n⏭  Skipping M3 summarize (--skip-m3)');
    const fs = await import('node:fs');
    const normalizedPath = join(ROOT, '.cache', 'news-normalized.json');
    const summarizedPath = join(ROOT, '.cache', 'news-summarized.json');
    if (!exists(summarizedPath) && exists(normalizedPath)) {
      fs.copyFileSync(normalizedPath, summarizedPath);
      console.log(`   ℹ️  news-summarized.json no existe, copiado desde news-normalized.json`);
    }
  }

  // 4. Build JSON
  runScript('build-json.mjs');

  const elapsed = Math.round((Date.now() - start) / 1000);
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`  ✅ Pipeline complete in ${elapsed}s`);
  console.log('═══════════════════════════════════════════════════════════════');
}

function exists(p) {
  try {
    const fs = require('node:fs');
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

main().catch((e) => {
  console.error('💥 pipeline:', e.message);
  process.exit(1);
});
