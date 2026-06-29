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

```bash
npm install
cp .env.example .env   # completar con tus keys
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

```env
ARTIFICIAL_ANALYSIS_API_KEY=   # tier FREE detecta ~543 modelos sin openrouter_api_id
GITHUB_TOKEN=                  # read+write para /search/repositories (rate limit 5000/h)
OPENROUTER_API_KEY=            # cualquier key, incluso con 0 crédito
```

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
