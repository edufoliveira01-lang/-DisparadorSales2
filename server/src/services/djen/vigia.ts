import { reativarProcessoExcluido } from "./semVinculo";
/**
 * Acompanhamento automático de um processo cadastrado na Gestão.
 *
 * Quem cadastra um processo com número CNJ não precisa fazer mais nada: ele entra na fila de consulta do DJEN por número
 * (histórico desde o ano em que foi distribuído), as publicações entram sozinhas, os dados em branco da ficha (tribunal, órgão, classe)
 * são preenchidos com o que o DJEN informa, e a consulta se repete enquanto o processo estiver ativo.
 */
import { db } from "../../db";
import { tribunalDoCnj } from "../gestao/validacao";
import { hojeDjen } from "./api";
import { datajudEmDia, atualizarDoDataJud, situacaoDoDataJud } from "./datajud";
import { invalidarHistorico, solicitarHistorico } from "./historyCoverage";

const CNJ = /^\d{20}$/;
/** O DJEN nacional não tem publicações de antes disso; começar mais cedo só gastaria consultas. */
const PRIMEIRO_ANO = 2021;

export const numeroAcompanhavel = (chave: string) => CNJ.test(chave);

/** Dia (YYYY-MM-DD) em que a consulta histórica começa: 1º de janeiro do ano do processo (campo AAAA do número CNJ). */
export function inicioDoAcompanhamento(chave: string, hoje = hojeDjen()): string | null {
  if (!CNJ.test(chave)) return null;
  const ano = Number(chave.slice(9, 13));
  if (!Number.isInteger(ano) || ano < 1990 || ano > Number(hoje.slice(0, 4))) return null;
  const inicio = `${Math.max(ano, PRIMEIRO_ANO)}-01-01`;
  return inicio <= hoje ? inicio : null;
}

/** O processo é de uma ficha de gestão ativa? Só esses são consultados de novo de tempos em tempos. */
export function emAcompanhamento(chave: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM gestao_processos WHERE (chave=? OR djen_chave=?) AND status='ativo' LIMIT 1").get(chave, chave));
}

/** Coloca o processo na fila do DJEN. Repetir não duplica. Devolve false quando o número não é CNJ (não dá para consultar). */
export function iniciarAcompanhamento(chave: string, numero = chave): boolean {
  if (!CNJ.test(chave)) return false;
  reativarProcessoExcluido(chave);
  db.transaction(() => {
    db.prepare("INSERT OR IGNORE INTO djen_processos(chave,numero) VALUES (?,?)").run(chave, numero);
    db.prepare("UPDATE gestao_processos SET djen_chave=? WHERE chave=? AND (djen_chave IS NULL OR djen_chave='')").run(chave, chave);
    solicitarHistorico(chave);
  })();
  return true;
}

/** Excluiu a ficha: o que o acompanhamento automático criou e ficou sem uso (nenhuma publicação, perícia, quadro ou outra ficha) vai embora junto. */
export function limparAcompanhamentoSemUso(chaves: (string | null | undefined)[]): void {
  for (const chave of new Set(chaves.filter((c): c is string => Boolean(c) && CNJ.test(String(c))))) {
    const emUso = (sql: string, n = 1) => Boolean(db.prepare(sql).get(...Array<string>(n).fill(chave)));
    if (emUso("SELECT 1 FROM gestao_processos WHERE chave=? OR djen_chave=? LIMIT 1", 2)) continue;
    if (emUso("SELECT 1 FROM djen_publicacoes WHERE processo_chave=? LIMIT 1")) continue;
    if (emUso("SELECT 1 FROM pericias_agendadas WHERE processo_chave=? LIMIT 1")) continue;
    try { if (emUso("SELECT 1 FROM djen_kanban_cartoes WHERE processo_chave=? LIMIT 1")) continue; } catch { /* quadro ainda não existe */ }
    db.transaction(() => {
      db.prepare("DELETE FROM djen_historico_consultas WHERE processo_chave=?").run(chave);
      db.prepare("DELETE FROM gestao_datajud WHERE processo_chave=?").run(chave);
      db.prepare("DELETE FROM djen_processos WHERE chave=?").run(chave);
    })();
  }
}

