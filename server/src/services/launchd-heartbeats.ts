import fs from "node:fs/promises";
import path from "node:path";
import { resolvePaperclipInstanceRoot } from "../home-paths.js";

export const LAUNCHD_HEARTBEAT_STALE_MS = 5 * 60 * 1000;

const VALID_STATUSES = new Set(["running", "idle", "blocked", "crashed"]);

export type LaunchdHeartbeatStatus = "running" | "idle" | "blocked" | "crashed";

export interface LaunchdHeartbeatPayload {
  agent_id: string;
  use_case: string;
  status: LaunchdHeartbeatStatus;
  last_action: string;
  last_action_ts: string;
  queue_depth: number;
  spend_today_usd: number;
  spend_today_calls: Record<string, number>;
  error_log_size_mb: number;
}

export interface LaunchdHeartbeatRecord {
  last_seen: string;
  last_payload: LaunchdHeartbeatPayload;
  stale: boolean;
}

export interface LaunchdHeartbeatStatusResponse {
  generated_at: string;
  stale_after_ms: number;
  heartbeats: Record<string, LaunchdHeartbeatRecord>;
}

export class InvalidLaunchdHeartbeatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidLaunchdHeartbeatError";
  }
}

function defaultStorePath(): string {
  return path.resolve(resolvePaperclipInstanceRoot(), "data", "heartbeats.jsonl");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(raw: Record<string, unknown>, key: string): string {
  const value = raw[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidLaunchdHeartbeatError(`${key} must be a non-empty string`);
  }
  return value;
}

function optionalNumber(raw: Record<string, unknown>, key: string, fallback: number): number {
  const value = raw[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new InvalidLaunchdHeartbeatError(`${key} must be a finite number`);
  }
  return value;
}

function optionalSpendCalls(raw: Record<string, unknown>): Record<string, number> {
  const value = raw.spend_today_calls;
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) {
    throw new InvalidLaunchdHeartbeatError("spend_today_calls must be an object");
  }

  const spendCalls: Record<string, number> = {};
  for (const [key, calls] of Object.entries(value)) {
    if (typeof calls !== "number" || !Number.isFinite(calls)) {
      throw new InvalidLaunchdHeartbeatError(`spend_today_calls.${key} must be a finite number`);
    }
    spendCalls[key] = calls;
  }
  return spendCalls;
}

export function normalizeLaunchdHeartbeatPayload(value: unknown): LaunchdHeartbeatPayload {
  if (!isRecord(value)) {
    throw new InvalidLaunchdHeartbeatError("heartbeat payload must be an object");
  }

  const status = requiredString(value, "status");
  if (!VALID_STATUSES.has(status)) {
    throw new InvalidLaunchdHeartbeatError("status must be running, idle, blocked, or crashed");
  }

  return {
    agent_id: requiredString(value, "agent_id"),
    use_case: requiredString(value, "use_case"),
    status: status as LaunchdHeartbeatStatus,
    last_action: requiredString(value, "last_action"),
    last_action_ts: requiredString(value, "last_action_ts"),
    queue_depth: optionalNumber(value, "queue_depth", 0),
    spend_today_usd: optionalNumber(value, "spend_today_usd", 0),
    spend_today_calls: optionalSpendCalls(value),
    error_log_size_mb: optionalNumber(value, "error_log_size_mb", 0),
  };
}

export class LaunchdHeartbeatAggregator {
  private readonly storePath: string;
  private readonly now: () => Date;
  private readonly records = new Map<
    string,
    { last_seen: string; last_payload: LaunchdHeartbeatPayload }
  >();
  private loaded = false;

  constructor(opts: { storePath?: string; now?: () => Date } = {}) {
    this.storePath = opts.storePath ?? defaultStorePath();
    this.now = opts.now ?? (() => new Date());
  }

  async record(value: unknown): Promise<LaunchdHeartbeatRecord> {
    await this.load();
    const payload = normalizeLaunchdHeartbeatPayload(value);
    const record = {
      last_seen: this.now().toISOString(),
      last_payload: payload,
    };
    this.records.set(payload.agent_id, record);
    await this.append(record);
    return this.snapshotRecord(record, this.now());
  }

  async status(): Promise<LaunchdHeartbeatStatusResponse> {
    await this.load();
    const generatedAt = this.now();
    const heartbeats: Record<string, LaunchdHeartbeatRecord> = {};
    for (const [agentId, record] of this.records.entries()) {
      heartbeats[agentId] = this.snapshotRecord(record, generatedAt);
    }
    return {
      generated_at: generatedAt.toISOString(),
      stale_after_ms: LAUNCHD_HEARTBEAT_STALE_MS,
      heartbeats,
    };
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    let raw = "";
    try {
      raw = await fs.readFile(this.storePath, "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return;
    }

    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as unknown;
        if (!isRecord(parsed)) continue;
        const payload = normalizeLaunchdHeartbeatPayload(parsed.last_payload);
        const lastSeen =
          typeof parsed.last_seen === "string" && parsed.last_seen.trim()
            ? parsed.last_seen
            : this.now().toISOString();
        this.records.set(payload.agent_id, { last_seen: lastSeen, last_payload: payload });
      } catch {
        continue;
      }
    }
  }

  private async append(record: {
    last_seen: string;
    last_payload: LaunchdHeartbeatPayload;
  }): Promise<void> {
    await fs.mkdir(path.dirname(this.storePath), { recursive: true });
    await fs.appendFile(this.storePath, `${JSON.stringify(record)}\n`, "utf-8");
  }

  private snapshotRecord(
    record: { last_seen: string; last_payload: LaunchdHeartbeatPayload },
    now: Date,
  ): LaunchdHeartbeatRecord {
    const ageMs = now.getTime() - new Date(record.last_seen).getTime();
    const stale = Number.isFinite(ageMs) && ageMs > LAUNCHD_HEARTBEAT_STALE_MS;
    return {
      last_seen: record.last_seen,
      stale,
      last_payload: stale ? { ...record.last_payload, status: "crashed" } : { ...record.last_payload },
    };
  }
}

export const launchdHeartbeatAggregator = new LaunchdHeartbeatAggregator();
