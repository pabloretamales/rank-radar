#!/usr/bin/env node
/**
 * fetch-models-merged.mjs
 *
 * Cross-match entre Artificial Analysis y OpenRouter catálogo.
 * Enriquece cada modelo AA con data de OR (context_length, modalities, pricing).
 *
 * Matching key: el slug AA (ej: `claude-fable-5`) matchea con el último
 * segmento del OR id (ej: `anthropic/claude-fable-5` → `claude-fable-5`).
 * Si el match exacto no funciona, intenta substring (>= 6 chars).
 *
 * Output:
 *   - public/data/models-merged.json (built)
 */

import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const AA_JSON = join(ROOT, 'public', 'data', 'aa-models.json');
const OR_JSON = join(ROOT, 'public', 'data', 'openrouter.json');
const OUT = join(ROOT, 'public', 'data', 'models-merged.json');

function buildORBySlug(orCatalog) {
  const map = new Map();
  for (const m of orCatalog) {
    const id = m.id ?? '';
    const baseSlug = id.includes('/') ? id.split('/').pop() : id;
    if (!map.has(baseSlug)) {
      map.set(baseSlug, m);
    }
  }
  return map;
}

function main() {
  if (!existsSync(dirname(OUT))) mkdirSync(dirname(OUT), { recursive: true });

  const aa = JSON.parse(readFileSync(AA_JSON, 'utf-8'));
  const or = JSON.parse(readFileSync(OR_JSON, 'utf-8'));

  const orBySlug = buildORBySlug(or.catalog ?? []);
  console.log(`📡 Cross-match AA↔OR`);
  console.log(`   AA modelos: ${aa.total_models}`);
  console.log(`   OR catálogo: ${orBySlug.size} slugs`);

  let matched = 0;
  const augmented = (aa.models ?? []).map((m) => {
    let orMatch = null;
    if (orBySlug.has(m.slug)) {
      orMatch = orBySlug.get(m.slug);
    } else {
      for (const [orSlug, orM] of orBySlug.entries()) {
        if (orSlug.length >= 6 && (m.slug.includes(orSlug) || orSlug.includes(m.slug))) {
          orMatch = orM;
          break;
        }
      }
    }
    if (orMatch) matched++;
    return {
      ...m,
      or: orMatch
        ? {
            id: orMatch.id,
            canonical_slug: orMatch.canonical_slug ?? null,
            context_length: orMatch.context_length,
            modalities: orMatch.modalities,
            n_inputs: orMatch.n_inputs,
            n_outputs: orMatch.n_outputs,
            pricing_prompt: orMatch.pricing_prompt,
            pricing_completion: orMatch.pricing_completion,
            created_human: orMatch.created_human,
            url: orMatch.url,
          }
        : null,
    };
  });

  const payload = {
    fetched_at: new Date().toISOString(),
    source: 'AA + OpenRouter merge',
    matched,
    total_aa: aa.total_models,
    total_or_available: orBySlug.size,
    models: augmented,
  };

  writeFileSync(OUT, JSON.stringify(payload, null, 2));
  console.log(`💾 Saved: ${OUT}`);
  console.log(`   matched: ${matched}/${aa.total_models}`);
}

main();
