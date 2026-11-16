import { db } from "../../db";
import { hojeSaoPaulo } from "../djen/cache";
import { andamentoDaPublicacao, type TipoAndamento } from "../djen/andamentos";
import { moverCartaoKanban } from "../djen/kanban";
import { ErroGestao } from "./erro";

/**
 * A linha do tempo do processo em 9 FASES. A fonte é o quadro de etapas do DJEN (cada processo tem uma etapa atual e o histórico de quando entrou em cada uma):
 * aqui as etapas são agrupadas em fases maiores, legíveis num relance. Sem etapa definida, a fase é DEDUZIDA das publicações e das perícias.
 */
export interface Fase { chave: string; rotulo: string; codigos: string[]; explicacao: string; limite_dias: number }
export const FASES: Fase[] = [
  { chave: "triagem", rotulo: "Triagem", codigos: ["triagem"], limite_dias: 15, explicacao: "O escritório está conferindo os documentos e preparando o seu caso." },
  { chave: "peticao_inicial", rotulo: "Petição inicial", codigos: ["peticao_inicial", "emenda_inicial"], limite_dias: 30, explicacao: "A ação está sendo protocolada ou ajustada, se o juiz pediu complementos." },
  { chave: "citacao", rotulo: "Citação e contestação", codigos: ["citacao_contestacao"], limite_dias: 90, explicacao: "A outra parte (por exemplo, o INSS) é avisada do processo e apresenta a defesa dela." },
  { chave: "pericia", rotulo: "Perícia", codigos: ["perito_designado", "pericia_agendada", "pericia_realizada"], limite_dias: 90, explicacao: "O perito designado pelo juiz avalia o caso, nas ações de benefício por incapacidade, a sua condição de saúde e capacidade de trabalho." },
  { chave: "laudo_acordo", rotulo: "Laudo e acordo", codigos: ["laudo_manifestacoes", "proposta_acordo", "audiencia"], limite_dias: 60, explicacao: "O laudo é juntado e as partes se manifestam. Pode haver audiência ou proposta de acordo." },
  { chave: "sentenca", rotulo: "Sentença", codigos: ["conclusos_sentenca", "sentenca"], limite_dias: 120, explicacao: "O processo está com o juiz para decidir, ou já foi decidido em primeira instância." },
  { chave: "recurso", rotulo: "Recurso", codigos: ["recurso", "acordao", "transito_julgado"], limite_dias: 180, explicacao: "Alguma das partes recorreu, e o processo é julgado por um tribunal. Termina quando não cabe mais recurso (trânsito em julgado)." },
  { chave: "cumprimento", rotulo: "Cumprimento", codigos: ["cumprimento_sentenca", "aguarda_implantacao", "calculos", "penhora_bloqueio"], limite_dias: 90, explicacao: "A decisão favorável está sendo colocada em prática: implantação do benefício e cálculo dos valores devidos." },
  { chave: "pagamento", rotulo: "Pagamento e conclusão", codigos: ["aguarda_expedicao_rpv", "rpv_expedida", "pagamento_alvara", "concluido"], limite_dias: 120, explicacao: "Os valores a receber estão sendo requisitados (RPV ou precatório) e liberados. Depois disso, o processo é concluído." },
];
/** Etapas que NÃO são fase: dizem que o processo está parado esperando algo, dentro da fase em que estava. */
const SITUACOES = ["aguarda_juizo", "sobrestado", "aguarda_terceiros", "prov_escritorio"];

const faseDoCodigo = (codigo: string | null | undefined): number => (codigo ? FASES.findIndex((f) => f.codigos.includes(codigo)) : -1);
const TIPO_PARA_FASE: Record<TipoAndamento, string> = { sentenca: "sentenca", acordao: "recurso", recurso: "recurso", transito_julgado: "recurso", cumprimento: "cumprimento", requisicao_pagamento: "pagamento", laudo: "laudo_acordo", acordo: "laudo_acordo" };
const dia = (t: string | null | undefined) => (t ? t.slice(0, 10) : null);
const diasEntre = (de: string, ate: string) => Math.max(0, Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000));

