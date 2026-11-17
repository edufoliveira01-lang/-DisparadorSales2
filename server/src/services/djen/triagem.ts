import { db } from "../../db";
import { hojeSaoPaulo, memoDjen } from "./cache";
import { identificarOrdensProcessuais, ordemDoEscritorio } from "./proceduralOrders";
import { ordemAtiva, situacaoDaOrdem, type PublicacaoPosterior } from "./orderStatus";
import { agendamentoNoTexto, dataHoraAgendamento, dataPadrao, horarioPadrao } from "./periciaIntegration";

export interface TriagemPublicacao {
  prioridade: number;
  data_prioridade: string | null;
  motivo: string;
  vencido: boolean;
  vence_hoje: boolean;
  compromisso_proximo: boolean;
  conferencia_pendente: boolean;
  prazo_a_lancar: boolean;
  dados_incompletos: boolean;
  prazo_aberto: boolean;
  compromisso: { tipo: "pericia" | "audiencia"; data: string | null; horario: string | null; local: string | null; registro_id: number | null; avisado: boolean } | null;
  responsavel_id: number | null;
  responsavel_nome: string | null;
  gestao_processo_id: number | null;
}

interface Linha {
  id: number; processo_chave: string; texto: string; categorias_json: string; ia_json: string | null;
  agendamento_revisado_json: string | null; revisada: number; concluida: number; ia_status: string;
  compromisso_estado: string; data_disponibilizacao: string; tipo_documento: string; classe: string;
  responsavel_id: number | null; responsavel_nome: string | null; gestao_processo_id: number | null;
}
interface PrazoResumo { publicacao_id: number; total: number; abertos: number; concluidos: number; termino: string | null; escritorio_abertos: number; nao_identificados: number; termino_a_conferir: string | null }

function json<T>(value: string | null, fallback: T): T {
  try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}

