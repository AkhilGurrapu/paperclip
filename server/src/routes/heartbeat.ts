import { Router, type RequestHandler } from "express";

export function heartbeatRoutes(now: () => Date = () => new Date()) {
  const router = Router();

  const heartbeat: RequestHandler = (_req, res) => {
    res.json({
      ok: true,
      service: "paperclip",
      pid: process.pid,
      uptime_s: process.uptime(),
      ts: now().toISOString(),
    });
  };

  router.get("/", heartbeat);
  router.post("/", heartbeat);

  return router;
}
