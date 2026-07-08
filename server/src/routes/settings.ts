import { Router } from "express";
import { getAllSettings, getSetting, setSetting } from "../services/settingsService";

export const settingsRouter = Router();

const DEFAULTS: Record<string, string> = {
  send_interval_min: "5",
  send_interval_max: "15",
};

settingsRouter.get("/", (_req, res) => {
  const settings = getAllSettings();
  res.json({ ...DEFAULTS, ...settings });
});

settingsRouter.put("/", (req, res) => {
  const body = req.body as Record<string, string>;
  const allowedKeys = [
    "trello_key",
    "trello_token",
    "trello_board_id",
    "trello_board_nome",
    "trello_list_id",
    "trello_list_nome",
    "send_interval_min",
    "send_interval_max",
    "template_ativo_id",
    "auto_sync_minutos",
    "trello_move_to_list_id",
  ];

  for (const key of allowedKeys) {
    if (typeof body[key] === "string") {
      setSetting(key, body[key]);
    }
  }

  res.json({ ok: true });
});

settingsRouter.get("/trello-status", (_req, res) => {
  const key = getSetting("trello_key");
  const token = getSetting("trello_token");
  res.json({ configurado: Boolean(key && token) });
});
