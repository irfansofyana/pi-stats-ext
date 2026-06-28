import { basename } from "node:path";
import {
  aggregate,
  formatCost,
  formatTokens,
  parseRange,
  type AggregatedStats,
  type DateRange,
  type RefreshResult,
  type StatsCache,
} from "./stats.js";

const PRESETS = ["today", "7d", "30d", "90d", "all"] as const;
const VIEWS = ["overview", "models", "projects", "sessions"] as const;
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const FG = {
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  gray: "\x1b[90m",
  white: "\x1b[97m",
} as const;
const BG = { cyan: "\x1b[46m", blue: "\x1b[44m", gray: "\x1b[100m" } as const;
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const DAY_MS = 24 * 60 * 60 * 1000;

type Done = (value: void) => void;
type View = (typeof VIEWS)[number];

type DashboardOptions = {
  cache: StatsCache;
  args: string;
  done: Done;
  refresh?: string;
};

type Column<T> = {
  title: string;
  width: number;
  align?: "left" | "right";
  render: (row: T, index: number) => string;
};

type InsightStats = {
  favoriteModel: string;
  totalDays: number;
  mostActiveDay: string;
  longestSessionMs: number;
  longestStreak: number;
  currentStreak: number;
};

export class PiStatsDashboard {
  private cache: StatsCache;
  private arg: string;
  private stats: AggregatedStats;
  private refresh: string;
  private view: View = "overview";
  private dateEditing = false;
  private dateInput = "";
  private dateError = "";
  private cachedWidth = 0;
  private cachedLines: string[] | undefined;

  constructor(options: DashboardOptions) {
    this.cache = options.cache;
    this.arg = normalizeArg(options.args);
    this.stats = aggregate(this.cache, parseRange(this.arg));
    this.refresh = options.refresh || "loading cache";
    this.done = options.done;
  }

  private done: Done;

  setRefreshResult(result: RefreshResult): void {
    this.cache = result.cache;
    this.stats = aggregate(this.cache, parseRange(this.arg));
    const errors = result.errors.length ? `, ${result.errors.length} errors` : "";
    this.refresh = `indexed ${result.totalFiles} files (${result.parsedFiles} parsed, ${result.reusedFiles} cached${errors})`;
    this.invalidate();
  }

  setRefreshError(error: unknown): void {
    this.refresh = `index failed: ${error instanceof Error ? error.message : String(error)}`;
    this.invalidate();
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
    const w = Math.max(56, width);
    const stats = this.stats;
    const lines: string[] = [];

    lines.push(header(stats, this.refresh, w));
    lines.push(tabs(this.arg, w));
    lines.push(viewTabs(this.view, w));
    if (this.dateEditing || this.dateError) lines.push(datePrompt(this.dateInput, this.dateError, w));
    lines.push(legend(w));
    lines.push("");
    lines.push(...viewBody(this.view, this.cache, stats, w));

    this.cachedWidth = width;
    this.cachedLines = lines.map((line) => crop(line, width));
    return this.cachedLines;
  }

  handleInput(data: string): void {
    if (this.dateEditing) {
      this.handleDateInput(data);
      return;
    }
    if (data === "q" || data === "Q" || data === "\u001b" || data === "\x03") {
      this.done();
      return;
    }
    if (data === "1") this.setArg("today");
    else if (data === "2") this.setArg("7d");
    else if (data === "3") this.setArg("30d");
    else if (data === "4") this.setArg("90d");
    else if (data === "5") this.setArg("all");
    else if (data === "d" || data === "D") this.startDateInput();
    else if (data === "o" || data === "O") this.setView("overview");
    else if (data === "m" || data === "M") this.setView("models");
    else if (data === "p" || data === "P") this.setView("projects");
    else if (data === "s" || data === "S") this.setView("sessions");
    else if (data === "\t") this.cycleView(1);
    else if (data.includes("[C")) this.cycle(1);
    else if (data.includes("[D")) this.cycle(-1);
  }

  invalidate(): void {
    this.cachedLines = undefined;
    this.cachedWidth = 0;
  }