export type EstadoDaFase = "concluida" | "atual" | "futura" | "pulada";
export interface FaseNaLinha { chave: string; rotulo: string; explicacao: string; estado: EstadoDaFase; entrou_em: string | null; saiu_em: string | null; dias_na_fase: number | null; limite_dias: number; atrasada: boolean }
export interface Evento { publicacao_id?: number; data: string; tipo: "etapa" | "publicacao" | "pericia" | "datajud" | "prazo" | "desfecho"; titulo: string; detalhe: string; origem?: string }
export interface LinhaDasFases {
  origem: "quadro" | "deduzida" | "nenhuma";
  fases: FaseNaLinha[];
  atual: { chave: string; rotulo: string; explicacao: string; indice: number; atrasada: boolean; dias: number | null } | null;
  situacao: { nome: string; desde: string | null; dias: number | null } | null;
  /** Preenchido quando o processo foi concluído ou arquivado: como terminou. */
  desfecho: { codigo: string; rotulo: string; em: string | null; observacao: string; arquivado: boolean } | null;
  eventos: Evento[];
}

interface Mov { destino: string; origem_movimento: string; created_at: string }

function chavesDoProcesso(processoId: number): string[] {
  const p = db.prepare("SELECT chave,djen_chave FROM gestao_processos WHERE id=?").get(processoId) as { chave: string; djen_chave: string | null } | undefined;
  if (!p) throw new ErroGestao("Processo não encontrado.", 404);
  return [...new Set([p.chave, p.djen_chave].filter((c): c is string => Boolean(c)))];
}

function deduzirFase(chaves: string[]): number {
  const marcas = chaves.map(() => "?").join(",");
  let max = -1;
  try {
    const pubs = db.prepare(`SELECT texto,data_disponibilizacao,tipo_documento,classe,categorias_json FROM djen_publicacoes WHERE processo_chave IN (${marcas}) AND cancelada=0 ORDER BY data_disponibilizacao,id`).all(...chaves) as { texto: string; data_disponibilizacao: string; tipo_documento: string | null; classe: string | null; categorias_json: string }[];
    for (const p of pubs) {
      let categorias: string[] = []; try { categorias = JSON.parse(p.categorias_json || "[]"); } catch { /* sem categorias */ }
      const a = andamentoDaPublicacao({ texto: p.texto, data: p.data_disponibilizacao, categorias, tipo_documento: p.tipo_documento, classe: p.classe });
      if (a) max = Math.max(max, FASES.findIndex((f) => f.chave === TIPO_PARA_FASE[a.tipo]));
    }
  } catch { /* DJEN ainda sem dados */ }
  if (db.prepare(`SELECT 1 FROM pericias_agendadas WHERE processo_chave IN (${marcas}) LIMIT 1`).get(...chaves)) max = Math.max(max, FASES.findIndex((f) => f.chave === "pericia"));
  return max;
}

