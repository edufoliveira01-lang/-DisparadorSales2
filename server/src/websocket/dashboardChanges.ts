import type { RequestHandler } from "express";
import { emitEvent } from "./index";

const RECURSOS = /^\/(contacts|logs|pending-replies|pericias-agendadas|settings|trello|backup)(\/|$)/;

export const notifyDashboardChanges: RequestHandler = (req, res, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method) && RECURSOS.test(req.path)) {
    res.on("finish", () => {
      if (res.statusCode >= 200 && res.statusCode < 300) emitEvent("dashboard:changed", {});
    });
  }
  next();
};