  private handleDateInput(data: string): void {
    if (data === "\u001b" || data === "\x03") {
      this.dateEditing = false;
      this.dateError = "";
    } else if (data === "\r" || data === "\n") {
      const next = this.dateInput.trim().toLowerCase();
      if (isValidRangeArg(next)) {
        this.setArg(next);
        this.dateEditing = false;
        this.dateError = "";
      } else {
        this.dateError = "use today, 7d, 30d, 90d, all, or YYYY-MM-DD..YYYY-MM-DD";
      }
    } else if (data === "\x7f" || data === "\b") {
      this.dateInput = this.dateInput.slice(0, -1);
      this.dateError = "";
    } else if (/^[\x20-\x7e]+$/.test(data)) {
      this.dateInput = (this.dateInput + data).slice(0, 40);
      this.dateError = "";
    }
    this.invalidate();
  }

  private startDateInput(): void {
    this.dateEditing = true;
    this.dateInput = "";
    this.dateError = "";
    this.invalidate();
  }

  private setView(view: View): void {
    this.view = view;
    this.invalidate();
  }

  private setArg(arg: string): void {
    this.arg = normalizeArg(arg);
    this.stats = aggregate(this.cache, parseRange(this.arg));
    this.dateError = "";
    this.invalidate();
  }

  private cycle(delta: number): void {
    const current = PRESETS.indexOf(this.arg as (typeof PRESETS)[number]);
    const next = current === -1 ? 1 : (current + delta + PRESETS.length) % PRESETS.length;
    this.setArg(PRESETS[next]!);
  }

  private cycleView(delta: number): void {
    const current = VIEWS.indexOf(this.view);
    this.setView(VIEWS[(current + delta + VIEWS.length) % VIEWS.length]!);
  }
}

export function normalizeArg(args: string): string {
  const text = args.trim().toLowerCase();
  if (!text) return "30d";
  if (/^\d+$/.test(text)) return `${text}d`;
  return text;
}

function isValidRangeArg(arg: string): boolean {
  const text = normalizeArg(arg);
  if (["today", "7d", "30d", "90d", "all"].includes(text)) return true;
  const custom = text.match(/^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/);
  if (!custom) return false;
  const start = Date.parse(`${custom[1]}T00:00:00.000Z`);
  const end = Date.parse(`${custom[2]}T00:00:00.000Z`);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start;
}

function header(stats: AggregatedStats, refresh: string, width: number): string {
  const title = `${BOLD}${FG.white} pi-stats ${RESET}${DIM}│${RESET} ${FG.cyan}${stats.range.label}${RESET}`;
  const statusColor = refresh.includes("failed") || refresh.includes("errors") ? FG.red : FG.green;
  const right = `${statusColor}${refresh}${RESET}`;
  const gap = Math.max(1, width - visible(title) - visible(right));
  return crop(`${title}${" ".repeat(gap)}${right}`, width);
}

function tabs(active: string, width: number): string {
  const labels = PRESETS.map((preset, index) => {
    const label = `${index + 1}:${preset}`;
    return preset === active ? `${BG.cyan}${FG.white}${BOLD} ${label} ${RESET}` : `${FG.gray} ${label} ${RESET}`;
  });
  return crop(`${labels.join(" ")} ${DIM}d custom · ←/→ range · q/esc close${RESET}`, width);
}

function viewTabs(active: View, width: number): string {
  const labels: Array<[View, string]> = [
    ["overview", "O:overview"],
    ["models", "M:models"],
    ["projects", "P:projects"],
    ["sessions", "S:sessions"],
  ];
  return crop(labels.map(([view, label]) => (view === active ? `${BG.blue}${FG.white}${BOLD} ${label} ${RESET}` : `${FG.gray} ${label} ${RESET}`)).join(" ") + ` ${DIM}tab view${RESET}`, width);
}

function datePrompt(input: string, error: string, width: number): string {
  const prompt = `${FG.yellow}date>${RESET} ${input}${BOLD}_${RESET}`;
  const help = error ? `${FG.red}${error}${RESET}` : `${DIM}enter applies · esc cancels · e.g. today, 7d, all, 2026-06-28..2026-06-28${RESET}`;
  return crop(`${prompt} ${help}`, width);
}

function legend(width: number): string {
  return crop(`${DIM}Global date filter applies to every view · local cache only${RESET}`, width);
}

