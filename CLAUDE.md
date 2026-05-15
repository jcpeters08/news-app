# CLAUDE.md

## What this is

Personal mobile-first news + weather dashboard ([live](https://jcpeters08.github.io/news-app/)). A scheduled GitHub Action fetches news/RSS/weather, hands candidates to Claude for curation, writes `public/data.json`, and deploys to GitHub Pages. The static frontend (`public/index.html` + `app.js` + `styles.css`) reads `data.json` on load and renders a tabbed dashboard.

Entry point for the build pipeline: **`scripts/build-data.mjs`** (orchestrator). Entry point for the frontend: **`public/app.js`**.

## Architecture

```
GH Action cron (6 UTC times/day)
   │
   ├── gate job   ─── Chicago hour ∈ {06,07,13,14} or force=true?  no → skip
   │
   └── build job  ─── scripts/build-data.mjs
                       │
                       ├── shouldRun() + recentBuildExists() (idempotency, 90 min window)
                       ├── parallel fan-out:
                       │     fetch-news    (NewsAPI: US politics + med/tech)
                       │     fetch-genai   (RSS: Anthropic/OpenAI/Simon/Latent/HN)
                       │     fetch-mexico  (RSS: MND/NSS Oaxaca/La Jornada/Reforma/BBC Mundo)
                       │     fetch-intl    (RSS: BBC/Guardian/AJ; CN Traveler/NYT/GQ/Dezeen/Wallpaper)
                       │     fetch-weather (Open-Meteo forecast + marine for PE tides)
                       ├── claude-curator.curateAll() → 9 buckets + dailyBrief
                       ├── mergeWithFallback (per-bucket recency fallback)
                       └── write public/data.json
                       │
                       └── upload-pages-artifact → deploy-pages
```

## Critical conventions — DON'T BREAK

- **Two-tier time gate.** The workflow `gate` job (`.github/workflows/build.yml`) AND `shouldRun()` in `build-data.mjs` both check `America/Chicago` hour. Both must accept the same set `{6,7,13,14}` — keep them in sync if you change one.
- **Idempotency contract.** `recentBuildExists()` fetches live `data.json` and skips if `generatedAt < 90 min` old. Network failure → returns `false` (proceed). Don't flip this default.
- **Never overwrite `public/data.json` on partial failure.** `build-data.mjs` aborts before writing if every category and weather returned empty. `mergeWithFallback()` substitutes recency-picked stories per-bucket if Claude returns an empty bucket.
- **Curator JSON-prefill pattern.** `claude-curator.mjs` sends `messages[-1] = { role: 'assistant', content: '{' }` to force a JSON response. The reply parser prepends `{` before `JSON.parse`. Don't change one without the other.
- **Candidate IDs are positional.** `tagIds()` assigns `us_0..us_N`, `mx_0..`, `iw_0..`, `it_0..`, `m_0..`, `g_0..` per pool. Claude returns picks by ID. The output spec in the system prompt enumerates the exact prefixes — keep prefixes and pool names aligned.
- **Curation prompt lives in `scripts/prefs.js` (`USER_PREFS_TEXT`)**, NOT in `claude-curator.mjs`. Edit prefs.js alone to retune what Claude prioritizes — no code changes needed elsewhere.
- **Secrets via GH repo settings only.** `NEWSAPI_KEY` (required) and `ANTHROPIC_API_KEY` (optional but recommended) are repo secrets. `CLAUDE_MODEL` is a repo *variable* (default `claude-opus-4-5`). `.env` is gitignored and only for local dev with `FORCE_RUN=1`.
- **No commits to `data.json`.** It's regenerated each run and only exists in the Pages artifact. Don't add it to git — checking it in would let stale data leak past idempotency.
- **Tests live in `tests/`, run via `npm test` (Vitest).** Mock `fetch` with `fetchImpl` injection rather than monkeypatching globals. Render tests use `JSDOM` and lock `Intl.DateTimeFormat` timezone in setup so smart-detect is deterministic regardless of host TZ.

## Glossary

- **Bucket** — one of the 9 story sections on the dashboard: `us.politics`, `mexico.{politics,culture,oaxacaCoast}`, `international.{politics,generalNews,travelStyle}`, `medicineTech`, `genai`.
- **Pool** — pre-curation candidate array fed to Claude; one pool can feed multiple buckets (Mexico pool → 3 buckets; intlWorld pool → 2 buckets).
- **Oaxaca Coast** — the `mexico.oaxacaCoast` bucket; stories matching `OAXACA_RE` (Puerto Escondido, Huatulco, Mazunte, Zipolite, Pochutla, Costa Chica, Istmo de Tehuantepec) or items from the `nssoaxaca.com` feed (`oaxaca: true` in `MEXICO_FEEDS`).
- **Bias / lean** — AllSides-style political-lean rating (left / lean-left / center / lean-right / right). Mapping in `scripts/sources.js#SOURCE_BIAS`. Only attached to NewsAPI US-politics stories.
- **whyItMatters** — 1–2 sentence Claude-written gloss attached to each picked story.
- **dailyBrief** — 2–3 sentence Claude-written cross-cutting summary; leads with Oaxaca/PE when present.
- **Smart-detect** — frontend defaults the tab to "Mexico" if browser timezone matches a regex of Mexican IANA names, otherwise "US". `localStorage['news-app:tab']` overrides.
- **Window / drift** — GitHub Actions cron drifts 15+ min late under load; the 2-hour gate windows + idempotency handle this.

## Schema highlights

`public/data.json` (top-level):

```json
{
  "generatedAt": "2026-04-27T20:20:34Z",
  "dailyBrief": "…2–3 sentences…",
  "weather": [
    { "cityId": "puerto_escondido", "cityName": "Puerto Escondido",
      "current": { "tempF": 82, "icon": "🌤️", "condition": "Mostly clear", "uv": 9.4, … },
      "uv":      { "max": 9.4, "level": "very-high", "label": "Very High" },
      "tides":   [ { "type": "H", "timeLabel": "3:18 PM", "heightFt": 5.2, … } ],
      "today":   { "highF": 86, "lowF": 75, "precipChance": 0, … },
      "forecast": [ /* 7 days */ ] }
  ],
  "us":            { "politics": [ Story, … ] },
  "mexico":        { "politics": […], "culture": […], "oaxacaCoast": […] },
  "international": { "politics": […], "generalNews": […], "travelStyle": […] },
  "medicineTech":  [ Story, … ],
  "genai":         [ Story, … ],
  "curation":      { "used": true, "model": "claude-opus-4-5-…", "tokens": {…} },
  "errors":        []
}
```

Story shape varies by source. Common fields: `title`, `url`, `source`, `publishedAt`, `description`, optional `whyItMatters`. NewsAPI stories add `bias` + `biasLabel`. Mexico stories add `region: "mexico"`, `language: "es"|"en"`, `isOaxaca: bool`. International travel/style stories add `kind: "travel"|"style"|"design"`.

## Operational pointers

- **Secrets (repo):** `NEWSAPI_KEY` (required), `ANTHROPIC_API_KEY` (optional). **Variable:** `CLAUDE_MODEL` (defaults to `claude-opus-4-5`; set to `claude-haiku-4-5` for ~15× cheaper).
- **Cron:** `0 11,12,13,18,19,20 * * *` UTC — 6 firings/day. Net target: 6am + 1pm America/Chicago, both DST states, with drift buffer.
- **External services:** NewsAPI (free dev tier, 100 req/day — we use ~4); Anthropic API (Opus ~$0.30/run, ~$20/mo at twice-daily); Open-Meteo forecast + marine (no key, unrated rate limit).
- **Deploy target:** GitHub Pages via `actions/upload-pages-artifact@v3` + `actions/deploy-pages@v4`. Source set to "GitHub Actions" in repo Pages settings.
- **Local dev loop:** `npm install && cp .env.example .env` (fill `NEWSAPI_KEY`), then `npm run build:data:force` to write `public/data.json`, then `npm run preview` (serves `public/` on http://localhost:5173). Tests: `npm test`.

## Known quirks / gotchas

- **GitHub Actions cron is unreliable.** Whole crons sometimes drop silently (happened 2026-04-27: both 11Z and 18Z target firings dropped, only the drift-buffer 12:19Z and 19:16Z ran). Mitigation: 2-hour windows + idempotency. Don't tighten this back to exact-hour without rethinking the resilience model.
- **Idempotent skips show GREEN, not red.** The "Generate data.json" step inspects `public/data.json` after running the script and sets `has_data=true|false`. Upload + deploy are `if: has_data == 'true'`. Real script errors (missing key, total fetch failure) still exit non-zero and fail the build. Don't reintroduce a "verify data.json" step that exits 1 on absence — that was the old behavior and showed red on intentional skips.
- **`data.json` clobber bug (fixed).** Pre-2026-04-26 the workflow uploaded `public/` even when the script skipped, deploying an empty artifact that 404'd the live site. Fixed by (a) the workflow gate, (b) the "Verify data.json was written" step. See commit `351b1ae`.
- **Reforma RSS is `iso-8859-1`.** `fetch-mexico.mjs#fetchFeedXml` detects the XML encoding declaration and decodes accordingly. Don't switch to plain `res.text()` — Reforma titles will become mojibake.
- **El Universal Oaxaca and Aristegui Noticias serve HTML, not RSS,** despite advertised `/rss.xml` paths. They're omitted from `MEXICO_FEEDS`. Don't re-add without re-probing.
- **NewsAPI quirk:** `top-headlines` rejects `sources` + `category` together (400). US-politics uses `top-headlines` with `sources` only; medicine/tech uses `/everything` with a keyword `q=`.
- **GenAI candidates are RSS-only, not NewsAPI.** Tip-score boost re-ranks tutorial-style posts above announcements; see `fetch-genai.mjs#tipScore`. HN feed has `filterKeywords: true` to drop non-AI items.
- **README is slightly stale.** Mentions exact-hour gating; current behavior is 2-hour windows + idempotency. There's a spawned follow-up task to refresh it.

## Where to look for more

1. `scripts/build-data.mjs` — orchestration, gating, idempotency, fallback merge
2. `scripts/claude-curator.mjs` — system-prompt assembly, JSON-prefill, ID routing, partial-failure handling
3. `scripts/prefs.js` — single source of truth for curation priorities (edit this to retune)
4. `scripts/sources.js` — bias map + all RSS feed lists (Mexico, GenAI, intl world, intl travel/style)
5. `.github/workflows/build.yml` — cron schedule, gate, verify step, deploy chain
