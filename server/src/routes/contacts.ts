import { Router } from "express";
import { createContact, deleteContact, deleteContacts, getContact, listContacts, updateContact } from "../services/contactsService";
import { parseImportContent } from "../services/contactImportService";
import { agendarReconciliacao } from "../services/gestao/contatosEspelho";
import { matchContact } from "../services/matcherService";

export const contactsRouter = Router();
contactsRouter.use((req, res, next) => { res.on("finish", () => { if (req.method !== "GET" && res.statusCode < 400) agendarReconciliacao(); }); next(); });

contactsRouter.get("/", (_req, res) => {
  res.json(listContacts());
});

contactsRouter.post("/", (req, res) => {
  const { nome, telefone, processo, observacoes } = req.body as {
    nome?: string;
    telefone?: string;
    processo?: string;
    observacoes?: string;
  };
  if (!nome?.trim() || !telefone?.trim()) {
    return res.status(400).json({ error: "Nome e telefone são obrigatórios." });
  }
  res.status(201).json(createContact(nome, telefone, observacoes, processo));
});

contactsRouter.put("/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = getContact(id);
  if (!existing) return res.status(404).json({ error: "Contato não encontrado." });

  const { nome, telefone, processo, observacoes } = req.body as {
    nome?: string;
    telefone?: string;
    processo?: string;
    observacoes?: string;
  };
  if (!nome?.trim() || !telefone?.trim()) {
    return res.status(400).json({ error: "Nome e telefone são obrigatórios." });
  }
  res.json(updateContact(id, nome, telefone, observacoes, processo));
});

contactsRouter.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!getContact(id)) return res.status(404).json({ error: "Contato não encontrado." });
  deleteContact(id);
  res.status(204).send();
});

contactsRouter.post("/apagar-em-massa", (req, res) => {
  const { ids } = req.body as { ids?: number[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "Nenhum contato selecionado." });
  }

  const apagados = deleteContacts(ids.filter((id) => Number.isInteger(id)));
  res.json({ ok: true, apagados });
});

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// Contraparte do "Importar CSV/vCard": exporta no mesmo formato de CSV que o import reconhece
// (headers "nome"/"telefone"/"processo"/"observacoes"), então o arquivo serve tanto como backup quanto
// como forma de levar os contatos para outra instalação.
contactsRouter.get("/export", (_req, res) => {
  const contatos = listContacts();
  const linhas = [
    "nome,telefone,processo,observacoes",
    ...contatos.map((c) => [c.nome, c.telefone, c.processo || "", c.observacoes || ""].map(csvEscape).join(",")),
  ];
  // BOM no início: sem isso, o Excel abre acentos/caracteres especiais corrompidos em CSV UTF-8.
  const csv = "﻿" + linhas.join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="contatos-disparazap.csv"');
  res.send(csv);
});

contactsRouter.get("/match/:nome", (req, res) => {
  const contacts = listContacts();
  res.json(matchContact(req.params.nome, contacts, typeof req.query.processo === "string" ? req.query.processo : ""));
});

function apenasDigitos(value: string): string {
  return value.replace(/\D/g, "");
}

contactsRouter.post("/import", (req, res) => {
  const { content } = req.body as { content?: string };
  if (!content?.trim()) {
    return res.status(400).json({ error: "Arquivo vazio ou em formato não reconhecido." });
  }

  let importados: ReturnType<typeof parseImportContent>;
  try {
    importados = parseImportContent(content);
  } catch {
    return res.status(400).json({ error: "Não foi possível ler o arquivo. Confira se é um CSV ou vCard (.vcf) válido." });
  }

  if (importados.length === 0) {
    return res.status(400).json({
      error: "Nenhum contato com nome e telefone foi encontrado nesse arquivo.",
    });
  }

  const existentes = new Set(listContacts().map((c) => apenasDigitos(c.telefone)));
  let criados = 0;
  let ignorados = 0;

  for (const contato of importados) {
    const telefoneDigits = apenasDigitos(contato.telefone);
    if (!telefoneDigits || existentes.has(telefoneDigits)) {
      ignorados++;
      continue;
    }
    createContact(contato.nome, contato.telefone, contato.observacoes, contato.processo);
    existentes.add(telefoneDigits);
    criados++;
  }

  res.json({ ok: true, total: importados.length, criados, ignorados });
});
