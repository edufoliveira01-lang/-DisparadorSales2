import { db } from "../../db";
import { DjenInputError } from "./store";
import { cumprimentoIdentificado, identificarObrigacoesExternas, TIPOS_OBRIGACAO, type TipoObrigacao } from "./obligations";

const hoje = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const diasDesde = (data: string) =>
  Math.floor((Date.parse(`${hoje()}T12:00:00Z`) - Date.parse(`${data.slice(0, 10)}T12:00:00Z`)) / 86400000);

/** Lembretes operacionais: a ausência de prova no DJEN não comprova descumprimento nos autos. */
export function listarObrigacoesExternas() {
  const config = db.prepare("SELECT aguardo_dias FROM djen_config WHERE id=1").get() as { aguardo_dias: number };
  const rows = db.prepare(
    `SELECT p.id,p.processo_chave,p.data_disponibilizacao,p.texto,p.situacao,p.ia_json,
            pr.numero AS processo,c.nome AS cliente_nome
       FROM djen_publicacoes p JOIN djen_processos pr ON pr.chave=p.processo_chave
       LEFT JOIN contacts c ON c.id=pr.cliente_id
      WHERE p.cancelada=0
      ORDER BY p.processo_chave,p.data_disponibilizacao DESC,p.id DESC`,
  ).all() as {
    id: number; processo_chave: string; data_disponibilizacao: string; texto: string;
    situacao: string; ia_json: string | null; processo: string; cliente_nome: string | null;
  }[];
  const estados = new Map(
    (db.prepare("SELECT publicacao_id,tipo,status,ultima_cobranca_em FROM djen_acompanhamentos_obrigacoes").all() as {
      publicacao_id: number; tipo: string; status: string; ultima_cobranca_em: string | null;
    }[]).map((r) => [`${r.publicacao_id}:${r.tipo}`, r] as const),
  );
  const posteriores = new Map<string, string[]>();
  const acompanhados = new Set<string>();
  const saida: {
    publicacao_id: number; tipo: TipoObrigacao; responsavel: string; processo: string;
    cliente_nome: string | null; data_disponibilizacao: string; dias_decorridos: number;
    dias_espera: number; prazo_citado_dias: number | null; motivo: string; resumo: string;
    acompanhamento_status: string; ultima_cobranca_em: string | null;
  }[] = [];
  for (const row of rows) {
    const textosPosteriores = posteriores.get(row.processo_chave) || [];
    for (const ordem of identificarObrigacoesExternas(row.texto)) {
      const chave = `${row.processo_chave}:${ordem.tipo}:${ordem.trecho.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim()}`;
      if (acompanhados.has(chave)) continue;
      acompanhados.add(chave); // Reiteração idêntica reinicia; ordens diferentes seguem separadas.
      const dias_espera = Math.max(config.aguardo_dias, ordem.prazo_citado_dias || 0);
      const dias_decorridos = diasDesde(row.data_disponibilizacao);
      if (!Number.isFinite(dias_decorridos) || dias_decorridos < dias_espera) continue;
      if (textosPosteriores.some((texto) => cumprimentoIdentificado(ordem.tipo, texto, ordem.trecho))) continue;
      const estado = estados.get(`${row.id}:${ordem.tipo}`);
      if (estado?.status === "resolvido") continue;
      let resumo = row.situacao || ordem.trecho;
      try {
        const ia = row.ia_json ? JSON.parse(row.ia_json) : null;
        if (typeof ia?.resumo === "string") resumo = ia.resumo;
      } catch { /* análise legada incompleta */ }
      saida.push({
        publicacao_id: row.id, tipo: ordem.tipo, responsavel: ordem.responsavel,
        processo: row.processo, cliente_nome: row.cliente_nome,
        data_disponibilizacao: row.data_disponibilizacao, dias_decorridos,
        dias_espera, prazo_citado_dias: ordem.prazo_citado_dias,
        motivo: ordem.trecho, resumo,
        acompanhamento_status: estado?.status || "pendente",
        ultima_cobranca_em: estado?.ultima_cobranca_em || null,
      });
    }
    textosPosteriores.push(row.texto);
    posteriores.set(row.processo_chave, textosPosteriores);
  }
  return saida.sort((a, b) => b.dias_decorridos - a.dias_decorridos);
}

export function atualizarObrigacaoExterna(publicacaoId: number, tipo: unknown, status: unknown) {
  if (!TIPOS_OBRIGACAO.includes(tipo as TipoObrigacao)) throw new DjenInputError("Tipo de acompanhamento inválido.");
  if (status !== "pendente" && status !== "cobrado" && status !== "resolvido")
    throw new DjenInputError("Situação de acompanhamento inválida.");
  const row = db.prepare("SELECT texto FROM djen_publicacoes WHERE id=? AND cancelada=0").get(publicacaoId) as { texto: string } | undefined;
  if (!row || !identificarObrigacoesExternas(row.texto).some((ordem) => ordem.tipo === tipo))
    throw new DjenInputError("Obrigação não encontrada nesta publicação.");
  db.prepare(
    `INSERT INTO djen_acompanhamentos_obrigacoes(publicacao_id,tipo,status,ultima_cobranca_em)
     VALUES (?,?,?,CASE WHEN ?='cobrado' THEN CURRENT_TIMESTAMP ELSE NULL END)
     ON CONFLICT(publicacao_id,tipo) DO UPDATE SET
       status=excluded.status,
       ultima_cobranca_em=CASE WHEN excluded.status='cobrado' THEN CURRENT_TIMESTAMP ELSE djen_acompanhamentos_obrigacoes.ultima_cobranca_em END`,
  ).run(publicacaoId, tipo, status, status);
  return { ok: true };
}