function viewBody(view: View, cache: StatsCache, stats: AggregatedStats, width: number): string[] {
  if (view === "models") return [...box("MODEL TOKEN MIX / fresh tokens", modelTokenGraphic(stats, width - 4), width, FG.cyan), "", ...table("TOP MODELS", stats.models.slice(0, 12), modelColumns(), width, FG.cyan)];
  if (view === "projects") return table("TOP PROJECTS", stats.projects.slice(0, 14), projectColumns(width), width, FG.yellow);
  if (view === "sessions") return table("TOP SESSIONS", stats.sessions.slice(0, 14), sessionColumns(width), width, FG.magenta);
  return [
    ...summaryCards(stats, width),
    "",
    ...box("USAGE INSIGHTS", insightLines(dashboardInsights(cache, stats), stats, width - 4), width, FG.yellow),
    "",
    ...box(activityTitle(stats), heatmap(stats, width - 4), width, FG.green),
  ];
}

function dashboardInsights(cache: StatsCache, stats: AggregatedStats): InsightStats {
  const activeDays = [...stats.daily.entries()].filter(([, totals]) => totals.freshTokens > 0).map(([day]) => day).sort();
  const activeSet = new Set(activeDays);
  const favorite = [...stats.models].sort((a, b) => b.freshTokens - a.freshTokens)[0]?.label || "none";
  const mostActive = [...stats.daily.entries()].sort((a, b) => b[1].freshTokens - a[1].freshTokens)[0]?.[0];
  const sessions = new Map<string, { min: number; max: number }>();
  const seenEvents = new Set<string>();
  for (const file of Object.values(cache.files)) {
    for (const event of file.session.events) {
      if (!inDashboardRange(event.timestamp, stats.range)) continue;
      const fingerprint = `${event.timestamp}|${event.provider}|${event.model}|${event.totalTokens}|${event.cost.toFixed(8)}`;
      if (seenEvents.has(fingerprint)) continue;
      seenEvents.add(fingerprint);
      const current = sessions.get(event.sessionPath) || { min: event.timestamp, max: event.timestamp };
      current.min = Math.min(current.min, event.timestamp);
      current.max = Math.max(current.max, event.timestamp);
      sessions.set(event.sessionPath, current);
    }
  }
  const longestSessionMs = Math.max(0, ...[...sessions.values()].map((session) => session.max - session.min));
  const range = heatRange(stats.range, stats.daily);
  const totalDays = range ? Math.floor((range.end - range.start) / DAY_MS) + 1 : activeDays.length;
  const currentEnd = shortDate(range?.end ?? Date.now());
  return {
    favoriteModel: favorite,
    totalDays,
    mostActiveDay: mostActive ? shortMonthDay(Date.parse(`${mostActive}T00:00:00.000Z`)) : "none",
    longestSessionMs,
    longestStreak: longestStreak(activeSet),
    currentStreak: currentStreak(activeSet, currentEnd),
  };
}

function insightLines(insights: InsightStats, stats: AggregatedStats, width: number): string[] {
  const left = [
    `Favorite model: ${FG.red}${insights.favoriteModel}${RESET}`,
    `Sessions: ${FG.red}${compact(stats.sessionCount)}${RESET}`,
    `Active days: ${FG.red}${stats.activeDays}${RESET}${DIM}/${insights.totalDays}${RESET}`,
    `Most active day: ${FG.red}${insights.mostActiveDay}${RESET}`,
  ];
  const right = [
    `Total tokens: ${FG.red}${formatTokens(stats.totals.totalTokens)}${RESET}`,
    `Longest session: ${FG.red}${formatDuration(insights.longestSessionMs)}${RESET}`,
    `Longest streak: ${FG.red}${insights.longestStreak}${RESET} ${plural("day", insights.longestStreak)}`,
    `Current streak: ${FG.red}${insights.currentStreak}${RESET} ${plural("day", insights.currentStreak)}`,
  ];
  const half = Math.max(32, Math.floor((width - 3) / 2));
  return left.map((line, index) => `${padAnsi(line, half)} ${DIM}│${RESET} ${right[index] ?? ""}`);
}

function modelTokenGraphic(stats: AggregatedStats, width: number): string[] {
  const models = [...stats.models].sort((a, b) => b.freshTokens - a.freshTokens).slice(0, 5);
  if (!models.length) return [`${DIM}no data${RESET}`];
  const labelWidth = Math.min(24, Math.max(12, Math.floor(width * 0.22)));
  const barWidth = Math.max(10, width - labelWidth - 28);
  const max = Math.max(...models.map((model) => model.freshTokens), 1);
  const colors = [FG.cyan, FG.green, FG.yellow, FG.magenta, FG.blue];
  return models.map((model, index) => {
    const color = colors[index % colors.length]!;
    const cells = Math.max(1, Math.round((model.freshTokens / max) * barWidth));
    const percent = stats.totals.freshTokens ? ((model.freshTokens / stats.totals.freshTokens) * 100).toFixed(1) : "0.0";
    const bar = `${color}${"█".repeat(cells)}${DIM}${"░".repeat(Math.max(0, barWidth - cells))}${RESET}`;
    const io = `${formatTokens(model.input)} in / ${formatTokens(model.output)} out`;
    return `${color}●${RESET} ${padAnsi(model.label, labelWidth)} ${bar} ${padStartAnsi(`${percent}%`, 6)} ${DIM}${io}${RESET}`;
  });
}

