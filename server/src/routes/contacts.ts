import { Router } from "express";
import { createContact, deleteContact, getContact, listContacts, updateContact } from "../services/contactsService";
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
