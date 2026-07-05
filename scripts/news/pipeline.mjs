#!/usr/bin/env node
/**
 * pipeline.mjs — Orquestador Pulse IA
 *
 * Ejecuta el pipeline completo en secuencia:
 *   1. Fetchers (5 fuentes Tier 1)
 *   2. Normalize + dedupe + score
 *   3. Summarize con M3 (con cache)
 *   4. Build JSON final
 *
 * Uso:
 *   node scripts/news/pipeline.mjs           # full pipeline
 *   node scripts/news/pipeline.mjs --skip-fetch   # skip fetchers (usar cache)
 *   node scripts/news/pipeline.mjs --skip-m3      # skip summarize (fallback a desc original)
 *
 * Env vars necesarias:
 *   - GITHUB_TOKEN (para GitHub AI fetcher)
 *   - MINIMAX_API_KEY (para summarize M3)
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
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
  console.log('  Pulse IA — Pipeline');
  console.log(`  ${new Date().toISOString()}`);
  console.log(`  Mode: ${SKIP_FETCH ? 'no-fetch' : 'full'} | ${SKIP_M3 ? 'no-m3' : 'with-m3'}`);
  console.log('═══════════════════════════════════════════════════════════════');

  // 1. Fetchers
  if (!SKIP_FETCH) {
    runScript('fetch-huggingface.mjs');
    runScript('fetch-hackernews.mjs');
    runScript('fetch-reddit.mjs');
    runScript('fetch-arxiv.mjs');
    runScript('fetch-github-ai.mjs');
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
    // Si no hay summarized, usar el normalized como input
    if (!existsSync(join(ROOT, '.cache', 'news-summarized.json'))) {
      console.log('   ℹ️  news-summarized.json no existe, usando news-normalized.json');
      const fs = await import('node:fs');
      fs.copyFileSync(
        join(ROOT, '.cache', 'news-normalized.json'),
        join(ROOT, '.cache', 'news-summarized.json')
      );
    }
  }

  // 4. Build JSON
  runScript('build-json.mjs');

  const elapsed = Math.round((Date.now() - start) / 1000);
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`  ✅ Pipeline complete in ${elapsed}s`);
  console.log('═══════════════════════════════════════════════════════════════');
}

main().catch((e) => {
  console.error('💥 pipeline:', e.message);
  process.exit(1);
});