function summaryCards(stats: AggregatedStats, width: number): string[] {
  const totals = stats.totals;
  const cards = [
    card("FRESH", `${formatTokens(totals.freshTokens)} tok`, `${formatTokens(totals.input)} in / ${formatTokens(totals.output)} out`, FG.green),
    card("COST", formatCost(totals.cost), `${totals.messages} msgs`, totals.cost > 100 ? FG.red : FG.yellow),
    card("CACHE", `${formatTokens(totals.cacheRead)} read`, `${formatTokens(totals.cacheWrite)} write`, FG.blue),
    card("SCOPE", `${stats.sessionCount} sessions`, `${stats.projectCount} projects · ${stats.activeDays} days`, FG.magenta),
  ];
  return wrapColumns(cards, width);
}

function card(label: string, value: string, sub: string, color: string): string[] {
  const inner = 24;
  return [
    `${color}╭${"─".repeat(inner)}╮${RESET}`,
    `${color}│${RESET} ${DIM}${pad(label, inner - 1)}${RESET}${color}│${RESET}`,
    `${color}│${RESET} ${BOLD}${pad(value, inner - 1)}${RESET}${color}│${RESET}`,
    `${color}│${RESET} ${FG.gray}${pad(sub, inner - 1)}${RESET}${color}│${RESET}`,
    `${color}╰${"─".repeat(inner)}╯${RESET}`,
  ];
}

function wrapColumns(blocks: string[][], width: number): string[] {
  const blockWidth = Math.max(...blocks.flat().map(visible));
  const perRow = Math.max(1, Math.min(blocks.length, Math.floor((width + 1) / (blockWidth + 1))));
  const rows: string[] = [];
  for (let i = 0; i < blocks.length; i += perRow) {
    const slice = blocks.slice(i, i + perRow);
    for (let line = 0; line < slice[0]!.length; line++) rows.push(slice.map((b) => padAnsi(b[line]!, blockWidth)).join(" "));
  }
  return rows;
}

function modelColumns(): Column<AggregatedStats["models"][number]>[] {
  return [
    { title: "#", width: 3, align: "right", render: (_b, i) => `${FG.gray}${i + 1}${RESET}` },
    { title: "model", width: 26, render: (b) => b.label },
    { title: "cost", width: 9, align: "right", render: (b) => money(b.cost) },
    { title: "fresh", width: 9, align: "right", render: (b) => `${formatTokens(b.freshTokens)} tok` },
    { title: "msgs", width: 7, align: "right", render: (b) => String(b.messages) },
    { title: "sess", width: 6, align: "right", render: (b) => String(b.sessions.size) },
  ];
}

function projectColumns(width: number): Column<AggregatedStats["projects"][number]>[] {
  return [
    { title: "#", width: 3, align: "right", render: (_b, i) => `${FG.gray}${i + 1}${RESET}` },
    { title: "project", width: 22, render: (b) => b.label },
    { title: "cost", width: 9, align: "right", render: (b) => money(b.cost) },
    { title: "fresh", width: 9, align: "right", render: (b) => `${formatTokens(b.freshTokens)} tok` },
    { title: "sess", width: 6, align: "right", render: (b) => String(b.sessions.size) },
    { title: "path", width: Math.max(18, width - 68), render: (b) => String(b.meta?.cwd || "") },
  ];
}

function sessionColumns(width: number): Column<AggregatedStats["sessions"][number]>[] {
  return [
    { title: "#", width: 3, align: "right", render: (_b, i) => `${FG.gray}${i + 1}${RESET}` },
    { title: "session", width: Math.max(24, width - 54), render: (b) => b.label },
    { title: "cost", width: 9, align: "right", render: (b) => money(b.cost) },
    { title: "fresh", width: 9, align: "right", render: (b) => `${formatTokens(b.freshTokens)} tok` },
    { title: "project", width: 18, render: (b) => String(b.meta?.project || basename(String(b.meta?.cwd || ""))) },
  ];
}

