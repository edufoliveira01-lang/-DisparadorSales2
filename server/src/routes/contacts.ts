import { Router } from "express";
import { createContact, deleteContact, getContact, listContacts, updateContact } from "../services/contactsService";
import { parseImportContent } from "../services/contactImportService";
import { matchContact } from "../services/matcherService";

export const contactsRouter = Router();

contactsRouter.get("/", (_req, res) => {
  res.json(listContacts());
});

contactsRouter.post("/", (req, res) => {
  const { nome, telefone, observacoes } = req.body as { nome?: string; telefone?: string; observacoes?: string };
  if (!nome?.trim() || !telefone?.trim()) {
    return res.status(400).json({ error: "Nome e telefone são obrigatórios." });
  }
  res.status(201).json(createContact(nome, telefone, observacoes));
});

contactsRouter.put("/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = getContact(id);
  if (!existing) return res.status(404).json({ error: "Contato não encontrado." });

  const { nome, telefone, observacoes } = req.body as { nome?: string; telefone?: string; observacoes?: string };
  if (!nome?.trim() || !telefone?.trim()) {
    return res.status(400).json({ error: "Nome e telefone são obrigatórios." });
  }
  res.json(updateContact(id, nome, telefone, observacoes));
});

contactsRouter.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!getContact(id)) return res.status(404).json({ error: "Contato não encontrado." });
  deleteContact(id);
  res.status(204).send();
});

contactsRouter.get("/match/:nome", (req, res) => {
  const contacts = listContacts();
  res.json(matchContact(req.params.nome, contacts));
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
    createContact(contato.nome, contato.telefone, contato.observacoes);
    existentes.add(telefoneDigits);
    criados++;
  }

  res.json({ ok: true, total: importados.length, criados, ignorados });
});
