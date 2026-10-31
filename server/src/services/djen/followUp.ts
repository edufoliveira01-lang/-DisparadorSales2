import { prazoDoAcompanhamento } from "./followUpDeadline";
import { registrarHistoricoDjen } from "./history";
import { contextoNaoAtual } from "./proceduralOrders";
import { faseDaInstrucao } from "./followUpPolicy";
import { db } from "../../db";
import { normalizarTexto } from "./classifier";
import { DjenInputError } from "./store";

const hoje = () => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
};
const diasDesde = (data: string) =>
  Math.floor((Date.parse(`${hoje()}T12:00:00Z`) - Date.parse(`${data.slice(0, 10)}T12:00:00Z`)) / 86400000);

/** Alertas operacionais: nunca substituem consulta aos autos nem prazo processual. */
export function listarAguardandoMovimentacao() {
  const config = db.prepare("SELECT aguardo_dias FROM djen_config WHERE id=1").get() as { aguardo_dias: number };
  const rows = db.prepare(
    `SELECT p.id,p.tribunal,p.orgao,p.processo_chave,p.data_disponibilizacao,p.texto,p.situacao,p.ia_json,
            pr.numero AS processo,c.nome AS cliente_nome,
            COALESCE(a.status,'pendente') AS acompanhamento_status,a.ultima_cobranca_em
       FROM djen_publicacoes p
       JOIN djen_processos pr ON pr.chave=p.processo_chave
       LEFT JOIN contacts c ON c.id=pr.cliente_id
       LEFT JOIN djen_acompanhamentos_aguardo a ON a.publicacao_id=p.id
      WHERE p.cancelada=0 AND p.concluida=0
        AND COALESCE(a.status,'pendente')<>'resolvido'
        AND NOT EXISTS (
          SELECT 1 FROM djen_publicacoes posterior
           WHERE posterior.processo_chave=p.processo_chave AND posterior.cancelada=0
             AND (posterior.data_disponibilizacao>p.data_disponibilizacao
               OR (posterior.data_disponibilizacao=p.data_disponibilizacao AND posterior.id>p.id))
        )`,
  ).all() as {
    id: number; tribunal: string; orgao: string; processo_chave: string; data_disponibilizacao: string;
    texto: string; situacao: string; ia_json: string | null;
    processo: string; cliente_nome: string | null;
    acompanhamento_status: string; ultima_cobranca_em: string | null;
  }[];
  return rows.flatMap((row) => {
    const texto = normalizarTexto(row.texto);
    const ordem = texto.match(/\b(?:aguarde-se|aguardem-se|aguarde|aguardar|sobrest[ea](?:-se)?|sobrestad[oa]|suspendo o feito|suspensao do processo)\b[^.;\n]{0,180}/);
    if (!ordem || contextoNaoAtual(ordem[0]) || faseDaInstrucao(row.texto) === "encerrada") return [];
    // Não interpreta prazo dirigido à parte como prazo de espera do juízo.
    if (/\b(?:autora?|parte autora|advogad[oa]|escritorio)\b[^.;]{0,80}\b(?:cumpra|manifeste|apresente|junte)\b/.test(ordem[0])) return [];
    const numero = ordem[0].match(/\b(\d{1,3})\s*(?:\([^)]*\)\s*)?dias\b/);
    const palavras: Record<string, number> = { um: 1, dois: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, quinze: 15, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90 };
    const escrito = ordem[0].match(/\b(um|dois|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|quinze|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa)(?:\s+e\s+(um|dois|tres|quatro|cinco|seis|sete|oito|nove))?\s+dias\b/);
    // Um período expresso mas não reconhecido nunca recebe o padrão menor por engano.
    if (!numero && !escrito && /\bdias\b/.test(ordem[0])) return [];
    const diasEspera = numero ? Math.min(365, Math.max(1, Number(numero[1]))) : escrito ? palavras[escrito[1]] + (escrito[2] ? palavras[escrito[2]] : 0) : config.aguardo_dias;
    const diasSemPublicacao = diasDesde(row.data_disponibilizacao);
    const explicito = Boolean(numero || escrito);
    const prazo = prazoDoAcompanhamento({ tipo: 'parte_contraria', responsavel: 'Juízo', trecho: ordem[0],
      prazo_citado_dias: explicito ? diasEspera : null, prazo_texto: explicito ? (numero?.[0] || escrito?.[0] || null) : null,
      unidade: /corridos/.test(ordem[0]) ? 'corridos' : 'uteis',
      alerta: /(?:apos|a partir|a contar|contados? d)/.test(ordem[0]) ? 'Conferir o evento que inicia a espera.' : null,
    }, row, config.aguardo_dias, hoje());
    if (!prazo.exibir) return [];
    let resumo = row.situacao || "Aguardando movimentação";
    try {
      const analise = row.ia_json ? JSON.parse(row.ia_json) : null;
      resumo = analise?.resumo || resumo;
    } catch { /* análise legada incompleta */ }
    return [{
      publicacao_id: row.id,
      processo: row.processo,
      cliente_nome: row.cliente_nome,
      data_disponibilizacao: row.data_disponibilizacao,
      dias_sem_publicacao: diasSemPublicacao,
      ...prazo,
      motivo: row.situacao || ordem[0].trim(),
      resumo,
      acompanhamento_status: row.acompanhamento_status,
      ultima_cobranca_em: row.ultima_cobranca_em,
    }];
  }).sort((a, b) => b.dias_sem_publicacao - a.dias_sem_publicacao);
}

export function atualizarAguardandoMovimentacao(id: number, status: unknown) {
  if (status !== "cobrado" && status !== "resolvido" && status !== "pendente")
    throw new DjenInputError("Situação de acompanhamento inválida.");
  const existe = db.prepare("SELECT id FROM djen_publicacoes WHERE id=?").get(id);
  if (!existe) throw new DjenInputError("Publicação não encontrada.");
  db.prepare(
    `INSERT INTO djen_acompanhamentos_aguardo(publicacao_id,status,ultima_cobranca_em)
     VALUES (?,?,CASE WHEN ?='cobrado' THEN CURRENT_TIMESTAMP ELSE NULL END)
     ON CONFLICT(publicacao_id) DO UPDATE SET
       status=excluded.status,
       ultima_cobranca_em=CASE WHEN excluded.status='cobrado' THEN CURRENT_TIMESTAMP ELSE djen_acompanhamentos_aguardo.ultima_cobranca_em END`,
  ).run(id, status, status);
  registrarHistoricoDjen(id, "providencia", status === "cobrado" ? "Cobrança marcada como realizada; nenhum envio automático." : `Acompanhamento ${status} pelo usuário.`);
  return { ok: true };
}