/** A mesma avaliação alimenta a contagem, o filtro e a ordem da fila por andamento. */
export function triagensPublicacoes(): Map<number, TriagemPublicacao> {
  return memoDjen("triagem-publicacoes", 30_000, () => {
    const hoje = hojeSaoPaulo();
    const limite = new Date(`${hoje}T12:00:00Z`);
    limite.setUTCDate(limite.getUTCDate() + 7);
    const ate = limite.toISOString().slice(0, 10);
    const linhas = db.prepare(`SELECT p.id,p.processo_chave,p.texto,p.categorias_json,p.ia_json,p.agendamento_revisado_json,
      p.revisada,p.concluida,p.ia_status,p.compromisso_estado,p.data_disponibilizacao,p.tipo_documento,p.classe,
      g.id AS gestao_processo_id,g.responsavel_user_id AS responsavel_id,u.display_name AS responsavel_nome
      FROM djen_publicacoes p
      LEFT JOIN gestao_processos g ON g.id=(SELECT g2.id FROM gestao_processos g2
        WHERE g2.chave=p.processo_chave OR g2.djen_chave=p.processo_chave ORDER BY g2.id LIMIT 1)
      LEFT JOIN users u ON u.id=g.responsavel_user_id
      WHERE p.cancelada=0 ORDER BY p.processo_chave,p.data_disponibilizacao DESC,p.id DESC`).all() as Linha[];
    const prazos = new Map((db.prepare(`SELECT publicacao_id,COUNT(*) AS total,SUM(status='aberto') AS abertos,
      SUM(status='concluido') AS concluidos,SUM(status='aberto' AND responsavel='escritorio') AS escritorio_abertos,
      SUM(status='aberto' AND responsavel='nao_identificado') AS nao_identificados,
      MIN(CASE WHEN status='aberto' AND responsavel='nao_identificado' THEN termino END) AS termino_a_conferir,
      MIN(CASE WHEN status='aberto' AND responsavel='escritorio' THEN termino END) AS termino
      FROM djen_prazos GROUP BY publicacao_id`).all() as PrazoResumo[]).map(p => [p.publicacao_id, p]));
    const cumpridas = new Set((db.prepare("SELECT publicacao_id FROM djen_prazos_escritorio_estado WHERE status='resolvido'").all() as { publicacao_id: number }[]).map(p => p.publicacao_id));
    const compromissos = db.prepare("SELECT id,card_id,processo_chave,data_hora_ms,ultimo_lembrete_em,origem FROM pericias_agendadas WHERE status='ativa'").all() as {
      id: number; card_id: string; processo_chave: string; data_hora_ms: number; ultimo_lembrete_em: string | null; origem: string | null;
    }[];
    const posteriores = new Map<string, PublicacaoPosterior[]>();
    const resultado = new Map<number, TriagemPublicacao>();
    for (const p of linhas) {
      const cats = json<string[]>(p.categorias_json, []);
      const prazo = prazos.get(p.id);
      const posterioresDoProcesso = posteriores.get(p.processo_chave) ?? [];
      const ordens = identificarOrdensProcessuais(p.texto).filter(ordemDoEscritorio);
      const exigePrazo = ordens.some(o => o.tipo === "prazo_explicito" && ordemAtiva(situacaoDaOrdem(o, posterioresDoProcesso, {
        prazosDoUsuario: prazo, cumpridaManual: cumpridas.has(p.id),
      })));
      const analise = json<{ agendamento?: { data?: string | null; horario?: string | null; local?: string | null } }>(p.ia_json, {});
      const manual = json<{ data?: string | null; horario?: string | null; local?: string | null }>(p.agendamento_revisado_json, {});
      const tipo = cats.includes("pericia") ? "pericia" : cats.includes("audiencia") ? "audiencia" : null;
      const origem = { ...analise.agendamento, ...manual };
      const literal = tipo && (!origem.data || !origem.horario) ? agendamentoNoTexto(p.texto, tipo) : null;
      const br = dataPadrao(origem.data || literal?.data || null);
      const data = br ? br.split("/").reverse().join("-") : null;
      const horario = horarioPadrao(origem.horario || literal?.horario || null);
      const instante = dataHoraAgendamento(data, horario);
      const existente = tipo ? compromissos.find(c => c.processo_chave === p.processo_chave && c.data_hora_ms === instante &&
        (tipo === "audiencia" ? c.origem === "audiencia" : c.origem !== "audiencia")) : null;
      const compromisso: TriagemPublicacao["compromisso"] = tipo ? { tipo, data, horario, local: origem.local || literal?.local || null, registro_id: existente?.id ?? null, avisado: Boolean(existente?.ultimo_lembrete_em) } : null;
      const vencido = Boolean(prazo?.termino && prazo.termino < hoje);
      const venceHoje = prazo?.termino === hoje;
      const futuro = Boolean(tipo && (!data || data >= hoje));
      const dadosIncompletos = futuro && (!data || !horario || !compromisso?.local);
      const compromissoProximo = Boolean(tipo && data && data >= hoje && data <= ate);
      const prazoALancar = !p.concluida && exigePrazo && (!prazo || prazo.escritorio_abertos === 0 && prazo.concluidos === 0);
      const conferencia = Boolean(prazo?.nao_identificados) || !p.concluida && (!p.revisada || dadosIncompletos || prazoALancar || futuro && !existente);
      let prioridade = 6;
      let motivo = "Conferir ciência e próximos passos";
      if (vencido) { prioridade = 0; motivo = "Prazo vencido · registrar cumprimento ou providência"; }
      else if (venceHoje) { prioridade = 1; motivo = "Prazo vence hoje · providência do escritório"; }
      else if (compromissoProximo) { prioridade = 2; motivo = existente ? "Compromisso próximo · conferir aviso ao cliente" : "Compromisso próximo · conferir e registrar"; }
      else if (conferencia) { prioridade = 3; motivo = prazo?.nao_identificados ? "Prazo cadastrado · destinatário a conferir" : p.ia_status === "erro" && !p.revisada ? "IA falhou · conferir a publicação" : prazoALancar ? "Prazo expresso · conferir e lançar" : "Dados e providências a conferir"; }
      else if (prazo?.escritorio_abertos) { prioridade = 4; motivo = "Prazo do escritório em acompanhamento"; }
      else if (futuro) { prioridade = 5; motivo = "Compromisso registrado · acompanhar comunicação"; }
      resultado.set(p.id, {
        prioridade, data_prioridade: prazo?.termino || prazo?.termino_a_conferir || data, motivo, vencido, vence_hoje: venceHoje,
        compromisso_proximo: compromissoProximo, conferencia_pendente: conferencia, prazo_a_lancar: prazoALancar,
        dados_incompletos: Boolean(dadosIncompletos), prazo_aberto: Boolean(prazo?.escritorio_abertos || prazo?.nao_identificados), compromisso,
        responsavel_id: p.responsavel_id, responsavel_nome: p.responsavel_nome, gestao_processo_id: p.gestao_processo_id,
      });
      posterioresDoProcesso.push({ texto: p.texto, data: p.data_disponibilizacao, categorias: cats, tipo_documento: p.tipo_documento, classe: p.classe });
      posteriores.set(p.processo_chave, posterioresDoProcesso);
    }
    return resultado;
  });
}

export function correspondePrioridade(t: TriagemPublicacao, filtro: string): boolean {
  if (filtro === "urgentes") return t.vencido || t.vence_hoje;
  if (filtro === "hoje") return t.vence_hoje;
  if (filtro === "compromissos") return t.compromisso_proximo;
  if (filtro === "conferir") return t.conferencia_pendente;
  if (filtro === "sem_prazo") return t.prazo_a_lancar;
  if (filtro === "datas") return t.dados_incompletos;
  return true;
}
