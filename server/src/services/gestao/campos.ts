import { db } from "../../db";
import { ErroGestao } from "./erro";
import { cifrar, decifrar } from "./segredos";
import { dataValida, emailValido, soDigitos } from "./validacao";

export const ENTIDADES = ["pessoa", "processo"] as const;
export type Entidade = typeof ENTIDADES[number];
export const TIPOS_CAMPO: Record<string, string> = {
  texto: "Texto curto", texto_longo: "Texto longo", numero: "Número", moeda: "Valor em reais", data: "Data", sim_nao: "Sim ou não",
  lista: "Lista de opções", senha: "Senha (guardada com criptografia)", link: "Link (site)", telefone: "Telefone", email: "E-mail",
};
const txt = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

export interface Campo { id: number; entidade: Entidade; nome: string; tipo: string; opcoes: string[]; grupo: string; ordem: number; ativo: boolean; imprimir: boolean }
type Linha = Omit<Campo, "opcoes" | "ativo" | "imprimir"> & { opcoes_json: string; ativo: number; imprimir: number };
const visao = (l: Linha): Campo => ({ id: l.id, entidade: l.entidade, nome: l.nome, tipo: l.tipo, opcoes: JSON.parse(l.opcoes_json || "[]"), grupo: l.grupo, ordem: l.ordem, ativo: Boolean(l.ativo), imprimir: Boolean(l.imprimir) });
const conferirEntidade = (e: unknown): Entidade => { if (!ENTIDADES.includes(e as Entidade)) throw new ErroGestao("Tipo de cadastro inválido."); return e as Entidade; };

export function listarCampos(entidade: unknown, incluirInativos = false): Campo[] {
  const e = conferirEntidade(entidade);
  return (db.prepare(`SELECT * FROM gestao_campos WHERE entidade=? ${incluirInativos ? "" : "AND ativo=1"} ORDER BY grupo COLLATE NOCASE, ordem, id`).all(e) as Linha[]).map(visao);
}

function limparOpcoes(tipo: string, v: unknown): string[] {
  if (tipo !== "lista") return [];
  const lista = (Array.isArray(v) ? v : String(v ?? "").split(/[\n;]/)).map((o) => txt(o, 80)).filter(Boolean);
  const unicas = [...new Set(lista)];
  if (unicas.length < 2) throw new ErroGestao("Informe pelo menos duas opções para a lista.");
  if (unicas.length > 50) throw new ErroGestao("A lista pode ter no máximo 50 opções.");
  return unicas;
}

export function criarCampo(d: Record<string, unknown>): Campo {
  const entidade = conferirEntidade(d.entidade);
  const nome = txt(d.nome, 60);
  if (nome.length < 2) throw new ErroGestao("Dê um nome ao campo.");
  const tipo = String(d.tipo);
  if (!TIPOS_CAMPO[tipo]) throw new ErroGestao("Tipo de campo inválido.");
  if (db.prepare("SELECT id FROM gestao_campos WHERE entidade=? AND nome=? COLLATE NOCASE").get(entidade, nome)) throw new ErroGestao("Já existe um campo com esse nome.", 409);
  const ordem = (db.prepare("SELECT COALESCE(MAX(ordem),0)+1 n FROM gestao_campos WHERE entidade=?").get(entidade) as { n: number }).n;
  const r = db.prepare("INSERT INTO gestao_campos(entidade,nome,tipo,opcoes_json,grupo,ordem,imprimir) VALUES (?,?,?,?,?,?,?)")
    .run(entidade, nome, tipo, JSON.stringify(limparOpcoes(tipo, d.opcoes)), txt(d.grupo, 60), ordem, d.imprimir === false ? 0 : 1);
  return obterCampo(Number(r.lastInsertRowid));
}
export function obterCampo(id: number): Campo {
  const l = db.prepare("SELECT * FROM gestao_campos WHERE id=?").get(id) as Linha | undefined;
  if (!l) throw new ErroGestao("Campo não encontrado.", 404);
  return visao(l);
}
/** O tipo não muda depois de criado (os valores guardados dependem dele); o resto pode ser ajustado. */
export function atualizarCampo(id: number, d: Record<string, unknown>): Campo {
  const atual = obterCampo(id);
  const nome = txt(d.nome ?? atual.nome, 60);
  if (nome.length < 2) throw new ErroGestao("Dê um nome ao campo.");
  if (db.prepare("SELECT id FROM gestao_campos WHERE entidade=? AND nome=? COLLATE NOCASE AND id<>?").get(atual.entidade, nome, id)) throw new ErroGestao("Já existe um campo com esse nome.", 409);
  const opcoes = atual.tipo === "lista" ? limparOpcoes("lista", d.opcoes ?? atual.opcoes) : [];
  db.prepare("UPDATE gestao_campos SET nome=?,opcoes_json=?,grupo=?,ordem=?,ativo=?,imprimir=? WHERE id=?")
    .run(nome, JSON.stringify(opcoes), txt(d.grupo ?? atual.grupo, 60), Number.isInteger(d.ordem) ? Number(d.ordem) : atual.ordem, d.ativo === undefined ? (atual.ativo ? 1 : 0) : d.ativo ? 1 : 0, d.imprimir === undefined ? (atual.imprimir ? 1 : 0) : d.imprimir ? 1 : 0, id);
  return obterCampo(id);
}
export function excluirCampo(id: number) {
  obterCampo(id);
  db.prepare("DELETE FROM gestao_campos WHERE id=?").run(id); // os valores saem junto (ON DELETE CASCADE)
  return { ok: true };
}

