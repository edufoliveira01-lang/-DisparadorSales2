import { Router } from "express";
import { listPericiasAgendadas } from "../services/periciasAgendadasService";

export const periciasAgendadasRouter = Router();

// Sem filtros de mês/ano aqui de propósito: a retenção de 3 meses (ver podarPericiasAgendadasAntigas
// em index.ts) já limita o volume, e agrupar por dia/mês fica mais simples no fuso do navegador do
// usuário (America/Sao_Paulo) do que recalculando limites de mês em UTC no servidor.
periciasAgendadasRouter.get("/", (_req, res) => {
  res.json(listPericiasAgendadas());
});
