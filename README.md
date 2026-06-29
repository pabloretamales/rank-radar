# 📡 RankRadar

Visibilidad en tiempo real de:
1. **Top GitHub** — repos por estrellas en ventanas 1d / 7d / 30d / 90d / histórico
2. **Top modelos IA** — rankings Artificial Analysis (intelligence, coding, math, velocidad, precio)
3. **Top apps OpenRouter** — popular, trending, por tokens

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
- `manifest.json` — metadata de los 3 datasets

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

## Pipeline automático

Cron diario (UTC) en OpenClaw:
- Re-corre los 3 fetchers
- Re-genera `public/data/*.json`
- Commit + push al repo

Vercel re-deploy automáticamente con los JSON nuevos.

## Idiomas

- ES: `/`, `/github/`, `/models/`, `/openrouter/` (default, sin prefijo)
- EN: `/en/`, `/en/github/`, `/en/models/`, `/en/openrouter/`

## Privacidad del repo

🔒 **Repo privado.** No exponer públicamente.

El `.gitignore` ya excluye:
- `.env`, `.env.local`, `.env.*.local`
- `node_modules/`
- `dist/`, `.astro/`
- `.cache/`, `.git-credentials`

---

_DinamIA Labs · {Pablo's email placeholder si quieres exponer autor}_
