import { db } from "../../db";
import { agendaDaPessoa, andamentoDoProcesso } from "../../services/gestao/integracao";
import { clientePeloTelefone, type ClienteAchado } from "./telefone";

/**
 * As ferramentas que o agente de IA do Deskcomm usa para falar com quem JÁ é cliente. Todas são SOMENTE LEITURA e só enxergam o cliente
 * da conversa: ele é achado pelo telefone que o Deskcomm envia (nunca por um dado que o modelo escreva), e nenhuma ferramenta aceita
 * "id de cliente" como argumento. Não devolvem CPF, RG, endereço completo nem anotações internas.
 */
export interface ResultadoFerramenta { texto: string; dados: unknown; erro?: boolean }
export interface Ferramenta {
  name: string; title: string; description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties: false };
  executar: (telefone: string, args: Record<string, unknown>) => ResultadoFerramenta;
}

const SEM_CLIENTE: ResultadoFerramenta = { texto: "Este telefone não está no cadastro de clientes do escritório. Trate a pessoa como alguém novo (lead): não informe nada de processos.", dados: { encontrado: false } };
const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (iso: string | null | undefined) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso ?? "");
const hoje = () => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);

/** Resolve o cliente ou devolve a resposta pronta para os casos "não achei" e "tem mais de um". */
function comCliente(telefone: string, f: (c: ClienteAchado) => ResultadoFerramenta): ResultadoFerramenta {
  const b = clientePeloTelefone(telefone);
  if (b.achou === "nenhum") return SEM_CLIENTE;
  if (b.achou === "varios") return { texto: "Há mais de um cadastro com este telefone. Não informe dados de processo: avise que a equipe confirma a identidade e retorna, e passe a conversa a um atendente.", dados: { encontrado: true, ambiguo: true } };
  return f(b.cliente);
}

const processosDo = (pessoaId: number) => db.prepare(`SELECT pr.id,pr.numero,pr.pasta,pr.tribunal,pr.orgao,pr.area,pr.assunto,pr.fase,pr.status,pr.atualizado_em,g.papel
  FROM gestao_partes g JOIN gestao_processos pr ON pr.id=g.processo_id WHERE g.pessoa_id=? ORDER BY (pr.status='ativo') DESC, pr.atualizado_em DESC LIMIT 30`).all(pessoaId) as { id: number; numero: string; pasta: string; tribunal: string; orgao: string; area: string; assunto: string; fase: string; status: string; atualizado_em: string; papel: string }[];
const processoView = (p: ReturnType<typeof processosDo>[number]) => ({ numero: p.numero, pasta: p.pasta, tribunal: p.tribunal, orgao: p.orgao, area: p.area, assunto: p.assunto, fase: p.fase, situacao: p.status });