/** Campos da ficha previdenciária (modelo "Ficha processual"): só acrescenta os que ainda não existem. */
export function adicionarCamposPrevidenciarios() {
  const grupo = "Dados previdenciários";
  const base: [string, string][] = [["Serviço", "texto"], ["Indicação (IND)", "texto"], ["Seguridade até", "data"], ["Última contribuição", "data"], ["Vínculo empregatício", "texto"], ["CNPJ do empregador", "texto"], ["UDT", "texto"], ["Tel./e-mail do empregador", "texto"], ["Meu INSS (senha)", "senha"]];
  let criados = 0;
  for (const [nome, tipo] of base) {
    if (db.prepare("SELECT id FROM gestao_campos WHERE entidade='pessoa' AND nome=? COLLATE NOCASE").get(nome)) continue;
    criarCampo({ entidade: "pessoa", nome, tipo, grupo }); criados++;
  }
  return { criados };
}

// ---------- valores ----------
export interface ValorCampo extends Campo { valor: string; preenchido: boolean }

/** Senhas nunca saem na leitura comum: só `preenchido`. A revelação é um pedido próprio (e auditado). */
export function valoresDe(entidade: Entidade, entidadeId: number): ValorCampo[] {
  const salvos = new Map((db.prepare("SELECT campo_id,valor FROM gestao_campos_valores WHERE entidade_id=? AND campo_id IN (SELECT id FROM gestao_campos WHERE entidade=?)").all(entidadeId, entidade) as { campo_id: number; valor: string }[]).map((v) => [v.campo_id, v.valor]));
  return listarCampos(entidade).map((c) => {
    const bruto = salvos.get(c.id) ?? "";
    return { ...c, valor: c.tipo === "senha" ? "" : bruto, preenchido: bruto !== "" };
  });
}

