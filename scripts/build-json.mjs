#!/usr/bin/env node
/**
 * build-json.mjs
 *
 * Consolida los outputs de los fetchers en un único manifest con metadata
 * común y agrupa datasets para que Astro los consuma como /data/manifest.json.
 *
 * Output: public/data/manifest.json
 */

import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA = join(ROOT, 'public', 'data');
const OUT = join(DATA, 'manifest.json');

function readIfExists(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (e) {
    console.warn(`⚠️  ${path}: ${e.message}`);
    return null;
  }
}

function smallestFetchedAt(...datasets) {
  const timestamps = datasets
    .filter(Boolean)
    .map((d) => d.fetched_at)
    .filter(Boolean)
    .sort();
  return timestamps[0] ?? null;
}

async function main() {
  console.log('🧱 Building manifest…');

  const github = readIfExists(join(DATA, 'github-windows.json'));
  const aa = readIfExists(join(DATA, 'aa-models.json'));
  const openrouter = readIfExists(join(DATA, 'openrouter.json'));

  if (!github && !aa && !openrouter) {
    console.warn('⚠️  Ningún dataset presente. Corré los fetchers primero.');
    process.exit(1);
  }

  const payload = {
    generated_at: new Date().toISOString(),
    oldest_source_fetch: smallestFetchedAt(github, aa, openrouter),
    sources: {
      github: github
        ? { fetched_at: github.fetched_at, windows: github.windows?.length ?? 0 }
        : null,
      aa: aa ? { tier: aa.tier, total_models: aa.total_models, fetched_at: aa.fetched_at } : null,
      openrouter: openrouter ? { fetched_at: openrouter.fetched_at } : null,
    },
    paths: {
      github: '/data/github-windows.json',
      aa: '/data/aa-models.json',
      openrouter: '/data/openrouter.json',
    },
  };

  writeFileSync(OUT, JSON.stringify(payload, null, 2));
  console.log(`💾 Saved: ${OUT}`);
}

main();