export function fasesDoProcesso(processoId: number): LinhaDasFases {
  const hoje = hojeSaoPaulo();
  const chaves = chavesDoProcesso(processoId);
  const marcas = chaves.map(() => "?").join(",");
  const listas = db.prepare("SELECT id,nome,codigo FROM djen_kanban_listas").all() as { id: number; nome: string; codigo: string | null }[];
  const codigoPorNome = new Map(listas.map((l) => [l.nome.toLowerCase(), l.codigo]));
  let card: { lista_id: number; entrou_em: string; modo: string } | undefined;
  let movs: Mov[] = [];
  try {
    card = db.prepare(`SELECT lista_id,entrou_em,modo FROM djen_kanban_cartoes WHERE processo_chave IN (${marcas}) LIMIT 1`).get(...chaves) as typeof card;
    movs = db.prepare(`SELECT destino,origem_movimento,created_at FROM djen_kanban_movimentos WHERE processo_chave IN (${marcas}) ORDER BY id`).all(...chaves) as Mov[];
  } catch { /* quadro ainda não existe */ }

  // janelas de cada fase, pelo histórico de movimentos
  const entrou = new Map<number, string>(), saiu = new Map<number, string>();
  let faseCorrente = -1, ultimaDoHistorico = -1;
  for (const m of movs) {
    const i = faseDoCodigo(codigoPorNome.get(m.destino.toLowerCase()));
    if (i < 0) continue;
    ultimaDoHistorico = i;
    if (i !== faseCorrente) {
      if (faseCorrente >= 0 && !saiu.has(faseCorrente)) saiu.set(faseCorrente, dia(m.created_at)!);
      if (!entrou.has(i)) entrou.set(i, dia(m.created_at)!);
      faseCorrente = i;
    }
  }

  let origem: LinhaDasFases["origem"] = "nenhuma";
  let atual = -1;
  let situacao: LinhaDasFases["situacao"] = null;
  const lista = card ? listas.find((l) => l.id === card!.lista_id) : undefined;
  if (lista) {
    if (SITUACOES.includes(lista.codigo ?? "")) {
      situacao = { nome: lista.nome, desde: dia(card!.entrou_em), dias: card!.entrou_em ? diasEntre(dia(card!.entrou_em)!, hoje) : null };
      atual = ultimaDoHistorico;
    } else atual = faseDoCodigo(lista.codigo);
    if (atual >= 0) { origem = "quadro"; if (!entrou.has(atual)) entrou.set(atual, dia(card!.entrou_em)!); }
  }
  if (atual < 0) { const d = deduzirFase(chaves); if (d >= 0) { atual = d; origem = "deduzida"; } }

  const fases: FaseNaLinha[] = FASES.map((f, i) => {
    const estado: EstadoDaFase = atual < 0 ? "futura" : i < atual ? (entrou.has(i) || origem === "deduzida" ? "concluida" : "pulada") : i === atual ? "atual" : "futura";
    const desde = entrou.get(i) ?? null;
    const dias = estado === "atual" && desde ? diasEntre(desde, hoje) : null;
    return { chave: f.chave, rotulo: f.rotulo, explicacao: f.explicacao, estado, entrou_em: desde, saiu_em: saiu.get(i) ?? null, dias_na_fase: dias, limite_dias: f.limite_dias, atrasada: dias !== null && dias > f.limite_dias };
  });

  // histórico detalhado
  const eventos: Evento[] = [];
  for (const m of movs) eventos.push({ data: dia(m.created_at)!, tipo: "etapa", titulo: `Etapa: ${m.destino}`, detalhe: m.origem_movimento === "automatico" ? "Movida pelo sistema, a partir de uma publicação." : "Movida pela equipe.", origem: m.origem_movimento });
  try {
    const pubs = db.prepare(`SELECT id,data_disponibilizacao d,tipo_documento t,orgao o,substr(texto,1,160) x FROM djen_publicacoes WHERE processo_chave IN (${marcas}) AND cancelada=0 ORDER BY data_disponibilizacao DESC,id DESC LIMIT 40`).all(...chaves) as { id: number; d: string; t: string; o: string; x: string }[];
    for (const p of pubs) eventos.push({ publicacao_id: p.id, data: dia(p.d)!, tipo: "publicacao", titulo: `Publicação: ${p.t || "andamento"}`, detalhe: (p.x || "").replace(/\s+/g, " ").trim() });
  } catch { /* sem DJEN */ }
  for (const p of db.prepare(`SELECT tipo,data,horario,local FROM pericias_agendadas WHERE processo_chave IN (${marcas}) AND status='ativa'`).all(...chaves) as { tipo: string; data: string; horario: string | null; local: string | null }[]) {
    const iso = /^\d{2}\/\d{2}\/\d{4}/.test(p.data) ? `${p.data.slice(6, 10)}-${p.data.slice(3, 5)}-${p.data.slice(0, 2)}` : p.data.slice(0, 10);
    eventos.push({ data: iso, tipo: "pericia", titulo: `${p.tipo || "Perícia"}${p.horario ? ` às ${p.horario}` : ""}`, detalhe: p.local || "" });
  }
  try {
    const d = db.prepare(`SELECT ultimo_movimento,ultimo_movimento_em FROM gestao_datajud WHERE processo_chave IN (${marcas}) AND status='ok' LIMIT 1`).get(...chaves) as { ultimo_movimento: string; ultimo_movimento_em: string } | undefined;
    if (d?.ultimo_movimento) eventos.push({ data: d.ultimo_movimento_em, tipo: "datajud", titulo: `DataJud: ${d.ultimo_movimento}`, detalhe: "Último movimento informado pelo CNJ." });
    for (const p of db.prepare(`SELECT dp.descricao,dp.termino FROM djen_prazos dp JOIN djen_publicacoes pub ON pub.id=dp.publicacao_id WHERE pub.processo_chave IN (${marcas}) AND dp.status='aberto' AND dp.termino IS NOT NULL ORDER BY dp.termino LIMIT 10`).all(...chaves) as { descricao: string; termino: string }[])
      eventos.push({ data: dia(p.termino)!, tipo: "prazo", titulo: `Prazo: ${p.descricao}`, detalhe: "Prazo em aberto." });
  } catch { /* sem DataJud/prazos */ }
  eventos.sort((a, b) => b.data.localeCompare(a.data));

  const pr = db.prepare("SELECT status,desfecho,desfecho_em,desfecho_obs FROM gestao_processos WHERE id=?").get(processoId) as { status: string; desfecho: string; desfecho_em: string; desfecho_obs: string };
  const desfecho = pr.desfecho ? { codigo: pr.desfecho, rotulo: ROTULO_DO_DESFECHO[pr.desfecho] ?? pr.desfecho, em: pr.desfecho_em || null, observacao: pr.desfecho_obs, arquivado: pr.status === "arquivado" } : null;
  if (desfecho) {
    eventos.push({ data: desfecho.em ?? hoje, tipo: "desfecho", titulo: desfecho.arquivado ? "Processo arquivado" : `Processo concluído: ${desfecho.rotulo}`, detalhe: desfecho.observacao });
    // Processo encerrado: nada mais está «em andamento» nem atrasado; a fase em que terminou conta como concluída.
    for (const [i, x] of fases.entries()) { if (i <= atual) { x.estado = "concluida"; x.dias_na_fase = null; x.atrasada = false; } }
    eventos.sort((a, b) => b.data.localeCompare(a.data));
  }
  const f = atual >= 0 ? fases[atual]! : null;
  return {
    origem, fases, situacao, desfecho, eventos: eventos.slice(0, 80),
    atual: f ? { chave: f.chave, rotulo: f.rotulo, explicacao: f.explicacao, indice: atual, atrasada: f.atrasada, dias: f.dias_na_fase } : null,
  };
}

