import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { heartbeatRoutes } from "../routes/heartbeat.js";

function createApp() {
  const app = express();
  app.use("/heartbeat", heartbeatRoutes(() => new Date("2026-05-17T15:42:00.000Z")));
  return app;
}

describe("GET /heartbeat", () => {
  it("returns a local launchd heartbeat response", async () => {
    const res = await request(createApp()).get("/heartbeat");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      service: "paperclip",
      pid: process.pid,
      uptime_s: expect.any(Number),
      ts: "2026-05-17T15:42:00.000Z",
    });
  });
});

describe("POST /heartbeat", () => {
  it("accepts launchd wrapper heartbeat posts without auth", async () => {
    const res = await request(createApp()).post("/heartbeat").send({ agent_id: "com.example.agent" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      service: "paperclip",
      pid: process.pid,
      ts: "2026-05-17T15:42:00.000Z",
    });
    expect(res.body.uptime_s).toEqual(expect.any(Number));
  });
});