/** Pede uma consulta nova agora, mesmo que a última ainda esteja dentro da validade. */
export function forcarConsulta(chave: string): boolean {
  if (!iniciarAcompanhamento(chave)) return false;
  invalidarHistorico(chave);
  return true;
}

/** Preenche o que está EM BRANCO na ficha com o que o DJEN informa (nunca troca o que alguém digitou). Devolve quais campos mudaram. */
export function preencherDoDjen(chave: string): string[] {
  const pub = db.prepare("SELECT tribunal,orgao,classe FROM djen_publicacoes WHERE processo_chave=? AND cancelada=0 ORDER BY data_disponibilizacao DESC,id DESC LIMIT 1").get(chave) as { tribunal: string | null; orgao: string | null; classe: string | null } | undefined;
  const fichas = db.prepare("SELECT id,tribunal,orgao,classe FROM gestao_processos WHERE chave=? OR djen_chave=?").all(chave, chave) as { id: number; tribunal: string; orgao: string; classe: string }[];
  const mudou = new Set<string>();
  for (const f of fichas) {
    const novo = { tribunal: f.tribunal || pub?.tribunal || tribunalDoCnj(chave) || "", orgao: f.orgao || pub?.orgao || "", classe: f.classe || pub?.classe || "" };
    for (const c of ["tribunal", "orgao", "classe"] as const) if (novo[c] !== f[c]) mudou.add(c);
    if (mudou.size) db.prepare("UPDATE gestao_processos SET tribunal=?,orgao=?,classe=?,atualizado_em=CURRENT_TIMESTAMP WHERE id=?").run(novo.tribunal, novo.orgao, novo.classe, f.id);
  }
  return [...mudou];
}

/** O que a ficha mostra sobre o acompanhamento. */
export function situacaoDoAcompanhamento(processoId: number) {
  const p = db.prepare("SELECT chave,djen_chave,status FROM gestao_processos WHERE id=?").get(processoId) as { chave: string; djen_chave: string | null; status: string } | undefined;
  if (!p) return null;
  const chave = CNJ.test(p.chave) ? p.chave : p.djen_chave && CNJ.test(p.djen_chave) ? p.djen_chave : "";
  if (!chave) return { acompanhavel: false as const, motivo: "O número não está no padrão CNJ (20 dígitos). Sem ele não dá para consultar o DJEN." };
  const h = db.prepare("SELECT status,consultado_em,erro,inicio,fim FROM djen_historico_consultas WHERE processo_chave=?").get(chave) as { status: string; consultado_em: string | null; erro: string | null; inicio: string | null; fim: string | null } | undefined;
  const n = db.prepare("SELECT COUNT(*) n, MAX(data_disponibilizacao) ultima FROM djen_publicacoes WHERE processo_chave=? AND cancelada=0").get(chave) as { n: number; ultima: string | null };
  return {
    acompanhavel: true as const, ativo: p.status === "ativo",
    situacao: (h?.status ?? "pendente") as "pendente" | "verificando" | "atualizado" | "falha",
    consultado_em: h?.consultado_em ?? null, desde: h?.inicio ?? inicioDoAcompanhamento(chave), erro: h?.status === "falha" ? h.erro : null,
    publicacoes: n.n, ultima_publicacao: n.ultima, datajud: situacaoDoDataJud(chave),
  };
}

/** Depois do DJEN, completa a ficha com o DataJud (se houver chave e a última consulta não estiver em dia). Nunca lança. */
export function completarComDataJud(chave: string, forcar = false): Promise<void> {
  if (!forcar && datajudEmDia(chave)) return Promise.resolve();
  return atualizarDoDataJud(chave).then(() => undefined).catch(() => undefined);
}
