import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { launchdHeartbeatRoutes } from "../routes/launchd-heartbeats.js";
import { LaunchdHeartbeatAggregator } from "../services/launchd-heartbeats.js";

function payload(overrides: Record<string, unknown> = {}) {
  return {
    agent_id: "com.aisarva.investments-hermes",
    use_case: "investments",
    status: "running",
    last_action: "scanned 24 tickers",
    last_action_ts: "2026-05-17T08:30:00-05:00",
    queue_depth: 3,
    spend_today_usd: 0,
    spend_today_calls: { cc: 142, codex: 87, gemini: 23 },
    error_log_size_mb: 12.3,
    ...overrides,
  };
}

async function tempStorePath() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-heartbeats-"));
  return path.join(dir, "heartbeats.jsonl");
}

function createApp(aggregator: LaunchdHeartbeatAggregator) {
  const app = express();
  app.use(express.json());
  app.use("/heartbeat", launchdHeartbeatRoutes(aggregator));
  return app;
}

describe("launchd heartbeat routes", () => {
  it("records heartbeats and exposes aggregated status", async () => {
    const storePath = await tempStorePath();
    const aggregator = new LaunchdHeartbeatAggregator({
      storePath,
      now: () => new Date("2026-05-17T13:30:00.000Z"),
    });

    const post = await request(createApp(aggregator)).post("/heartbeat").send(payload());

    expect(post.status).toBe(202);
    expect(post.body.last_payload.agent_id).toBe("com.aisarva.investments-hermes");
    expect(post.body.last_payload.status).toBe("running");

    const status = await request(createApp(aggregator)).get("/heartbeat/status");

    expect(status.status).toBe(200);
    expect(status.body.heartbeats["com.aisarva.investments-hermes"]).toMatchObject({
      last_seen: "2026-05-17T13:30:00.000Z",
      stale: false,
      last_payload: {
        agent_id: "com.aisarva.investments-hermes",
        status: "running",
      },
    });

    const persisted = await fs.readFile(storePath, "utf-8");
    expect(persisted).toContain("com.aisarva.investments-hermes");
  });

  it("marks agents crashed when the last heartbeat is older than five minutes", async () => {
    let now = new Date("2026-05-17T13:30:00.000Z");
    const aggregator = new LaunchdHeartbeatAggregator({
      storePath: await tempStorePath(),
      now: () => now,
    });
    await aggregator.record(payload({ status: "running" }));

    now = new Date("2026-05-17T13:35:01.000Z");
    const status = await aggregator.status();

    expect(status.heartbeats["com.aisarva.investments-hermes"]).toMatchObject({
      stale: true,
      last_payload: {
        status: "crashed",
      },
    });
  });

  it("hydrates the latest known heartbeat from jsonl on restart", async () => {
    const storePath = await tempStorePath();
    const first = new LaunchdHeartbeatAggregator({
      storePath,
      now: () => new Date("2026-05-17T13:30:00.000Z"),
    });
    await first.record(payload({ queue_depth: 1 }));
    await first.record(payload({ queue_depth: 4 }));

    const reloaded = new LaunchdHeartbeatAggregator({
      storePath,
      now: () => new Date("2026-05-17T13:31:00.000Z"),
    });

    await expect(reloaded.status()).resolves.toMatchObject({
      heartbeats: {
        "com.aisarva.investments-hermes": {
          last_payload: {
            queue_depth: 4,
          },
        },
      },
    });
  });

  it("rejects malformed heartbeat payloads", async () => {
    const res = await request(
      createApp(new LaunchdHeartbeatAggregator({ storePath: await tempStorePath() })),
    )
      .post("/heartbeat")
      .send({ status: "running" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("agent_id");
  });
});
