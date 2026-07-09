# 📡 RankRadar

Visibilidad en tiempo real de:
1. **Top GitHub** — repos por estrellas en ventanas 1d / 7d / 30d / 90d / histórico
2. **Top modelos IA** — rankings Artificial Analysis (intelligence, coding, math, velocidad, precio)
3. **Top apps OpenRouter** — popular, trending, por tokens
4. **ExploreYC** — 5 startups YC con foco IA, acumuladas diariamente sin repetir

Sitio: [rankradar.dinamialabs.com](https://rankradar.dinamialabs.com)

## Stack

- **Astro 4** (SSG — sitio completamente estático)
- **Tailwind 3** (con CSS variables para dark mode)
- **TypeScript estricto**
- Sin backend, sin runtime JS pesado: solo tabs client-side con CSS

## Estructura

```
rank-radar/
├── scripts/                    # Pipeline diario
│   ├── fetch-github-trending.mjs
│   ├── fetch-aa-models.mjs
│   ├── fetch-openrouter.mjs
│   └── build-json.mjs
├── src/
│   ├── components/             # RepoCard, ModelCard, AppCard, Header, Footer
│   ├── i18n/                   # es.json + en.json + index.ts
│   ├── layouts/Base.astro
│   ├── pages/                  # ES (default) en /, /github/, /models/, /openrouter/
│   │   └── en/                 # Mirrors EN
│   └── styles/global.css
├── public/
│   ├── data/                   # Outputs de los scripts (gitignored: NO, committed: sí)
│   └── favicon.svg
└── .cache/                     # Cache raw de cada fetch (gitignored)
```

## Datos

Los JSON en `public/data/` son **generados y commiteados**:

- `github-windows.json` — top 20 por ventana (5 ventanas)
- `aa-models.json` — 543 modelos + 11 rankings (intelligence, coding, math, MMLU-Pro, GPQA, LiveCodeBench, HLE, speed, TTFT, cheapest blended, cheapest input)
- `openrouter.json` — popular + trending + by_tokens
- `exploreyc-today.json` — top 5 AI-relevant YC startups del día actual
- `exploreyc-history.json` — base acumulada (dedupe por id, orden created_at desc)
- `manifest.json` — metadata de los 5 datasets

## Setup local

Creá tu propio `.env` en la raíz con las tres variables que listamos abajo (no commitear nunca), y después:

```bash
npm install
npm run fetch:github
npm run fetch:aa
npm run fetch:openrouter
npm run build:data
npm run build
npm run preview
```

O todo en cadena:

```bash
npm run pipeline
```

## Variables de entorno (NUNCA commitear)

El archivo `.env` debe vivir solo en tu máquina. **No** se commitea — `.gitignore` lo excluye explícitamente. Necesitás estas tres vars para los fetchers:

- **`ARTIFICIAL_ANALYSIS_API_KEY`** — el script `fetch-aa-models.mjs` la envía como header `x-api-key`. Con el tier **FREE** actual detecta ~543 modelos y devuelve los benchmarks principales (intelligence/coding/math/speed/precio). Si en algún momento subís a PRO, vas a ver además `openrouter_api_id`, `context_window` y `modalities`.
- **`GITHUB_TOKEN`** — el script `fetch-github-trending.mjs` la envía como `Authorization: Bearer`. Necesita scope de `public_repo` para `/search/repositories`. Rate limit autenticado: 5000 req/h.
- **`OPENROUTER_API_KEY`** — el script `fetch-openrouter.mjs` la envía como `Authorization: Bearer` contra `/api/v1/datasets/app-rankings`. Sirve cualquier key, incluso con 0 crédito, porque el endpoint no consume tokens de inferencia. Rate limit: 30 req/min, 500 req/día.
- **`EYC_API_KEY`** — el script `fetch-exploreyc.mjs` la envía como `Authorization: Bearer` contra `https://api.exploreyc.com/api/v1/companies`. **Free tier: 5 req/día, rolling 24h.** Por eso este fetcher corre **una sola vez al día** (cron separado, no integrado en `pipeline`) y cachea "ya corrió hoy" en `.cache/exploreyc-last-date.txt`. Pagá `Starter` ($29/mes, 500 req/día) si querés más. Filtro AI: keyword-based (ExploreYC no tiene industry "AI", solo B2B/Consumer/Software/etc).

## Pipeline automático

Cron diario (UTC) en OpenClaw:
- Re-corre los fetchers principales (github + aa + openrouter)
- Re-genera `public/data/*.json`
- Commit + push al repo
- **Cron independiente** `rank-radar-exploreyc-refresh` corre **1 req/día** a ExploreYC (cuota 5/día) y mergea con la base acumulada

Vercel re-deploy automáticamente con los JSON nuevos.

### ExploreYC — Cómo está hecho

1. **Fetcher único por día** (`scripts/fetch-exploreyc.mjs`):
   - Cache `.cache/exploreyc-last-date.txt` evita quemar cuota si se ejecuta dos veces.
   - 1 call a `GET /companies?source=yc&limit=100` (los más recientes).
   - Re-ordena localmente por `created_at DESC` (no confiar en el orden del API).
   - Puntúa los 30 más recientes con keywords AI (lista en `scripts/lib/ai-keywords.mjs`).
   - Score ≥ 3 → top 5 van al `exploreyc-today.json`.
   - Dedupe por `id` → actualiza `exploreyc-history.json` (acumulado).

2. **AI filter — sin industry-match**:
   - ExploreYC tiene **10 industries** (B2B, Consumer, Software...). No hay "AI"/"ML".
   - Por eso el filtro es 100% keyword-based en `name + one_liner + long_description + subindustry`.
   - Score: `strong`=3 (e.g. "AI", "agent", "RAG", "LLM"), `medium`=1 (e.g. "computer vision", "machine learning"). Threshold mínimo: 3.

3. **Por qué cron separado**:
   - El pipeline principal corre **3 veces/día** (daily, midday, + build). Si cada run llamara a ExploreYC → se quema la cuota en <2 días.
   - Cron `rank-radar-exploreyc-refresh` corre **1 vez/día** a las 14:00 CLT y mantiene 4 calls/día de buffer para regeneraciones manuales.

## Idiomas

- ES: `/`, `/github/`, `/models/`, `/openrouter/`, `/exploreyc/` (default, sin prefijo)
- EN: `/en/`, `/en/github/`, `/en/models/`, `/en/openrouter/`, `/en/exploreyc/`

## Privacidad del repo

🔒 **Repo privado.** No exponer públicamente.

El `.gitignore` ya excluye:
- `.env`, `.env.local`, `.env.*.local`
- `node_modules/`
- `dist/`, `.astro/`
- `.cache/`, `.git-credentials`

---

_DinamIA Labs · {Pablo's email placeholder si quieres exponer autor}_

## Pulse IA (v2 of RankRadar) — 2026-07-05

**Branch:** `feat/pulse-ia-news` (PR pendiente, NO mergeado a main)
**Stack:** Astro 4 + Tailwind + M3 (minimax) + Vercel (deploy manual)

### Qué es

Pulse IA = mismo repo de RankRadar, branding paralelo. Pablo decidió
consolidar bajo un solo repo el 2026-07-05 17:13 CLT ("Ocupemos el mismo repo").
Pulse IA agrega + cura noticias de IA desde 5 fuentes gratuitas, 2x/día,
en español, con resúmenes M3.

### Pipeline (idempotente, ~15s)

```
node scripts/news/pipeline.mjs
  → fetch-huggingface   (HF Daily Papers, ~50 papers)
  → fetch-hackernews    (Algolia API, 25 AI-relevant del top 100)
  → fetch-reddit        (RSS r/MachineLearning + r/LocalLLaMA, rate-limit OK)
  → fetch-arxiv         (cs.AI + cs.CL + cs.LG, 69 unique papers)
  → fetch-github-ai     (topic:llm + AI keywords, top 20 7d)
  → normalize           (unifica + dedupe + score)
  → summarize           (M3 batch, cache por sha1(title), concurrencia 3)
  → build-json          (public/data/news-YYYY-MM-DD.json + news-latest.json)
```

5 fuentes Tier 1 — todas gratuitas, todas estables:
1. Hugging Face Daily Papers (AK-curated)
2. Hacker News Algolia API (oficial, post-Firebase migration)
3. Reddit RSS (JSON bloqueado por Reddit desde 2023, OAuth API needed)
4. arXiv Atom API (sin auth, 1 req/3s recomendado)
5. GitHub Trending · AI (topic:llm + keywords broad)

### Archivos clave

- `scripts/news/fetch-*.mjs` — 5 fetchers independientes
- `scripts/news/normalize.mjs` — unifica + dedupe + score (Levenshtein >0.85)
- `scripts/news/summarize.mjs` — M3 batch (cache, fallback a descripción si falla)
- `scripts/news/build-json.mjs` — escribe news-YYYY-MM-DD.json + manifest extendido
- `scripts/news/pipeline.mjs` — orquestador (con flags --skip-fetch, --skip-m3)
- `src/components/news/NewsCard.astro` — card reusable (bilingüe es/en)
- `src/pages/news/[id].astro` — detalle con score breakdown (61 páginas)
- `src/pages/about.astro` — metodología completa
- `src/pages/index.astro` — MODIFICADO: bloque Pulse IA top 6 arriba, mantiene RankRadar original

### Principles (no negociables)

1. Cada item lleva link REAL, VERIFICABLE — sin URLs inventadas.
2. Sin alucinaciones: si M3 duda → mostrar descripción original.
3. Cada resumen lleva etiqueta "Generado por IA" en la UI.
4. Commit messages siguen patrón `feat(news): ...` para identificarlos.
5. **NUNCA** commitear secretos. MINIMAX_API_KEY y GITHUB_TOKEN solo en ~/.openclaw/.env.

### Estado actual (2026-07-05 17:25 CLT)

- ✅ 5 fetchers funcionando y testeados
- ✅ Pipeline end-to-end OK, 154 unique items, 50 top
- ✅ Build Astro: 61 páginas, 2.4s, 0 errores
- ✅ Dev server verificado: `/`, `/news/{id}/`, `/about/` todos 200
- ✅ Branch `feat/pulse-ia-news` pusheado, PR pendiente
- ⏳ **Pendiente:** crear 2 crons OpenClaw (`pulse-ia-morning-refresh` + `pulse-ia-afternoon-refresh` con M3 forzado, fallbacks [])
- ⏳ **Pendiente:** Pablo hace deploy manual en Vercel
- ⏳ **Pendiente:** Pablo decide si mergea PR o pide cambios

### Anti-hallucination

El prompt M3 incluye reglas estrictas:
- Resumir SOLO lo que dice el input
- NO inventar datos, cifras, empresas
- Si el contenido es confuso → cadena VACÍA
- Mantener jerga técnica en inglés (RAG, RLHF, etc.)

Si M3 falla o devuelve vacío, el script usa la descripción original como fallback y marca `summary_failed: true` en el JSON.
