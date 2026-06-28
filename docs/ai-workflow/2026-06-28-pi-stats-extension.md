# Pi Stats Extension

## Goal

Build a local-first, publishable Pi extension that answers personal coding-agent usage questions: date-range usage, tokens, cost, most-used models, active days, top sessions, and top projects.

## Mode

Medium

## Current Status

Done: custom `/pi-stats` implemented, then upgraded beyond MVP to dense Ops-console TUI with colored cards, Claude Code-style usage insights, heatmap legend, model token graphic, and bordered tables.

## Local Instructions

Repo instruction files consulted: none present in current repo. `README.md` only says: "Monitor your stats on pi coding agents". Pi docs consulted: `docs/extensions.md`, `docs/tui.md`, `docs/session-format.md`, `docs/packages.md`. Constraints: TypeScript extension, package via `package.json` `pi.extensions`, TUI via `ctx.ui.custom()`, session JSONL contains usage/cost/model/cwd data.

## Decisions

- Local-first MVP; publishable later.
- `/pi-stats` inside Pi TUI first; no browser dashboard in MVP.
- Scan all Pi sessions by default.
- Use incremental JSON cache keyed by session path, mtime, and size; first run may show partial stats while indexing.
- Visual direction after MVP: dense Ops-console, terminal-native, colored scan cues, low decoration.
- Dashboard UI: summary cards, usage insights, colored heatmap with date axis/legend, model token mix graphic, bordered top models/projects/sessions tables.
- Analytics: totals, input/output/cache tokens, cost, favorite model, most active day, longest session, longest/current streak, top models, active days, top sessions, top projects.
- Project labels use folder name in tables; full path in project table.
- Out of scope for now: date picker, gamification, SQLite/server, browser dashboard, new UI dependencies.

## Research

Findings from 2026-06-28 web/package research:

- `@firstpick/pi-extension-stats` (`https://pi.dev/packages/@firstpick/pi-extension-stats`) already provides `/stats` over Pi session history with daily UTC aggregation, token/cost bars, cache breakdown, top model usage, most expensive sessions, cost trends, cache views, and prompt-input estimation via `/stats-pi`. Impact: our `/stats` command name may conflict; avoid copying broad command set and differentiate on UX/performance/project focus.
- `pi-usage-widget` (`https://pi.dev/packages/pi-usage-widget`) provides live widget above editor plus `/usage` dashboard, time scopes, per-provider/model tables, settings, periodic refresh, dedupe by `timestamp + total tokens`, and explicitly excludes cache reads from fresh-token totals. Impact: reuse semantics: `freshTokens = input + output + cacheWrite`; cache read shown separately.
- `@tmustier/pi-usage-extension` (`https://www.npmjs.com/package/@tmustier/pi-usage-extension`) and `@pi-vault/pi-usage` (`https://pi.dev/packages/@pi-vault/pi-usage`) provide aggregated `/usage` TUI dashboards across sessions, providers/models, periods, insights, and live provider quota/balance snapshots. Impact: our MVP should not try to win on generic provider quota; focus on personal project/session exploration and heatmap.
- `pi-token-usage` variants (`https://pi.dev/packages/pi-token-usage`, `https://pi.dev/packages/@alexanderfortin/pi-token-usage`) provide cross-session summaries, model/day/month/session/project breakdowns, exports, and pruning. Impact: export/prune are out of scope; project/session breakdown is table-stakes.
- `@fnnm/pi-session-breakdown` (`https://pi.dev/packages/@fnnm/pi-session-breakdown`) specifically offers interactive TUI for last 7/30/90 days with sessions/messages/tokens/cost by model and GitHub-contributions-style calendar graph. Impact: heatmap exists elsewhere; our differentiator needs better query flow/performance/cache/project ranking.
- `@ygncode/pi-insights` (`https://pi.dev/packages/@ygncode/pi-insights`) and `@observal/pi-insights` (`https://pi.dev/packages/@observal/pi-insights`) generate self-contained browser HTML reports from Pi session history, covering usage/model/project/session/rage or workflow/friction/suggestion analytics. Observal uses deterministic stats plus LLM facet extraction cached under `~/.pi/agent/usage-data/`. Impact: browser/LLM insight reports are out of MVP; maybe later.
- `pi-observability` (`https://pi.dev/packages/pi-observability`) provides live footer, `/obs` TUI dashboard, runtime/git/context/TPS/session history. Impact: live session observability is adjacent but not same as historical analytics; do not replace footer in MVP.
- `pi-usage-bar` (`https://pi.dev/packages/pi-usage-bar`) uses SQLite ledger, per-session/per-project attribution, date ranges (`since`, `between`), top projects/models/sessions, footer, `usage_query` tool, attribution aliases/undo, and privacy config. Impact: strongest architecture prior art; JSON cache is still acceptable for our MVP, but project attribution/aliasing is valuable later.
- `pi-per-commit-spend` (`https://pi.dev/packages/pi-per-commit-spend`) estimates subscription-provider zero-cost rows via `models.dev` pricing and caches prices 24h. Impact: if Pi reports `cost.total = 0`, future version can estimate; MVP should show zero as reported or label as unknown/zero.
- `ccusage` (`https://ccusage.com/guide`) is a local CLI supporting many coding agents including Pi, with daily/weekly/monthly/session reports, estimated costs, cache accounting, JSON output, no uploads. Impact: adjacent outside Pi; confirms local-log parsing + date/session/project reports are expected.
- Claude Code official docs (`https://code.claude.com/docs/en/costs`) include built-in `/usage` and cost-reduction guidance. Impact: users expect in-agent usage command, not only external report.