function table<T>(title: string, rows: T[], columns: Column<T>[], width: number, color: string): string[] {
  const usable = Math.max(20, width - 4);
  const fitted = fitColumns(columns, usable);
  const border = "─".repeat(fitted.reduce((sum, col) => sum + col.width, 0) + fitted.length * 3 + 1);
  const lines = [`${color}╭─ ${title} ${border.slice(title.length + 3)}╮${RESET}`];
  lines.push(rowLine(fitted.map((col) => ({ text: col.title, width: col.width, align: col.align })), color, true));
  lines.push(`${color}├${border}┤${RESET}`);
  if (!rows.length) lines.push(`${color}│${RESET} ${DIM}${pad("no data", visible(border) - 1)}${RESET}${color}│${RESET}`);
  rows.forEach((row, index) => {
    lines.push(rowLine(fitted.map((col) => ({ text: col.render(row, index), width: col.width, align: col.align })), color));
  });
  lines.push(`${color}╰${border}╯${RESET}`);
  return lines.map((line) => crop(line, width));
}

function fitColumns<T>(columns: Column<T>[], usable: number): Column<T>[] {
  const total = columns.reduce((sum, col) => sum + col.width, 0) + columns.length * 3 + 1;
  if (total <= usable) return columns;
  const last = columns[columns.length - 1]!;
  const excess = total - usable;
  return [...columns.slice(0, -1), { ...last, width: Math.max(8, last.width - excess) }];
}

function rowLine(cells: { text: string; width: number; align?: "left" | "right" }[], color: string, heading = false): string {
  const parts = cells.map((cell) => {
    const text = crop(cell.text, cell.width);
    const padded = cell.align === "right" ? padStartAnsi(text, cell.width) : padAnsi(text, cell.width);
    return heading ? `${BOLD}${FG.white}${padded}${RESET}` : padded;
  });
  return `${color}│${RESET} ${parts.join(` ${color}│${RESET} `)} ${color}│${RESET}`;
}

function box(title: string, body: string[], width: number, color: string): string[] {
  const inner = Math.max(20, width - 2);
  const top = `${color}╭─ ${title} ${"─".repeat(Math.max(0, inner - title.length - 4))}╮${RESET}`;
  const bottom = `${color}╰${"─".repeat(inner)}╯${RESET}`;
  const rows = body.length ? body : [`${DIM}no data${RESET}`];
  return [top, ...rows.map((line) => `${color}│${RESET}${padAnsi(` ${line}`, inner)}${color}│${RESET}`), bottom].map((line) => crop(line, width));
}

function activityTitle(stats: AggregatedStats): string {
  const range = heatRange(stats.range, stats.daily);
  return range ? `ACTIVITY / fresh tokens · ${shortDate(range.start)} → ${shortDate(range.end)}` : "ACTIVITY / fresh tokens";
}

function heatmap(stats: AggregatedStats, width: number): string[] {
  const available = Math.max(12, width - 8);
  const maxWeeks = Math.min(53, available);
  const range = heatRange(stats.range, stats.daily);
  if (!range) return [`${DIM}no data${RESET}`];

  let start = startOfUtcWeek(range.start);
  const end = range.end;
  let weeks = Math.floor((end - start) / (7 * DAY_MS)) + 1;
  if (weeks > maxWeeks) {
    weeks = maxWeeks;
    start = startOfUtcWeek(end - weeks * 7 * DAY_MS);
  }

  const max = Math.max(...[...stats.daily.values()].map((d) => d.freshTokens), 0);
  const rows: string[] = [`${DIM}    ${monthAxis(start, weeks, range.start, end)}${RESET}`];
  const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  for (let day = 0; day < 7; day++) {
    let line = `${FG.gray}${labels[day]}${RESET} `;
    for (let week = 0; week < weeks; week++) {
      const ts = start + (week * 7 + day) * DAY_MS;
      if (ts < range.start || ts > end) {
        line += " ";
        continue;
      }
      const key = new Date(ts).toISOString().slice(0, 10);
      line += heatChar(stats.daily.get(key)?.freshTokens || 0, max);
    }
    rows.push(line);
  }
  rows.push(`${DIM}    · none  ${FG.green}░${RESET}${DIM} low  ${FG.yellow}▒${RESET}${DIM} med  ${FG.red}▓${RESET}${DIM} high  ${FG.red}${BOLD}█${RESET}${DIM} peak${RESET}`);
  return rows;
}

