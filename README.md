# pi-stats-ext

Local-first Pi coding-agent usage dashboard.

## Dashboard

`/pi-stats` opens a dense Ops-console TUI over local session history:

- date ranges: default `30d`, plus `7d`, `90d`, `all`, or `YYYY-MM-DD..YYYY-MM-DD`
- colored summary cards for fresh tokens, cost, cache, sessions/projects
- Claude Code-style insights: favorite model, total tokens, most active day, longest session, longest/current streak
- terminal heatmap with month labels, exact date range, and intensity legend for daily fresh tokens
- model token mix graphic with proportional bars, percentages, and input/output tokens
- bordered tables for top models, projects, and sessions by cost/tokens
- keyboard controls: `1`/`2`/`3`/`4`, left/right cycle, `q`/`esc` close
- incremental JSON cache at `~/.pi/agent/pi-stats/cache.json`

## Install locally

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

## Notes

This intentionally uses `/pi-stats` instead of `/stats` or `/usage` to avoid conflicts with existing Pi ecosystem packages.
