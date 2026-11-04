import { db } from "../../db";
import { ErroGestao } from "./erro";

export interface Advogado { tratamento: string; nome: string; nacionalidade: string; estado_civil: string; oab: string; cpf: string }
export interface Testemunha { nome: string; cpf: string }
export type Alinha = "left" | "center" | "right";
export interface Escritorio {
  nome: string; razao_social: string; oab_sociedade: string; cnpj: string; endereco: string; cidade: string; uf: string; foro: string;
  telefones: string[]; email: string; rodape_linhas: string[]; advogados: Advogado[]; testemunhas: Testemunha[];
  /** Onde ficam o cabeçalho e o rodapé dos documentos: esquerda, centro ou direita. */
  cabecalho_alinhamento: Alinha; rodape_alinhamento: Alinha;
}
/** Sem nenhum dado de escritório embutido: cada instalação preenche o seu. */
export const ESCRITORIO_PADRAO: Escritorio = {
  nome: "", razao_social: "", oab_sociedade: "", cnpj: "", endereco: "", cidade: "", uf: "", foro: "", telefones: [], email: "", rodape_linhas: [], advogados: [], testemunhas: [], cabecalho_alinhamento: "center", rodape_alinhamento: "right",
};
const txt = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/\*\*/g, "").trim().slice(0, max);

const alinha = (v: unknown, padrao: Alinha): Alinha => (v === "left" || v === "center" || v === "right" ? v : padrao);
function normalizar(c: Partial<Escritorio>): Escritorio {
  const lista = <T>(v: unknown, max: number, f: (x: Record<string, unknown>) => T | null): T[] =>
    Array.isArray(v) ? v.slice(0, max).map((x) => (x && typeof x === "object" ? f(x as Record<string, unknown>) : null)).filter((x): x is T => x !== null) : [];
  return {
    nome: txt(c.nome, 120), razao_social: txt(c.razao_social, 160), oab_sociedade: txt(c.oab_sociedade, 40), cnpj: txt(c.cnpj, 25),
    endereco: txt(c.endereco, 220), cidade: txt(c.cidade, 80), uf: txt(c.uf, 2).toUpperCase(), foro: txt(c.foro, 120),
    telefones: (Array.isArray(c.telefones) ? c.telefones : []).map((t) => txt(t, 30)).filter(Boolean).slice(0, 6),
    email: txt(c.email, 120), rodape_linhas: (Array.isArray(c.rodape_linhas) ? c.rodape_linhas : []).map((t) => txt(t, 160)).filter(Boolean).slice(0, 3),
    advogados: lista(c.advogados, 12, (x) => {
      const nome = txt(x.nome, 120); if (!nome) return null;
      return { tratamento: txt(x.tratamento, 12) || "Dr.", nome, nacionalidade: txt(x.nacionalidade, 30), estado_civil: txt(x.estado_civil, 30), oab: txt(x.oab, 40), cpf: txt(x.cpf, 20) };
    }),
    cabecalho_alinhamento: alinha(c.cabecalho_alinhamento, "center"), rodape_alinhamento: alinha(c.rodape_alinhamento, "right"),
    testemunhas: lista(c.testemunhas, 4, (x) => { const nome = txt(x.nome, 120); return nome ? { nome, cpf: txt(x.cpf, 20) } : null; }),
  };
}
export function lerEscritorio(): Escritorio {
  const l = db.prepare("SELECT config_json FROM gestao_escritorio_config WHERE id=1").get() as { config_json: string } | undefined;
  let salvo: Partial<Escritorio> = {};
  try { salvo = l ? JSON.parse(l.config_json) : {}; } catch { /* config corrompida: volta ao padrão */ }
  return normalizar({ ...ESCRITORIO_PADRAO, ...salvo });
}
export function salvarEscritorio(d: unknown): Escritorio {
  if (!d || typeof d !== "object" || Array.isArray(d)) throw new ErroGestao("Dados inválidos.");
  const c = normalizar({ ...lerEscritorio(), ...(d as Partial<Escritorio>) });
  db.prepare("INSERT INTO gestao_escritorio_config(id,config_json) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET config_json=excluded.config_json,atualizado_em=CURRENT_TIMESTAMP").run(JSON.stringify(c));
  return c;
}
/** Nome para cabeçalhos: o do escritório, ou o que já estava na ficha de cadastro. */
export function nomeDoEscritorio(): string {
  return lerEscritorio().nome;
}