function inDashboardRange(timestamp: number, range: DateRange): boolean {
  if (range.start !== undefined && timestamp < range.start) return false;
  if (range.end !== undefined && timestamp >= range.end) return false;
  return true;
}

function longestStreak(activeDays: Set<string>): number {
  let best = 0;
  let current = 0;
  let previous = 0;
  for (const day of [...activeDays].sort()) {
    const ts = Date.parse(`${day}T00:00:00.000Z`);
    current = previous && ts - previous === DAY_MS ? current + 1 : 1;
    best = Math.max(best, current);
    previous = ts;
  }
  return best;
}

function currentStreak(activeDays: Set<string>, endDay: string): number {
  let streak = 0;
  let ts = Date.parse(`${endDay}T00:00:00.000Z`);
  while (activeDays.has(shortDate(ts))) {
    streak++;
    ts -= DAY_MS;
  }
  return streak;
}

function formatDuration(ms: number): string {
  if (!ms) return "0m";
  const minutes = Math.max(1, Math.round(ms / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days) return `${days}d ${hours}h ${mins}m`;
  if (hours) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function compact(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

function plural(word: string, count: number): string {
  return count === 1 ? word : `${word}s`;
}

function heatRange(range: DateRange, daily: AggregatedStats["daily"]): { start: number; end: number } | undefined {
  const keys = [...daily.keys()].sort();
  if (!keys.length && (range.start === undefined || range.end === undefined)) return undefined;
  const start = range.start ?? Date.parse(`${keys[0]}T00:00:00.000Z`);
  const end = (range.end ?? Date.parse(`${keys[keys.length - 1]}T00:00:00.000Z`) + DAY_MS) - DAY_MS;
  return { start, end };
}

function monthAxis(start: number, weeks: number, rangeStart: number, end: number): string {
  const chars = Array.from({ length: weeks }, () => " ");
  let lastMonth = -1;
  for (let week = 0; week < weeks; week++) {
    const weekStart = start + week * 7 * DAY_MS;
    if (weekStart > end) break;
    const date = new Date(Math.max(weekStart, rangeStart));
    const month = date.getUTCMonth();
    if (week > 0 && month === lastMonth) continue;
    const label = date.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
    if (week + label.length > chars.length) continue;
    if (chars.slice(week, week + label.length).some((char) => char !== " ")) continue;
    for (let i = 0; i < label.length; i++) chars[week + i] = label[i]!;
    lastMonth = month;
  }
  return chars.join("");
}

function shortDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function shortMonthDay(timestamp: number): string {
  return new Date(timestamp).toLocaleString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function startOfUtcWeek(timestamp: number): number {
  const d = new Date(timestamp);
  const day = d.getUTCDay();
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return start - day * DAY_MS;
}

function heatChar(value: number, max: number): string {
  if (!value || !max) return `${FG.gray}·${RESET}`;
  const ratio = value / max;
  if (ratio < 0.25) return `${FG.green}░${RESET}`;
  if (ratio < 0.5) return `${FG.yellow}▒${RESET}`;
  if (ratio < 0.75) return `${FG.red}▓${RESET}`;
  return `${FG.red}${BOLD}█${RESET}`;
}

function money(cost: number): string {
  const color = cost > 100 ? FG.red : cost > 1 ? FG.yellow : FG.green;
  return `${color}${formatCost(cost)}${RESET}`;
}

function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

function visible(text: string): number {
  return stripAnsi(text).length;
}

function pad(text: string, width: number): string {
  return crop(stripAnsi(text), width).padEnd(width, " ");
}

function padAnsi(text: string, width: number): string {
  return crop(text, width) + " ".repeat(Math.max(0, width - visible(crop(text, width))));
}

function padStartAnsi(text: string, width: number): string {
  const cropped = crop(text, width);
  return " ".repeat(Math.max(0, width - visible(cropped))) + cropped;
}

function crop(text: string, width: number): string {
  if (width <= 0) return "";
  if (visible(text) <= width) return text;
  let out = "";
  let seen = 0;
  for (let i = 0; i < text.length && seen < width - 1; i++) {
    if (text[i] === "\x1b") {
      const match = text.slice(i).match(/^\x1b\[[0-9;]*m/);
      if (match) {
        out += match[0];
        i += match[0].length - 1;
        continue;
      }
    }
    out += text[i];
    seen++;
  }
  return `${out}…${RESET}`;
}