Research conclusion: this space is crowded. A useful custom extension should be opinionated: fast all-history indexed TUI, GitHub-like daily heatmap, top projects/sessions/models, typed date ranges, and clean personal dashboard. Avoid competing on live provider quotas, export formats, pruning, HTML reports, or complex footer customization in MVP.

## Plan

- [x] Inspect local repo and Pi docs.
- [x] Align MVP scope with user.
- [x] Research similar Pi extensions/packages and adjacent tools.
- [x] Confirm post-research differentiation with user.
- [x] Update implementation plan based on research.
- [x] Implement extension/package.
- [x] Verify with tests/build and sample session fixtures.
- [x] Upgrade UI beyond MVP to dense Ops-console dashboard.
- [x] Update README and workflow docs for new dashboard direction.
- [x] Add Claude Code-style usage insights and model token mix graphic.

## Key Areas

- `package.json` — Pi package manifest, scripts, peer/dev deps.
- `src/index.ts` — registers `/pi-stats` command and opens TUI.
- `src/stats.ts` — session JSONL parsing, incremental JSON cache, date ranges, aggregation.
- `src/dashboard.ts` — dense Ops-console TUI component with ANSI colors, summary cards, usage insights, heatmap, model token graphic, and bordered top tables.
- `tests/stats.test.ts` — parser/cache/aggregation/range tests.
- `README.md` — install/use/develop notes.
- `docs/ai-workflow/2026-06-28-pi-stats-extension.md` — live workflow artifact.

## Verification

- `npm test` — passed. 4 tests cover session parsing, aggregation, cache reuse, and range parsing.
- `npm run build` — passed. TypeScript compile succeeds.

## Open Questions And Risks

- Existing ecosystem overlap remains; command name `/pi-stats` avoids `/stats` and `/usage` collisions.
- First open uses cached data immediately, then refreshes session history asynchronously; very first run with no cache shows empty dashboard until refresh completes.
- JSON cache is MVP choice; SQLite ledger/project aliases remain future work if history grows large or attribution needs correction.
- Cost uses Pi/provider-reported `usage.cost.total`; subscription-provider zero-cost estimation is deferred.

## Handoff

Next action for a fresh agent: optionally run `pi install ./`, reload Pi, and manually smoke-test `/pi-stats`, `/pi-stats 7d`, and `/pi-stats 2026-06-01..2026-06-30` inside Pi TUI against real local session history, checking insights, streaks, model token bars, ANSI colors, and table cropping at narrow/wide widths.
