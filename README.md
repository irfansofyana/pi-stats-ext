# pi-stats-ext

[![npm](https://img.shields.io/npm/v/pi-stats-ext?color=blue)](https://www.npmjs.com/package/pi-stats-ext)

Local-first Pi coding-agent usage dashboard.

![pi-stats overview](docs/img/pi-stats-overview.png)

![pi-stats dashboard](docs/img/pi-stats-dashboard.png)

## Dashboard

`/pi-stats` opens a dense Ops-console TUI over local session history:

- global date ranges: default `30d`, plus `today`, `7d`, `90d`, `all`, or `YYYY-MM-DD..YYYY-MM-DD`
- multi-view layout: Overview, Models, Projects, Sessions
- colored summary cards for fresh tokens, cost, cache, sessions/projects
- Claude Code-style insights: favorite model, total tokens, most active day, longest session, longest/current streak
- terminal heatmap with month labels, exact date range, and intensity legend for daily fresh tokens
- model token mix graphic with proportional bars, percentages, and input/output tokens
- bordered tables for top models, projects, and sessions by cost/tokens
- keyboard controls: `1` today, `2` 7d, `3` 30d, `4` 90d, `5` all, `d` custom date input, `o`/`m`/`p`/`s` views, tab cycles views, left/right cycles range, `q`/`esc` close
- incremental JSON cache at `~/.pi/agent/pi-stats/cache.json`

## Installation

### npm

```bash
pi install npm:pi-stats-ext
```

Then reload Pi and run:

```text
/pi-stats
```

### Local development install

```bash
npm install
pi install ./
# then reload pi and run:
/pi-stats
```

## Develop

```bash
npm test
npm run build
```
