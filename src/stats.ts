import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

export type UsageTotals = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  freshTokens: number;
  cost: number;
  messages: number;
};

export type UsageEvent = UsageTotals & {
  timestamp: number;
  day: string;
  provider: string;
  model: string;
  sessionPath: string;
  sessionId: string;
  sessionName: string;
  cwd: string;
  project: string;
};

export type SessionSummary = {
  sessionPath: string;
  sessionId: string;
  sessionName: string;
  cwd: string;
  project: string;
  startedAt: number;
  events: UsageEvent[];
};

export type CachedFile = {
  path: string;
  mtimeMs: number;
  size: number;
  parsedAt: number;
  session: SessionSummary;
};

export type StatsCache = {
  version: 1;
  files: Record<string, CachedFile>;
};

export type RefreshResult = {
  cache: StatsCache;
  totalFiles: number;
  parsedFiles: number;
  reusedFiles: number;
  errors: Array<{ path: string; message: string }>;
};

export type DateRange = {
  label: string;
  start?: number;
  end?: number;
};

export type Bucket = UsageTotals & {
  key: string;
  label: string;
  sessions: Set<string>;
  projects: Set<string>;
  meta?: Record<string, string | number>;
};

export type AggregatedStats = {
  range: DateRange;
  totals: UsageTotals;
  activeDays: number;
  sessionCount: number;
  projectCount: number;
  daily: Map<string, UsageTotals>;
  models: Bucket[];
  projects: Bucket[];
  sessions: Bucket[];
  eventCount: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function getAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

export function getDefaultPaths(agentDir = getAgentDir()) {
  return {
    sessionDir: join(agentDir, "sessions"),
    cachePath: join(agentDir, "pi-stats", "cache.json"),
  };
}

export function emptyTotals(): UsageTotals {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, freshTokens: 0, cost: 0, messages: 0 };
}

export function addTotals(target: UsageTotals, source: UsageTotals): UsageTotals {
  target.input += source.input;
  target.output += source.output;
  target.cacheRead += source.cacheRead;
  target.cacheWrite += source.cacheWrite;
  target.totalTokens += source.totalTokens;
  target.freshTokens += source.freshTokens;
  target.cost += source.cost;
  target.messages += source.messages;
  return target;
}

export function dayKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function parseRange(input: string, now = Date.now()): DateRange {
  const text = input.trim();
  if (!text || text === "30" || text === "30d") return lastDaysRange(30, now);
  if (text === "7" || text === "7d") return lastDaysRange(7, now);
  if (text === "90" || text === "90d") return lastDaysRange(90, now);
  if (text === "all") return { label: "all time" };

  const custom = text.match(/^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/);
  if (custom) {
    const start = Date.parse(`${custom[1]}T00:00:00.000Z`);
    const end = Date.parse(`${custom[2]}T00:00:00.000Z`) + DAY_MS;
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      return { label: `${custom[1]}..${custom[2]}`, start, end };
    }
  }

  return lastDaysRange(30, now);
}

function lastDaysRange(days: number, now: number): DateRange {
  const endDay = Date.parse(dayKey(now) + "T00:00:00.000Z") + DAY_MS;
  const start = endDay - days * DAY_MS;
  return { label: `last ${days}d`, start, end: endDay };
}

export async function loadCache(cachePath: string): Promise<StatsCache> {
  try {
    const raw = await readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw) as StatsCache;
    if (parsed.version === 1 && parsed.files && typeof parsed.files === "object") return parsed;
  } catch {
    // no cache yet
  }
  return { version: 1, files: {} };
}

export async function saveCache(cachePath: string, cache: StatsCache): Promise<void> {
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(cache, null, 2), "utf8");
}

export async function refreshCache(sessionDir: string, cachePath: string): Promise<RefreshResult> {
  const cache = await loadCache(cachePath);
  const files = await listSessionFiles(sessionDir);
  const nextFiles: Record<string, CachedFile> = {};
  const errors: RefreshResult["errors"] = [];
  let parsedFiles = 0;
  let reusedFiles = 0;

  for (const file of files) {
    try {
      const s = await stat(file);
      const cached = cache.files[file];
      if (cached && cached.mtimeMs === s.mtimeMs && cached.size === s.size) {
        nextFiles[file] = cached;
        reusedFiles++;
        continue;
      }
      nextFiles[file] = { path: file, mtimeMs: s.mtimeMs, size: s.size, parsedAt: Date.now(), session: await parseSessionFile(file) };
      parsedFiles++;
    } catch (error) {
      errors.push({ path: file, message: error instanceof Error ? error.message : String(error) });
    }
  }

  const nextCache: StatsCache = { version: 1, files: nextFiles };
  await saveCache(cachePath, nextCache);
  return { cache: nextCache, totalFiles: files.length, parsedFiles, reusedFiles, errors };
}

export async function listSessionFiles(sessionDir: string): Promise<string[]> {
  const root = resolve(sessionDir);
  const out: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) await walk(p);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) out.push(p);
    }
  }

  await walk(root);
  return out.sort();
}

export async function parseSessionFile(file: string): Promise<SessionSummary> {
  const raw = await readFile(file, "utf8");
  return parseSessionText(raw, file);
}

