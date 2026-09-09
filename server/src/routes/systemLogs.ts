import { Router } from "express";
import { listSystemLogs } from "../services/systemLogsService";

export const systemLogsRouter = Router();

systemLogsRouter.get("/", (req, res) => {
  const limit = Number(req.query.limit) || 500;
  res.json(listSystemLogs(limit));
});