/** O resumo de várias fichas de uma vez (para listas): fase atual, posição e se está acima do tempo esperado. */
export function resumoDasFases(ids: number[]): Record<number, { rotulo: string; indice: number; total: number; atrasada: boolean; dias: number | null; deduzida: boolean } | null> {
  const r: Record<number, { rotulo: string; indice: number; total: number; atrasada: boolean; dias: number | null; deduzida: boolean } | null> = {};
  for (const id of ids.slice(0, 60)) {
    try { const l = fasesDoProcesso(id); r[id] = l.atual ? { rotulo: l.atual.rotulo, indice: l.atual.indice, total: FASES.length, atrasada: l.atual.atrasada, dias: l.atual.dias, deduzida: l.origem === "deduzida" } : null; }
    catch { r[id] = null; }
  }
  return r;
}

/** Põe o cartão do quadro na etapa de código `codigo` (modo manual, com histórico). Cria o cartão se o processo ainda não estava no quadro. */
function fixarEtapa(processoId: number, codigo: string) {
  const chaves = chavesDoProcesso(processoId);
  const chave = chaves.find((c) => /^\d{20}$/.test(c)) ?? chaves[0]!;
  const lista = db.prepare("SELECT id,nome FROM djen_kanban_listas WHERE codigo=?").get(codigo) as { id: number; nome: string } | undefined;
  if (!lista) return false;
  db.prepare("INSERT OR IGNORE INTO djen_processos(chave,numero) VALUES (?,?)").run(chave, chave);
  if (db.prepare("SELECT 1 FROM djen_kanban_cartoes WHERE processo_chave=?").get(chave)) moverCartaoKanban(chave, lista.id);
  else db.transaction(() => {
    db.prepare("INSERT INTO djen_kanban_cartoes(processo_chave,lista_id,modo,revisar_etapa) VALUES (?,?,'manual',0)").run(chave, lista.id);
    db.prepare("INSERT INTO djen_kanban_movimentos(processo_chave,origem,destino,origem_movimento) VALUES (?,NULL,?,'manual')").run(chave, lista.nome);
  })();
  db.prepare("UPDATE djen_kanban_cartoes SET modo='manual',revisar_etapa=0 WHERE processo_chave=? AND lista_id=? AND modo<>'manual'").run(chave, lista.id);
  return true;
}

/** A equipe define a fase: o cartão do quadro vai para a PRIMEIRA etapa da fase (modo manual). Serve também para confirmar a fase deduzida. */
export function definirFase(processoId: number, fase: unknown) {
  const f = FASES.find((x) => x.chave === fase);
  if (!f) throw new ErroGestao("Escolha uma fase válida.", 400);
  if (!fixarEtapa(processoId, f.codigos[0]!)) throw new ErroGestao("A etapa desta fase não existe no quadro. Recrie-a em Processos → Quadro.", 409);
  return fasesDoProcesso(processoId);
}