export function parseSessionText(raw: string, file = "session.jsonl"): SessionSummary {
  let sessionId = basename(file, ".jsonl");
  let cwd = "unknown";
  let startedAt = 0;
  let sessionName = "";
  let firstUser = "";
  const events: UsageEvent[] = [];

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.type === "session") {
      sessionId = String(entry.id || sessionId);
      cwd = typeof entry.cwd === "string" && entry.cwd ? entry.cwd : cwd;
      const headerTs = Date.parse(entry.timestamp || "");
      if (Number.isFinite(headerTs)) startedAt = headerTs;
      continue;
    }

    if (entry.type === "session_info" && typeof entry.name === "string") {
      sessionName = entry.name;
      continue;
    }

    if (entry.type !== "message" || !entry.message) continue;
    const message = entry.message;

    if (message.role === "user" && !firstUser) {
      firstUser = contentPreview(message.content);
      continue;
    }

    if (message.role !== "assistant" || !message.usage) continue;

    const usage = message.usage;
    const timestamp = (normalizeTimestamp(message.timestamp) ?? normalizeTimestamp(entry.timestamp) ?? startedAt) || 0;
    const input = number(usage.input);
    const output = number(usage.output);
    const cacheRead = number(usage.cacheRead);
    const cacheWrite = number(usage.cacheWrite);
    const totalTokens = number(usage.totalTokens) || input + output + cacheRead + cacheWrite;
    const cost = number(usage.cost?.total);
    const project = projectLabel(cwd);

    events.push({
      timestamp,
      day: dayKey(timestamp),
      provider: String(message.provider || "unknown"),
      model: String(message.model || "unknown"),
      input,
      output,
      cacheRead,
      cacheWrite,
      totalTokens,
      freshTokens: input + output + cacheWrite,
      cost,
      messages: 1,
      sessionPath: file,
      sessionId,
      sessionName: "",
      cwd,
      project,
    });
  }

  const name = sessionName || firstUser || basename(file, ".jsonl");
  for (const event of events) event.sessionName = name;
  if (!startedAt && events.length) startedAt = events[0]!.timestamp;
  return { sessionPath: file, sessionId, sessionName: name, cwd, project: projectLabel(cwd), startedAt, events };
}

export function aggregate(cache: StatsCache, range: DateRange): AggregatedStats {
  const totals = emptyTotals();
  const daily = new Map<string, UsageTotals>();
  const models = new Map<string, Bucket>();
  const projects = new Map<string, Bucket>();
  const sessions = new Map<string, Bucket>();
  const seenEvents = new Set<string>();

  for (const file of Object.values(cache.files)) {
    for (const event of file.session.events) {
      if (!inRange(event.timestamp, range)) continue;
      const fingerprint = `${event.timestamp}|${event.provider}|${event.model}|${event.totalTokens}|${event.cost.toFixed(8)}`;
      if (seenEvents.has(fingerprint)) continue;
      seenEvents.add(fingerprint);

      addTotals(totals, event);
      addTotals(getTotals(daily, event.day), event);

      addBucket(models, `${event.provider}/${event.model}`, event.model, event, { provider: event.provider });
      addBucket(projects, event.cwd, event.project, event, { cwd: event.cwd });
      addBucket(sessions, event.sessionPath, event.sessionName, event, {
        project: event.project,
        cwd: event.cwd,
        startedAt: event.timestamp,
        path: event.sessionPath,
      });
    }
  }

  const sortBuckets = (items: Bucket[]) => items.sort((a, b) => b.cost - a.cost || b.totalTokens - a.totalTokens || a.label.localeCompare(b.label));

  return {
    range,
    totals,
    activeDays: [...daily.values()].filter((d) => d.totalTokens > 0).length,
    sessionCount: new Set([...sessions.values()].flatMap((b) => [...b.sessions])).size,
    projectCount: projects.size,
    daily,
    models: sortBuckets([...models.values()]),
    projects: sortBuckets([...projects.values()]),
    sessions: sortBuckets([...sessions.values()]),
    eventCount: seenEvents.size,
  };
}

export function projectLabel(cwd: string): string {
  if (!cwd || cwd === "unknown") return "unknown";
  return basename(cwd) || cwd;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${trim(n / 1_000_000)}M`;
  if (n >= 1_000) return `${trim(n / 1_000)}k`;
  return String(Math.round(n));
}

export function formatCost(n: number): string {
  if (!n) return "$0";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 10) return `$${n.toFixed(2)}`;
  return `$${Math.round(n)}`;
}

function trim(n: number): string {
  return n >= 10 ? n.toFixed(0) : n.toFixed(1).replace(/\.0$/, "");
}

function inRange(timestamp: number, range: DateRange): boolean {
  if (range.start !== undefined && timestamp < range.start) return false;
  if (range.end !== undefined && timestamp >= range.end) return false;
  return true;
}

function getTotals(map: Map<string, UsageTotals>, key: string): UsageTotals {
  let totals = map.get(key);
  if (!totals) {
    totals = emptyTotals();
    map.set(key, totals);
  }
  return totals;
}

function addBucket(map: Map<string, Bucket>, key: string, label: string, event: UsageEvent, meta: Record<string, string | number>): void {
  let bucket = map.get(key);
  if (!bucket) {
    bucket = { key, label, sessions: new Set(), projects: new Set(), meta, ...emptyTotals() };
    map.set(key, bucket);
  }
  addTotals(bucket, event);
  bucket.sessions.add(event.sessionId);
  bucket.projects.add(event.cwd);
  if (typeof meta.startedAt === "number") bucket.meta = { ...bucket.meta, startedAt: Math.min(number(bucket.meta?.startedAt) || meta.startedAt, meta.startedAt) };
}

function normalizeTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function contentPreview(content: unknown): string {
  if (typeof content === "string") return clean(content);
  if (Array.isArray(content)) {
    const text = content
      .map((block) => (block && typeof block === "object" && "text" in block ? String((block as { text: unknown }).text) : ""))
      .join(" ");
    return clean(text);
  }
  return "";
}

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 80);
}
