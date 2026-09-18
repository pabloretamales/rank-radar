# 📡 RankRadar

Visibilidad en tiempo real de:
1. **Top GitHub** — repos por estrellas en ventanas 1d / 7d / 30d / 90d / histórico
2. **Top modelos IA** — rankings Artificial Analysis (intelligence, coding, math, velocidad, precio)
3. **Top apps OpenRouter** — popular, trending, por tokens
4. **ExploreYC** — 5 startups YC con foco IA, acumuladas diariamente sin repetir

Sitio: [ai-rank-radar.vercel.app](https://ai-rank-radar.vercel.app/)

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
- Corre `npm run guard` y recién ahí commit + push al repo
- **Cron independiente** para ExploreYC: 1 req/día y merge con la base acumulada

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
   - El cron de ExploreYC corre **1 vez/día** y deja buffer de cuota para regeneraciones manuales.

## Idiomas

- ES: `/`, `/github/`, `/models/`, `/openrouter/`, `/exploreyc/` (default, sin prefijo)
- EN: `/en/`, `/en/github/`, `/en/models/`, `/en/openrouter/`, `/en/exploreyc/`

## Seguridad

⚠️ **Repo público.** Nada sensible acá adentro. El `.gitignore` excluye `.env`,
`.env.local`, `.env.*.local`, `node_modules/`, `dist/`, `.astro/`, `.cache/` y
`.git-credentials`. Las keys viven solo en tu `.env` local y en el entorno del
agente que corre el cron.

### Los datos de las APIs son hostiles

Todo lo que entra por los fetchers es texto de terceros: cualquiera puede
publicar un repo en GitHub o un perfil en YC y aparecer en el top del día. Ese
texto se commitea a `public/data/`, se renderiza en el sitio y lo lee el agente
que corre el pipeline. Dos defensas:

1. **`scripts/lib/clean.mjs`** — `cleanText()` capa el largo de cada campo de
   texto libre, colapsa whitespace y elimina control chars, zero-width y bidi
   overrides (los caracteres que sirven para esconder payload a la vista).
   Aplicado en los 4 fetchers.
2. **`src/lib/safe.mjs`** — `safeUrl()` deja pasar solo `http:`/`https:` en todo
   `href`/`src` que venga de una API. Sin esto, un `website` con `javascript:`
   ejecuta al hacer click.

En `compare.astro` el JSON embebido escapa `<` (un nombre de modelo con
`</script>` rompería el bloque) y todo lo que va a `innerHTML` pasa por `esc()`.

### Guard del pipeline

```bash
npm run pipeline && npm run guard && git commit -am "data: refresh" && git push
```

`npm run guard` aborta si el pipeline tocó algo fuera de `public/data/*.json`.
Una corrida automática solo tiene permitido cambiar datos, nunca código.

`npm test` corre los asserts de `safeUrl` y `cleanText`.

### Headers

`vercel.json` define CSP, `nosniff`, `Referrer-Policy` y `Permissions-Policy`.
La CSP necesita `'unsafe-inline'` en `script-src` y `style-src` porque el sitio
usa bloques `is:inline` y atributos `style=`. Eso limita cuánto aporta contra
XSS — el escaping de arriba es la defensa real, la CSP es segunda capa
(`object-src`, `base-uri`, `form-action`, `frame-ancestors` en `none`).
`img-src` está pineado al S3 de ExploreYC: si cambian de host, los logos
desaparecen (el `onerror` los oculta) y hay que actualizar el header.

### Deuda conocida

`npm audit` marca Astro como vulnerable. Cerrarlo requiere Astro 7, y
`@astrojs/tailwind` topa en Astro 5 → arrastra migración a Tailwind 4. Ninguna
de esas advisories es alcanzable en este deploy: sitio estático, sin SSR, sin
middleware, sin server islands, sin `astro:assets`. Las de `sharp`/`libvips`
tampoco (no se optimizan imágenes) y la de `esbuild` es dev server en Windows.

---

_DinamIA Labs_