function compromissosDe(pessoaId: number, dias: number) {
  const h = hoje(), limite = new Date(Date.parse(`${h}T12:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
  return agendaDaPessoa(pessoaId).pericias
    .filter((x) => !x.passada && x.data >= h && x.data <= limite)
    .sort((a, b) => a.data.localeCompare(b.data) || String(a.horario ?? "").localeCompare(String(b.horario ?? "")))
    .map((x) => ({
      tipo: /audi[eê]ncia/i.test(`${x.tipo}`) ? "Audiência" : x.tipo || "Perícia", data: dia(x.data), horario: x.horario || "", local: x.local || "",
      perito: x.profissional_perito || "", processo: x.processo || "",
    }));
}

function financeiroDe(pessoaId: number) {
  const linhas = db.prepare(`SELECT descricao,valor_centavos,vencimento,pago_em,valor_pago_centavos,parcela_numero,parcela_total FROM gestao_lancamentos
    WHERE pessoa_id=? AND tipo='receber' AND categoria='honorarios' AND cancelado=0 ORDER BY vencimento`).all(pessoaId) as { descricao: string; valor_centavos: number; vencimento: string; pago_em: string | null; valor_pago_centavos: number | null; parcela_numero: number | null; parcela_total: number | null }[];
  const h = hoje();
  const abertas = linhas.filter((l) => !l.pago_em);
  const parcela = (l: (typeof linhas)[number]) => ({ descricao: l.descricao, parcela: l.parcela_numero && l.parcela_total ? `${l.parcela_numero}/${l.parcela_total}` : "", valor: brl(l.valor_centavos), vencimento: dia(l.vencimento) });
  return {
    total_de_parcelas: linhas.length, pagas: linhas.length - abertas.length,
    em_atraso: abertas.filter((l) => l.vencimento < h).map(parcela),
    a_vencer: abertas.filter((l) => l.vencimento >= h).slice(0, 6).map(parcela),
  };
}

const arquivosDe = (pessoaId: number) => db.prepare(`SELECT nome,categoria,criado_em FROM gestao_arquivos WHERE pessoa_id=? OR processo_id IN (SELECT processo_id FROM gestao_partes WHERE pessoa_id=?) ORDER BY criado_em DESC LIMIT 40`)
  .all(pessoaId, pessoaId) as { nome: string; categoria: string; criado_em: string }[];

export const FERRAMENTAS: readonly Ferramenta[] = [
  {
    name: "consultar_cliente", title: "Ficha do cliente",
    description: "Use quando a pessoa disser que já é cliente ou perguntar sobre o seu caso. Acha o cadastro do cliente pelo telefone desta conversa e devolve a visão geral: processos (número, tribunal, fase, situação), contrato, documentos recebidos, situação dos honorários e os próximos compromissos (perícias e audiências). Sem argumentos.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    executar: (tel) => comCliente(tel, (c) => {
      const processos = processosDo(c.id).map(processoView);
      let contratos: { status: string; criado_em: string; assinado_em: string | null }[] = [];
      try { contratos = db.prepare("SELECT status,criado_em,assinado_em FROM zapsign_contratos WHERE pessoa_id=? ORDER BY id DESC LIMIT 3").all(c.id) as typeof contratos; } catch { /* módulo de contratos ainda não usado neste escritório */ }
      const compromissos = compromissosDe(c.id, 120);
      const fin = financeiroDe(c.id);
      const docs = arquivosDe(c.id).slice(0, 15).map((a) => ({ nome: a.nome, categoria: a.categoria, recebido_em: dia(a.criado_em) }));
      const dados = { encontrado: true, cliente: { nome: c.nome, cidade: c.cidade, uf: c.uf, cliente_desde: dia(c.criado_em) }, processos, contratos: contratos.map((x) => ({ situacao: x.status === "assinado" ? "assinado" : "aguardando assinatura", enviado_em: dia(x.criado_em), assinado_em: dia(x.assinado_em) })), compromissos_proximos: compromissos, documentos_recentes: docs, honorarios: { parcelas: fin.total_de_parcelas, pagas: fin.pagas, em_atraso: fin.em_atraso.length, proximo_vencimento: fin.a_vencer[0]?.vencimento ?? null } };
      const linhas = [
        `Cliente: ${c.nome}${c.cidade ? ` (${c.cidade}${c.uf ? `/${c.uf}` : ""})` : ""}.`,
        processos.length ? `Processos (${processos.length}): ${processos.slice(0, 5).map((p) => `${p.numero}${p.area ? ` — ${p.area}` : ""}${p.fase ? `, fase: ${p.fase}` : ""}, ${p.situacao}`).join("; ")}.` : "Nenhum processo cadastrado ainda.",
        compromissos.length ? `Próximos compromissos: ${compromissos.slice(0, 4).map((x) => `${x.tipo} em ${x.data}${x.horario ? ` às ${x.horario}` : ""}${x.local ? ` (${x.local})` : ""}`).join("; ")}.` : "Nenhuma perícia ou audiência agendada nos próximos 120 dias.",
        contratos.length ? `Contrato: ${dados.contratos[0]!.situacao}.` : "Sem contrato registrado pelo sistema.",
        fin.total_de_parcelas ? `Honorários: ${fin.pagas}/${fin.total_de_parcelas} parcelas pagas${fin.em_atraso.length ? `, ${fin.em_atraso.length} em atraso` : ""}.` : "Sem parcelas de honorários lançadas.",
        docs.length ? `Documentos recebidos: ${docs.map((d) => d.nome).slice(0, 6).join(", ")}.` : "Nenhum documento recebido registrado.",
      ];
      return { texto: linhas.join("\n"), dados };
    }),
  },
  {
    name: "andamento_do_processo", title: "Andamento do processo",
    description: "Andamento de um processo do cliente desta conversa: fase, últimas publicações do tribunal (resumo), prazos abertos e perícias/audiências do processo. Informe o número do processo (ou a pasta) quando o cliente tiver mais de um; com um só processo, pode omitir. Resuma em linguagem simples e NÃO dê opinião sobre o resultado.",
    inputSchema: { type: "object", properties: { processo: { type: "string", description: "Número do processo (CNJ ou parte dele) ou a pasta. Opcional se o cliente tem um só processo." } }, additionalProperties: false },
    executar: (tel, args) => comCliente(tel, (c) => {
      const todos = processosDo(c.id);
      if (todos.length === 0) return { texto: "O cliente não tem processo cadastrado no escritório.", dados: { encontrado: true, processos: [] } };
      const busca = String(args.processo ?? "").replace(/\D/g, "") || String(args.processo ?? "").trim().toLowerCase();
      let alvo = todos.length === 1 ? todos[0] : todos.find((p) => busca && (p.numero.replace(/\D/g, "").includes(busca) || p.pasta.toLowerCase() === busca));
      if (!alvo && todos.filter((p) => p.status === "ativo").length === 1 && !busca) alvo = todos.find((p) => p.status === "ativo");
      if (!alvo) return { texto: `O cliente tem ${todos.length} processos. Pergunte de qual ele quer saber: ${todos.slice(0, 8).map((p) => `${p.numero}${p.area ? ` (${p.area})` : ""}`).join("; ")}.`, dados: { precisa_escolher: true, processos: todos.map(processoView) } };
      const bruto = andamentoDoProcesso(alvo.id);
      const a = {
        monitorado: bruto.monitorado, publicacoes_nao_lidas: bruto.publicacoes_nao_lidas,
        ultimas_publicacoes: bruto.ultimas_publicacoes as { data_disponibilizacao: string; tipo_documento: string; orgao: string; resumo: string }[],
        prazos_abertos: bruto.prazos_abertos as { descricao: string; termino: string | null; status: string }[],
        pericias: bruto.pericias as { tipo: string; data: string; horario: string | null; local: string | null; passada: boolean }[],
      };
      const dados = {
        processo: processoView(alvo), monitorado_no_tribunal: a.monitorado, publicacoes_nao_lidas_pela_equipe: a.publicacoes_nao_lidas,
        ultimas_publicacoes: a.ultimas_publicacoes.slice(0, 5).map((x) => ({ data: dia(x.data_disponibilizacao), tipo: x.tipo_documento, orgao: x.orgao, resumo: x.resumo })),
        prazos_abertos: a.prazos_abertos.slice(0, 6).map((x) => ({ descricao: x.descricao, termino: dia(x.termino), situacao: x.status })),
        pericias_e_audiencias: a.pericias.filter((x) => !x.passada).map((x) => ({ tipo: /audi[eê]ncia/i.test(`${x.tipo}`) ? "Audiência" : x.tipo || "Perícia", data: dia(x.data), horario: x.horario || "", local: x.local || "" })),
      };
      const partes = [
        `Processo ${alvo.numero}${alvo.area ? ` — ${alvo.area}` : ""}${alvo.orgao ? `, ${alvo.orgao}` : ""}. Fase: ${alvo.fase || "não informada"}. Situação: ${alvo.status}.`,
        dados.ultimas_publicacoes.length ? `Últimas publicações: ${dados.ultimas_publicacoes.slice(0, 3).map((x) => `${x.data} (${x.tipo}): ${x.resumo}`).join(" | ")}` : "Nenhuma publicação do tribunal registrada ainda.",
        dados.prazos_abertos.length ? `Prazos abertos: ${dados.prazos_abertos.map((x) => `${x.descricao} até ${x.termino}`).join("; ")}.` : "",
        dados.pericias_e_audiencias.length ? `Agendado: ${dados.pericias_e_audiencias.map((x) => `${x.tipo} em ${x.data}${x.horario ? ` às ${x.horario}` : ""}`).join("; ")}.` : "",
      ].filter(Boolean);
      return { texto: partes.join("\n"), dados };
    }),
  },
  {
    name: "proximos_compromissos", title: "Perícias, audiências e agendamentos",
    description: "Perícias e audiências agendadas do cliente desta conversa (data, horário, local, perito) nos próximos dias. Use quando o cliente perguntar sobre data de perícia ou audiência, ou para lembrá-lo de um compromisso. Argumento opcional: dias (padrão 120).",
    inputSchema: { type: "object", properties: { dias: { type: "integer", minimum: 1, maximum: 730, description: "Janela em dias a partir de hoje (padrão 120)." } }, additionalProperties: false },
    executar: (tel, args) => comCliente(tel, (c) => {
      const dias = Math.min(730, Math.max(1, Math.trunc(Number(args.dias) || 120)));
      const lista = compromissosDe(c.id, dias);
      return { texto: lista.length ? lista.map((x) => `${x.tipo} em ${x.data}${x.horario ? ` às ${x.horario}` : ""}${x.local ? `, ${x.local}` : ""}${x.perito ? `, perito(a): ${x.perito}` : ""}${x.processo ? `, processo ${x.processo}` : ""}`).join("\n") : `Nenhuma perícia ou audiência agendada nos próximos ${dias} dias.`, dados: { compromissos: lista, janela_dias: dias } };
    }),
  },
  {
    name: "financeiro_do_cliente", title: "Honorários e parcelas",
    description: "Situação dos honorários do cliente desta conversa: parcelas pagas, em atraso e as próximas a vencer (valor e vencimento). Use só se o cliente perguntar sobre pagamentos. Não negocie valores: isso é com a equipe.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    executar: (tel) => comCliente(tel, (c) => {
      const f = financeiroDe(c.id);
      if (f.total_de_parcelas === 0) return { texto: "Não há parcelas de honorários lançadas para este cliente.", dados: f };
      return { texto: `${f.pagas} de ${f.total_de_parcelas} parcelas pagas.${f.em_atraso.length ? ` Em atraso: ${f.em_atraso.map((x) => `${x.valor} (venc. ${x.vencimento})`).join("; ")}.` : " Nenhuma em atraso."}${f.a_vencer.length ? ` Próximas: ${f.a_vencer.slice(0, 3).map((x) => `${x.valor} em ${x.vencimento}`).join("; ")}.` : ""}`, dados: f };
    }),
  },
  {
    name: "documentos_do_cliente", title: "Documentos recebidos",
    description: "Lista os documentos que o escritório já recebeu deste cliente (nome, tipo e data), para saber o que falta pedir. Não abre o conteúdo dos arquivos.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    executar: (tel) => comCliente(tel, (c) => {
      const lista = arquivosDe(c.id).map((a) => ({ nome: a.nome, categoria: a.categoria, recebido_em: dia(a.criado_em) }));
      return { texto: lista.length ? `Documentos recebidos (${lista.length}): ${lista.slice(0, 20).map((d) => `${d.nome}${d.categoria ? ` [${d.categoria}]` : ""} (${d.recebido_em})`).join("; ")}.` : "Nenhum documento recebido registrado para este cliente.", dados: { documentos: lista } };
    }),
  },
];
