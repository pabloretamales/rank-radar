#!/usr/bin/env node
/**
 * summarize.mjs — Pulse IA M3 summarizer
 *
 * Genera resumen en español de cada NewsItem usando M3 (minimax API,
 * endpoint Anthropic-compatible). Cachea por hash del título para no
 * regenerar entre corridas.
 *
 * Estrategia:
 *   - Item con title corto (< 80 chars) y sin descripción → sin summary
 *     (mostrar solo título + fuente)
 *   - Item con descripción o abstract → M3 genera 2-3 frases en español
 *   - Cache hit (title hash ya en summaries.json) → reusa sin llamar M3
 *   - Cache miss → llama M3 con prompt estricto anti-alucinaciones
 *   - Si M3 falla → fallback a description_original (truncado)
 *
 * Costo: 1 llamada M3 por item no cacheado. ~$0.001-0.003/item estimado.
 *        Con 50 items/día = $0.05-0.15/día. Trivial.
 *
 * Usage: node scripts/news/summarize.mjs
 * Env:    MINIMAX_API_KEY
 *
 * Input:  .cache/news-normalized.json
 * Output: .cache/summaries.json (cache persistente)
 *         .cache/news-summarized.json (lista completa con summary_es)
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const CACHE = join(ROOT, '.cache');

const NORMALIZED = join(CACHE, 'news-normalized.json');
const SUMMARIES = join(CACHE, 'summaries.json');
const OUT = join(CACHE, 'news-summarized.json');

const API_KEY = process.env.MINIMAX_API_KEY ?? '';
const API_HOST = 'https://api.minimax.io/anthropic';
const MODEL = 'MiniMax-M3';

if (!API_KEY) {
  console.error('❌ MINIMAX_API_KEY no definida.');
  process.exit(1);
}

function hashTitle(title) {
  return createHash('sha1').update(title.toLowerCase().trim()).digest('hex').slice(0, 12);
}

function loadCache() {
  if (!existsSync(SUMMARIES)) return {};
  try {
    return JSON.parse(readFileSync(SUMMARIES, 'utf-8'));
  } catch {
    return {};
  }
}

function saveCache(cache) {
  writeFileSync(SUMMARIES, JSON.stringify(cache, null, 2));
}

/**
 * Llama M3 con un prompt estricto anti-alucinaciones.
 * Devuelve {summary: string|null, failed: boolean}.
 */
async function callM3(title, description) {
  const systemPrompt = `Eres un asistente que resume noticias de inteligencia artificial en ESPAÑOL.

REGLAS ESTRICTAS:
- Resume SOLO lo que dice el título y la descripción provistos.
- NO inventes datos, cifras, empresas, autores o URLs.
- NO completes información que no esté en el input.
- Si el contenido es confuso, devuelve una cadena VACÍA.
- 2-3 oraciones máximo. Tono directo, técnico.
- Conserva jerga técnica en inglés (RAG, fine-tuning, RLHF, context window, etc.) cuando sea útil.
- Sin clickbait, sin emojis, sin marketing speak.`;

  const userPrompt = `TÍTULO:
${title}

DESCRIPCIÓN:
${description ?? '(sin descripción)'}

RESUMEN EN ESPAÑOL (2-3 oraciones):`;

  try {
    const res = await fetch(`${API_HOST}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 280,
        system: systemPrompt,
        messages: [
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`M3 ${res.status}: ${err.slice(0, 150)}`);
    }
    const json = await res.json();
    const text = json?.content?.[0]?.text ?? '';
    return { summary: text.trim() || null, failed: false };
  } catch (e) {
    return { summary: null, failed: true, error: e.message };
  }
}

async function main() {
  if (!existsSync(NORMALIZED)) {
    console.error(`❌ No existe ${NORMALIZED}. Corré normalize.mjs primero.`);
    process.exit(1);
  }
  if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true });

  const data = JSON.parse(readFileSync(NORMALIZED, 'utf-8'));
  const items = data.items ?? [];
  console.log(`📝 Summarizing ${items.length} items with M3…`);

  const cache = loadCache();
  let cached = 0;
  let generated = 0;
  let failed = 0;
  let skipped = 0;

  // Limitar concurrencia para no saturar M3
  const CONCURRENCY = 3;
  const queue = [...items];

  async function worker(id) {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) return;
      // Skip items sin descripción (paper abstracts, GitHub repo titles cortos)
      const description = item.abstract ?? item.description ?? item.selftext ?? item.repo_description ?? null;
      if (!description || description.length < 30) {
        item.summary_es = null;
        item.summary_failed = false;
        item.summary_skipped = true;
        skipped++;
        return;
      }
      const h = hashTitle(item.title);
      if (cache[h]) {
        item.summary_es = cache[h];
        item.summary_failed = false;
        cached++;
        return;
      }
      process.stdout.write(`   [w${id}] M3 ← "${item.title.slice(0, 50)}…"\n`);
      const result = await callM3(item.title, description);
      if (result.failed) {
        // Fallback: descripción truncada
        item.summary_es = description.slice(0, 280) + (description.length > 280 ? '…' : '');
        item.summary_failed = true;
        item.summary_error = result.error;
        failed++;
      } else if (result.summary) {
        item.summary_es = result.summary;
        cache[h] = result.summary;
        generated++;
      } else {
        // M3 devolvió vacío → no inventamos, mostrar descripción
        item.summary_es = description.slice(0, 280) + (description.length > 280 ? '…' : '');
        item.summary_failed = true;
        item.summary_error = 'm3_returned_empty';
        failed++;
      }
    }
  }

  await Promise.all(
    Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1))
  );

  saveCache(cache);

  const output = {
    generated_at: new Date().toISOString(),
    model: MODEL,
    total_items: items.length,
    cached,
    generated,
    failed,
    skipped,
    items,
  };

  writeFileSync(OUT, JSON.stringify(output, null, 2));
  console.log(`💾 Saved: ${OUT}`);
  console.log(`   📊 Stats: cached=${cached}, generated=${generated}, failed=${failed}, skipped=${skipped}`);
}

main().catch((e) => {
  console.error('💥 summarize.mjs:', e.message);
  process.exit(1);
});