// ---------- desfecho: concluir, arquivar e reabrir ----------
export const ROTULO_DO_DESFECHO: Record<string, string> = {
  procedente: "Procedente", parcialmente_procedente: "Parcialmente procedente", improcedente: "Improcedente", acordo: "Acordo homologado",
  extinto: "Extinto sem resolução do mérito", arquivado: "Arquivado",
};
const DESFECHOS_DA_CONCLUSAO = ["procedente", "parcialmente_procedente", "improcedente", "acordo", "extinto"];
const dataIso = (d: unknown): string | null => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) ? d : null);

/** Conclui o processo com o resultado: ele sai do «em andamento» (status Encerrado), o cartão vai para Concluído e o desfecho fica registrado. */
export function concluirProcesso(processoId: number, d: { desfecho?: unknown; data?: unknown; observacao?: unknown }) {
  const p = db.prepare("SELECT status FROM gestao_processos WHERE id=?").get(processoId) as { status: string } | undefined;
  if (!p) throw new ErroGestao("Processo não encontrado.", 404);
  if (typeof d.desfecho !== "string" || !DESFECHOS_DA_CONCLUSAO.includes(d.desfecho)) throw new ErroGestao("Escolha como o processo terminou: procedente, parcialmente procedente, improcedente, acordo ou extinto.", 400);
  const em = dataIso(d.data) ?? hojeSaoPaulo();
  if (em > hojeSaoPaulo()) throw new ErroGestao("A data da conclusão não pode ser no futuro.", 400);
  db.prepare("UPDATE gestao_processos SET status='encerrado',desfecho=?,desfecho_em=?,desfecho_obs=?,atualizado_em=CURRENT_TIMESTAMP WHERE id=?").run(d.desfecho, em, String(d.observacao ?? "").trim().slice(0, 1000), processoId);
  try { fixarEtapa(processoId, "concluido"); } catch { /* sem quadro: o desfecho já está registrado */ }
  return fasesDoProcesso(processoId);
}

/** Arquiva o processo (sem resultado de mérito): sai das listas e dos alertas, e pode ser reaberto. */
export function arquivarProcesso(processoId: number, d: { observacao?: unknown }) {
  if (!db.prepare("SELECT 1 FROM gestao_processos WHERE id=?").get(processoId)) throw new ErroGestao("Processo não encontrado.", 404);
  db.prepare("UPDATE gestao_processos SET status='arquivado',desfecho='arquivado',desfecho_em=?,desfecho_obs=?,atualizado_em=CURRENT_TIMESTAMP WHERE id=?").run(hojeSaoPaulo(), String(d.observacao ?? "").trim().slice(0, 1000), processoId);
  return fasesDoProcesso(processoId);
}

/** Reabre o processo concluído ou arquivado: volta a «Ativo» e o desfecho é limpo (a fase continua como estava; a equipe pode ajustá-la). */
export function reabrirProcesso(processoId: number) {
  if (!db.prepare("SELECT 1 FROM gestao_processos WHERE id=?").get(processoId)) throw new ErroGestao("Processo não encontrado.", 404);
  db.prepare("UPDATE gestao_processos SET status='ativo',desfecho='',desfecho_em='',desfecho_obs='',atualizado_em=CURRENT_TIMESTAMP WHERE id=?").run(processoId);
  return fasesDoProcesso(processoId);
}

/** Processos ativos que passaram do tempo esperado na fase atual (os mais atrasados primeiro). Alimenta o aviso do painel Início. */
export function processosAtrasadosNaFase(max = 10) {
  const ativos = db.prepare(`SELECT p.id,p.numero,p.pasta,
      (SELECT pe.nome FROM gestao_partes g JOIN gestao_pessoas pe ON pe.id=g.pessoa_id WHERE g.processo_id=p.id AND g.papel='autor' ORDER BY g.principal DESC LIMIT 1) AS cliente
    FROM gestao_processos p WHERE p.status='ativo' ORDER BY p.atualizado_em DESC LIMIT 400`).all() as { id: number; numero: string; pasta: string; cliente: string | null }[];
  const lista: { id: number; numero: string; pasta: string; cliente: string | null; fase: string; dias: number; limite_dias: number; excesso: number }[] = [];
  for (const a of ativos) {
    try {
      const l = fasesDoProcesso(a.id);
      const f = l.fases.find((x) => x.estado === "atual");
      if (f?.atrasada && f.dias_na_fase !== null) lista.push({ ...a, fase: f.rotulo, dias: f.dias_na_fase, limite_dias: f.limite_dias, excesso: f.dias_na_fase - f.limite_dias });
    } catch { /* ficha sem dados do quadro */ }
  }
  lista.sort((x, y) => y.excesso - x.excesso);
  return { total: lista.length, itens: lista.slice(0, max) };
}
