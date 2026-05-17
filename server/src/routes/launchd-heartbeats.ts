import { Router } from "express";
import {
  InvalidLaunchdHeartbeatError,
  launchdHeartbeatAggregator,
  type LaunchdHeartbeatAggregator,
} from "../services/launchd-heartbeats.js";

export function launchdHeartbeatRoutes(
  aggregator: LaunchdHeartbeatAggregator = launchdHeartbeatAggregator,
) {
  const router = Router();

  router.post("/", async (req, res, next) => {
    try {
      const record = await aggregator.record(req.body);
      res.status(202).json(record);
    } catch (error) {
      if (error instanceof InvalidLaunchdHeartbeatError) {
        res.status(400).json({ error: error.message });
        return;
      }
      next(error);
    }
  });

  router.get("/status", async (_req, res, next) => {
    try {
      res.json(await aggregator.status());
    } catch (error) {
      next(error);
    }
  });

  return router;
}