function normalizar(c: Campo, bruto: unknown): string {
  const v = typeof bruto === "string" ? bruto.trim() : bruto == null ? "" : String(bruto).trim();
  if (v === "") return "";
  const rotulo = c.nome;
  switch (c.tipo) {
    case "texto": return v.slice(0, 500);
    case "texto_longo": return v.slice(0, 4000);
    case "numero": { const n = Number(v.replace(",", ".")); if (!Number.isFinite(n) || Math.abs(n) > 1e15) throw new ErroGestao(`${rotulo}: informe um número válido.`); return String(n); }
    case "moeda": { const n = Number(v.replace(/[R$\s]/g, "").replace(/\./g, "").replace(",", ".")); if (!Number.isFinite(n) || n < 0 || n > 1e12) throw new ErroGestao(`${rotulo}: informe um valor válido.`); return n.toFixed(2); }
    case "data": if (!dataValida(v)) throw new ErroGestao(`${rotulo}: data inválida (use AAAA-MM-DD).`); return v;
    case "sim_nao": if (v !== "sim" && v !== "nao") throw new ErroGestao(`${rotulo}: escolha sim ou não.`); return v;
    case "lista": if (!c.opcoes.includes(v)) throw new ErroGestao(`${rotulo}: escolha uma das opções da lista.`); return v;
    case "link": { let u: URL; try { u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`); } catch { throw new ErroGestao(`${rotulo}: link inválido.`); } if (!["http:", "https:"].includes(u.protocol)) throw new ErroGestao(`${rotulo}: só links http ou https.`); return u.toString().slice(0, 500); }
    case "telefone": { const d = soDigitos(v); if (d.length < 8 || d.length > 15) throw new ErroGestao(`${rotulo}: telefone inválido.`); return v.slice(0, 30); }
    case "email": { const e = v.toLowerCase(); if (!emailValido(e)) throw new ErroGestao(`${rotulo}: e-mail inválido.`); return e.slice(0, 254); }
    case "senha": return cifrar(v.slice(0, 200));
    default: return v;
  }
}

/** Grava só os campos informados em `valores` ({ "<id do campo>": valor }); "" limpa o campo. */
export function salvarValores(entidade: Entidade, entidadeId: number, valores: unknown) {
  if (valores === undefined || valores === null) return;
  if (typeof valores !== "object" || Array.isArray(valores)) throw new ErroGestao("Campos personalizados inválidos.");
  const campos = new Map(listarCampos(entidade).map((c) => [c.id, c]));
  const preparados: [number, string][] = [];
  for (const [chave, bruto] of Object.entries(valores as Record<string, unknown>)) {
    const c = campos.get(Number(chave));
    if (!c) continue; // campo apagado ou inativo: ignora
    preparados.push([c.id, normalizar(c, bruto)]);
  }
  db.transaction(() => {
    for (const [campoId, valor] of preparados) {
      if (valor === "") db.prepare("DELETE FROM gestao_campos_valores WHERE campo_id=? AND entidade_id=?").run(campoId, entidadeId);
      else db.prepare("INSERT INTO gestao_campos_valores(campo_id,entidade_id,valor) VALUES (?,?,?) ON CONFLICT(campo_id,entidade_id) DO UPDATE SET valor=excluded.valor,atualizado_em=CURRENT_TIMESTAMP").run(campoId, entidadeId, valor);
    }
  })();
}

export function revelarSenha(campoId: number, entidadeId: number): string {
  const c = obterCampo(campoId);
  if (c.tipo !== "senha") throw new ErroGestao("Este campo não é uma senha.", 400);
  const v = db.prepare("SELECT valor FROM gestao_campos_valores WHERE campo_id=? AND entidade_id=?").get(campoId, entidadeId) as { valor: string } | undefined;
  if (!v) throw new ErroGestao("Senha não cadastrada.", 404);
  return decifrar(v.valor);
}

/** Valores em texto para a ficha impressa (senha só quando pedido). */
export function valoresParaImpressao(entidade: Entidade, entidadeId: number, comSenhas: boolean) {
  const salvos = new Map((db.prepare("SELECT campo_id,valor FROM gestao_campos_valores WHERE entidade_id=?").all(entidadeId) as { campo_id: number; valor: string }[]).map((v) => [v.campo_id, v.valor]));
  return listarCampos(entidade).filter((c) => c.imprimir).map((c) => {
    const bruto = salvos.get(c.id) ?? "";
    let valor = bruto;
    if (c.tipo === "senha") valor = bruto ? (comSenhas ? decifrar(bruto) : "••••••••") : "";
    else if (c.tipo === "sim_nao") valor = bruto === "sim" ? "Sim" : bruto === "nao" ? "Não" : "";
    else if (c.tipo === "data" && bruto) valor = bruto.split("-").reverse().join("/");
    else if (c.tipo === "moeda" && bruto) valor = Number(bruto).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    return { campo: c, valor };
  });
}
