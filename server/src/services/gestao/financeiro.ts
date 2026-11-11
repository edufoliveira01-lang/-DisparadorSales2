import { db } from "../../db";
import { hojeSaoPaulo } from "../djen/cache";
import { ErroGestao } from "./pessoas";
import { dataValida } from "./validacao";

export const CATEGORIAS = ["honorarios", "custas", "despesa", "comissao", "repasse", "outro"] as const;
const txt = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const somarDias = (dia: string, n: number) => new Date(Date.parse(`${dia}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** Soma meses mantendo o dia (31 → último dia do mês seguinte quando necessário). */
export function somarMeses(dia: string, n: number): string {
  const [a, m, d] = dia.split("-").map(Number);
  const total = a * 12 + (m - 1) + n;
  const ano = Math.floor(total / 12), mes = (total % 12) + 1;
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${ano}-${String(mes).padStart(2, "0")}-${String(Math.min(d, ultimo)).padStart(2, "0")}`;
}
export function centavos(v: unknown, campo = "Valor"): number {
  if (v === undefined || v === null || v === "") throw new ErroGestao(`${campo}: informe um valor.`);
  const n = typeof v === "number" ? v : Number(String(v).replace(/[R$\s]/g, "").replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(n) || n <= 0 || n > 1e10) throw new ErroGestao(`${campo} inválido: informe um valor maior que zero.`);
  return Math.round(n * 100);
}
const data = (v: unknown, campo: string, obrigatoria = true) => {
  const s = txt(v, 10);
  if (!s) { if (obrigatoria) throw new ErroGestao(`${campo}: informe a data.`); return ""; }
  if (!dataValida(s)) throw new ErroGestao(`${campo} inválida (use AAAA-MM-DD).`);
  return s;
};

const SELECT = `SELECT l.*, pe.nome AS pessoa_nome, pe.telefone AS pessoa_telefone, pr.numero AS processo_numero, pr.pasta AS processo_pasta, COALESCE(NULLIF(u.display_name,''),u.username) AS beneficiario
  FROM gestao_lancamentos l LEFT JOIN gestao_pessoas pe ON pe.id=l.pessoa_id LEFT JOIN gestao_processos pr ON pr.id=l.processo_id LEFT JOIN users u ON u.id=l.beneficiario_user_id`;
type L = { id: number; tipo: string; cancelado: number; pago_em: string | null; vencimento: string; reembolsavel: number };
export const situacao = (l: L, hoje = hojeSaoPaulo()) => (l.cancelado ? "cancelado" : l.pago_em ? "pago" : l.vencimento < hoje ? "atrasado" : "aberto");
const visao = (l: any, hoje: string) => ({ ...l, status: situacao(l, hoje), reembolsavel: Boolean(l.reembolsavel), cancelado: Boolean(l.cancelado) });

function conferirVinculos(d: { pessoa?: number | null; processo?: number | null; benef?: number | null }) {
  if (d.pessoa && !db.prepare("SELECT id FROM gestao_pessoas WHERE id=?").get(d.pessoa)) throw new ErroGestao("Pessoa não encontrada.");
  if (d.processo && !db.prepare("SELECT id FROM gestao_processos WHERE id=?").get(d.processo)) throw new ErroGestao("Processo não encontrado.");
  if (d.benef && !db.prepare("SELECT id FROM users WHERE id=? AND active=1").get(d.benef)) throw new ErroGestao("Beneficiário não encontrado ou inativo.");
}
const idOuNulo = (v: unknown) => (v ? Number(v) || null : null);

export function listarLancamentos(f: Record<string, string | number | undefined>) {
  const hoje = hojeSaoPaulo();
  const onde: string[] = []; const par: unknown[] = [];
  if (f.tipo === "receber" || f.tipo === "pagar") { onde.push("l.tipo=?"); par.push(f.tipo); }
  if (f.categoria && (CATEGORIAS as readonly string[]).includes(String(f.categoria))) { onde.push("l.categoria=?"); par.push(f.categoria); }
  const st = String(f.status ?? "");
  if (st === "aberto") { onde.push("l.cancelado=0 AND l.pago_em IS NULL AND l.vencimento>=?"); par.push(hoje); }
  else if (st === "atrasado") { onde.push("l.cancelado=0 AND l.pago_em IS NULL AND l.vencimento<?"); par.push(hoje); }
  else if (st === "pendentes") onde.push("l.cancelado=0 AND l.pago_em IS NULL");
  else if (st === "pago") onde.push("l.cancelado=0 AND l.pago_em IS NOT NULL");
  else if (st === "cancelado") onde.push("l.cancelado=1");
  if (f.de && dataValida(String(f.de))) { onde.push("l.vencimento>=?"); par.push(f.de); }
  if (f.ate && dataValida(String(f.ate))) { onde.push("l.vencimento<=?"); par.push(f.ate); }
  for (const [k, c] of [["pessoa", "l.pessoa_id"], ["processo", "l.processo_id"], ["contrato", "l.contrato_id"]] as const) if (f[k] && Number(f[k])) { onde.push(`${c}=?`); par.push(Number(f[k])); }
  const busca = txt(f.busca, 100);
  if (busca) { onde.push("(l.descricao LIKE ? ESCAPE '\\' OR pe.nome LIKE ? ESCAPE '\\' OR pr.numero LIKE ?)"); const like = `%${busca.replace(/[\\%_]/g, "\\$&")}%`; par.push(like, like, like); }
  const limite = Math.min(100, Math.max(1, Math.trunc(Number(f.limite) || 30)));
  const pagina = Math.max(1, Math.trunc(Number(f.pagina) || 1));
  const w = onde.length ? `WHERE ${onde.join(" AND ")}` : "";
  const juncoes = "FROM gestao_lancamentos l LEFT JOIN gestao_pessoas pe ON pe.id=l.pessoa_id LEFT JOIN gestao_processos pr ON pr.id=l.processo_id";
  const tot = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(l.valor_centavos),0) soma ${juncoes} ${w}`).get(...par) as { n: number; soma: number };
  const linhas = db.prepare(`${SELECT} ${w} ORDER BY l.vencimento DESC, l.id DESC LIMIT ? OFFSET ?`).all(...par, limite, (pagina - 1) * limite);
  return { total: tot.n, soma_centavos: tot.soma, pagina, limite, itens: linhas.map((l) => visao(l, hoje)) };
}
export function obterLancamento(id: number) {
  const l = db.prepare(`${SELECT} WHERE l.id=?`).get(id);
  if (!l) throw new ErroGestao("Lançamento não encontrado.", 404);
  return visao(l, hojeSaoPaulo());
}

export function criarLancamentos(d: Record<string, unknown>, userId: number) {
  const tipo = String(d.tipo);
  if (tipo !== "receber" && tipo !== "pagar") throw new ErroGestao("Escolha se é a receber ou a pagar.");
  const categoria = String(d.categoria ?? (tipo === "receber" ? "honorarios" : "despesa"));
  if (!(CATEGORIAS as readonly string[]).includes(categoria)) throw new ErroGestao("Categoria inválida.");
  const descricao = txt(d.descricao, 200);
  if (descricao.length < 3) throw new ErroGestao("Descreva o lançamento.");
  const total = centavos(d.valor);
  const primeiro = data(d.vencimento, "Vencimento");
  const parcelas = d.parcelas === undefined || d.parcelas === "" ? 1 : Number(d.parcelas);
  if (!Number.isInteger(parcelas) || parcelas < 1 || parcelas > 120) throw new ErroGestao("Número de parcelas inválido (1 a 120).");
  const vinc = { pessoa: idOuNulo(d.pessoa_id), processo: idOuNulo(d.processo_id), benef: idOuNulo(d.beneficiario_user_id) };
  conferirVinculos(vinc);
  return db.transaction(() => criarParcelas({ tipo, categoria, descricao, total, primeiro, parcelas, ...vinc, contrato: null, reembolsavel: d.reembolsavel ? 1 : 0, observacoes: txt(d.observacoes, 2000), userId }))();
}

function criarParcelas(p: { tipo: string; categoria: string; descricao: string; total: number; primeiro: string; parcelas: number; pessoa: number | null; processo: number | null; benef: number | null; contrato: number | null; reembolsavel: number; observacoes: string; userId: number }) {
  const base = Math.floor(p.total / p.parcelas), resto = p.total - base * p.parcelas;
  const ids: number[] = [];
  for (let i = 0; i < p.parcelas; i++) {
    const valor = base + (i === p.parcelas - 1 ? resto : 0); // diferença de centavos vai para a última parcela
    const r = db.prepare(`INSERT INTO gestao_lancamentos(tipo,categoria,descricao,valor_centavos,vencimento,pessoa_id,processo_id,contrato_id,beneficiario_user_id,reembolsavel,parcela_numero,parcela_total,observacoes,criado_por) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(p.tipo, p.categoria, p.parcelas > 1 ? `${p.descricao} (${i + 1}/${p.parcelas})` : p.descricao, valor, somarMeses(p.primeiro, i), p.pessoa, p.processo, p.contrato, p.benef, p.reembolsavel, p.parcelas > 1 ? i + 1 : null, p.parcelas > 1 ? p.parcelas : null, p.observacoes, p.userId);
    ids.push(Number(r.lastInsertRowid));
  }
  return ids.map(obterLancamento);
}

export function atualizarLancamento(id: number, d: Record<string, unknown>, quem?: Quem) {
  const atual = obterLancamento(id);
  if (atual.pago_em) throw new ErroGestao("Lançamento já baixado: estorne a baixa antes de alterar.", 409);
  const descricao = txt(d.descricao ?? atual.descricao, 200);
  if (descricao.length < 3) throw new ErroGestao("Descreva o lançamento.");
  const categoria = String(d.categoria ?? atual.categoria);
  if (!(CATEGORIAS as readonly string[]).includes(categoria)) throw new ErroGestao("Categoria inválida.");
  const valor = d.valor === undefined ? atual.valor_centavos : centavos(d.valor);
  const venc = d.vencimento === undefined ? atual.vencimento : data(d.vencimento, "Vencimento");
  const vinc = { pessoa: d.pessoa_id === undefined ? atual.pessoa_id : idOuNulo(d.pessoa_id), processo: d.processo_id === undefined ? atual.processo_id : idOuNulo(d.processo_id), benef: d.beneficiario_user_id === undefined ? atual.beneficiario_user_id : idOuNulo(d.beneficiario_user_id) };
  conferirVinculos(vinc);
  const mudancas = [venc !== atual.vencimento ? `vencimento ${dia(atual.vencimento)} → ${dia(venc)}` : "", valor !== atual.valor_centavos ? `valor ${reais(atual.valor_centavos)} → ${reais(valor)}` : ""].filter(Boolean);
  if (mudancas.length) registrar(id, "alterado", `Alterado: ${mudancas.join("; ")}.`, quem);
  db.prepare("UPDATE gestao_lancamentos SET descricao=?,categoria=?,valor_centavos=?,vencimento=?,pessoa_id=?,processo_id=?,beneficiario_user_id=?,reembolsavel=?,observacoes=?,atualizado_em=CURRENT_TIMESTAMP WHERE id=?")
    .run(descricao, categoria, valor, venc, vinc.pessoa, vinc.processo, vinc.benef, (d.reembolsavel === undefined ? (atual.reembolsavel ? 1 : 0) : d.reembolsavel ? 1 : 0), txt(d.observacoes ?? atual.observacoes, 2000), id);
  return obterLancamento(id);
}

function atualizarContratoQuitado(contratoId: number | null) {
  if (!contratoId) return;
  const abertos = (db.prepare("SELECT COUNT(*) n FROM gestao_lancamentos WHERE contrato_id=? AND cancelado=0 AND pago_em IS NULL").get(contratoId) as { n: number }).n;
  const c = db.prepare("SELECT status FROM gestao_contratos WHERE id=?").get(contratoId) as { status: string } | undefined;
  if (!c || c.status === "cancelado") return;
  db.prepare("UPDATE gestao_contratos SET status=?,atualizado_em=CURRENT_TIMESTAMP WHERE id=?").run(abertos === 0 ? "quitado" : "ativo", contratoId);
}

const reais = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (d: string) => d.split("-").reverse().join("/");
type Quem = { id: number | null; nome: string } | undefined;
function registrar(lancamentoId: number, acao: string, detalhe: string, quem?: Quem) {
  db.prepare("INSERT INTO gestao_lancamentos_historico(lancamento_id,acao,detalhe,user_id,autor) VALUES (?,?,?,?,?)").run(lancamentoId, acao, detalhe.slice(0, 500), quem?.id ?? null, quem?.nome ?? "");
}
/** O que mudou neste lançamento (baixa parcial, nova data, valor…), do mais recente ao mais antigo. */
export function historicoDoLancamento(id: number) {
  obterLancamento(id);
  return db.prepare("SELECT id,acao,detalhe,autor,criado_em FROM gestao_lancamentos_historico WHERE lancamento_id=? ORDER BY id DESC LIMIT 100").all(id);
}

export function baixarLancamento(id: number, d: Record<string, unknown>, quem?: Quem) {
  const l = obterLancamento(id);
  if (l.cancelado) throw new ErroGestao("Lançamento cancelado.", 409);
  if (l.pago_em) throw new ErroGestao("Este lançamento já foi baixado.", 409);
  const pagoEm = data(d.pago_em || hojeSaoPaulo(), "Data do pagamento");
  if (pagoEm > somarDias(hojeSaoPaulo(), 1)) throw new ErroGestao("A data do pagamento não pode ser futura.");
  const valor = d.valor_pago === undefined || d.valor_pago === "" ? l.valor_centavos : centavos(d.valor_pago, "Valor pago");
  // Pagamento PARCIAL: o que foi pago fecha esta parcela e o que falta vira um lançamento novo (na data escolhida, por padrão um mês depois).
  // Sem `restante: "novo"`, só baixa o valor menor, sem criar o saldo (desconto combinado com o cliente; é o comportamento antigo da API).
  if (valor < l.valor_centavos && d.restante === "novo") {
    const falta = l.valor_centavos - valor;
    // padrão: o mesmo dia da parcela, no primeiro mês depois do pagamento
    let venc = d.vencimento_restante ? data(d.vencimento_restante, "Vencimento do restante") : somarMeses(l.vencimento, 1);
    if (!d.vencimento_restante) while (venc <= pagoEm) venc = somarMeses(venc, 1);
    db.transaction(() => {
      db.prepare("UPDATE gestao_lancamentos SET valor_centavos=?,pago_em=?,valor_pago_centavos=?,forma_pagamento=?,atualizado_em=CURRENT_TIMESTAMP WHERE id=?").run(valor, pagoEm, valor, txt(d.forma_pagamento, 40), id);
      const novo = db.prepare(`INSERT INTO gestao_lancamentos(tipo,categoria,descricao,valor_centavos,vencimento,pessoa_id,processo_id,contrato_id,beneficiario_user_id,reembolsavel,parcela_numero,parcela_total,observacoes,criado_por,origem_lancamento_id)
        SELECT tipo,categoria,descricao,?,?,pessoa_id,processo_id,contrato_id,beneficiario_user_id,reembolsavel,parcela_numero,parcela_total,?,criado_por,id FROM gestao_lancamentos WHERE id=?`)
        .run(falta, venc, `Saldo do pagamento parcial de ${dia(pagoEm)} (pago ${reais(valor)} de ${reais(l.valor_centavos)}).`, id);
      registrar(id, "baixa_parcial", `Pago ${reais(valor)} de ${reais(l.valor_centavos)} em ${dia(pagoEm)}. Saldo de ${reais(falta)} lançado para ${dia(venc)}.`, quem);
      registrar(Number(novo.lastInsertRowid), "saldo_criado", `Saldo de ${reais(falta)} do lançamento nº ${id}, vencimento ${dia(venc)}.`, quem);
    })();
    atualizarContratoQuitado(l.contrato_id);
    return { ...obterLancamento(id), saldo: { valor_centavos: falta, vencimento: venc } };
  }
  db.prepare("UPDATE gestao_lancamentos SET pago_em=?,valor_pago_centavos=?,forma_pagamento=?,atualizado_em=CURRENT_TIMESTAMP WHERE id=?").run(pagoEm, valor, txt(d.forma_pagamento, 40), id);
  if (valor !== l.valor_centavos) registrar(id, "baixa", `Baixado por ${reais(valor)} (previsto ${reais(l.valor_centavos)}) em ${dia(pagoEm)}.`, quem);
  atualizarContratoQuitado(l.contrato_id);
  return obterLancamento(id);
}
/**
 * Nova data de vencimento (aditamento). Com `cascata`, as parcelas seguintes ainda abertas do MESMO contrato andam junto:
 * se a mudança foi de mês (mesmo dia), cada uma anda o mesmo número de meses; senão, o mesmo número de dias.
 */
export function reprogramarVencimento(id: number, d: Record<string, unknown>, quem?: Quem) {
  const l = obterLancamento(id);
  if (l.cancelado || l.pago_em) throw new ErroGestao("Só dá para mudar a data de um lançamento em aberto.", 409);
  const novo = data(d.vencimento, "Nova data");
  if (novo === l.vencimento) throw new ErroGestao("A nova data é igual à atual.");
  const motivo = txt(d.motivo, 200);
  const cascata = Boolean(d.cascata) && Boolean(l.contrato_id);
  const [a1, m1, d1] = l.vencimento.split("-").map(Number), [a2, m2, d2] = novo.split("-").map(Number);
  const meses = (a2 * 12 + m2) - (a1 * 12 + m1);
  const porMes = d1 === d2 && meses !== 0;
  const dias = Math.round((Date.parse(`${novo}T12:00:00Z`) - Date.parse(`${l.vencimento}T12:00:00Z`)) / 86400000);
  const mover = (v: string) => (porMes ? somarMeses(v, meses) : somarDias(v, dias));
  let movidas = 0;
  db.transaction(() => {
    db.prepare("UPDATE gestao_lancamentos SET vencimento=?,atualizado_em=CURRENT_TIMESTAMP WHERE id=?").run(novo, id);
    registrar(id, "reprogramado", `Vencimento ${dia(l.vencimento)} → ${dia(novo)}${motivo ? `. Motivo: ${motivo}` : ""}.`, quem);
    if (cascata) {
      const seguintes = db.prepare("SELECT id,vencimento FROM gestao_lancamentos WHERE contrato_id=? AND id<>? AND cancelado=0 AND pago_em IS NULL AND vencimento>? ORDER BY vencimento").all(l.contrato_id, id, l.vencimento) as { id: number; vencimento: string }[];
      for (const s of seguintes) {
        const v = mover(s.vencimento);
        db.prepare("UPDATE gestao_lancamentos SET vencimento=?,atualizado_em=CURRENT_TIMESTAMP WHERE id=?").run(v, s.id);
        registrar(s.id, "reprogramado", `Vencimento ${dia(s.vencimento)} → ${dia(v)} (acompanhou a parcela nº ${id}).`, quem);
        movidas++;
      }
    }
  })();
  return { ...obterLancamento(id), parcelas_movidas: movidas };
}

export function estornarLancamento(id: number) {
  const l = obterLancamento(id);
  if (!l.pago_em) throw new ErroGestao("Este lançamento não está baixado.", 409);
  db.prepare("UPDATE gestao_lancamentos SET pago_em=NULL,valor_pago_centavos=NULL,forma_pagamento='',atualizado_em=CURRENT_TIMESTAMP WHERE id=?").run(id);
  atualizarContratoQuitado(l.contrato_id);
  return obterLancamento(id);
}
export function cancelarLancamento(id: number, cancelar: boolean) {
  const l = obterLancamento(id);
  if (cancelar && l.pago_em) throw new ErroGestao("Lançamento baixado: estorne a baixa antes de cancelar.", 409);
  db.prepare("UPDATE gestao_lancamentos SET cancelado=?,atualizado_em=CURRENT_TIMESTAMP WHERE id=?").run(cancelar ? 1 : 0, id);
  atualizarContratoQuitado(l.contrato_id);
  return obterLancamento(id);
}
export function excluirLancamento(id: number) {
  const l = obterLancamento(id);
  if (l.pago_em) throw new ErroGestao("Lançamento baixado: estorne a baixa antes de excluir.", 409);
  db.prepare("DELETE FROM gestao_lancamentos WHERE id=?").run(id);
  atualizarContratoQuitado(l.contrato_id);
  return { ok: true };
}

// ---------- contratos de honorários ----------
export function criarContrato(d: Record<string, unknown>, userId: number): Record<string, any> {
  const descricao = txt(d.descricao, 200);
  if (descricao.length < 3) throw new ErroGestao("Descreva o contrato.");
  const tipo = String(d.tipo ?? "parcelado");
  if (!["fixo", "parcelado", "exito", "misto"].includes(tipo)) throw new ErroGestao("Tipo de contrato inválido.");
  const pessoa = idOuNulo(d.pessoa_id), processo = idOuNulo(d.processo_id);
  if (!pessoa) throw new ErroGestao("Escolha o cliente do contrato.");
  conferirVinculos({ pessoa, processo });
  const exito = d.percentual_exito === undefined || d.percentual_exito === "" || d.percentual_exito === null ? null : Number(String(d.percentual_exito).replace(",", "."));
  if (exito !== null && (!Number.isFinite(exito) || exito <= 0 || exito > 100)) throw new ErroGestao("Percentual de êxito inválido (1 a 100).");
  if ((tipo === "exito" || tipo === "misto") && exito === null) throw new ErroGestao("Informe o percentual de êxito.");
  const temValor = tipo !== "exito" || (d.valor_total !== undefined && d.valor_total !== "");
  const total = temValor ? centavos(d.valor_total, "Valor do contrato") : 0;
  const parcelas = tipo === "fixo" ? 1 : d.parcelas === undefined || d.parcelas === "" ? 1 : Number(d.parcelas);
  if (!Number.isInteger(parcelas) || parcelas < 1 || parcelas > 120) throw new ErroGestao("Número de parcelas inválido (1 a 120).");
  const primeiro = total > 0 ? data(d.primeiro_vencimento, "Primeiro vencimento") : "";
  return db.transaction(() => {
    const r = db.prepare("INSERT INTO gestao_contratos(pessoa_id,processo_id,descricao,tipo,valor_total_centavos,percentual_exito,observacoes,criado_por) VALUES (?,?,?,?,?,?,?,?)")
      .run(pessoa, processo, descricao, tipo, total, exito === null ? null : Math.round(exito * 100), txt(d.observacoes, 2000), userId);
    const cid = Number(r.lastInsertRowid);
    const lancamentos = total > 0 ? criarParcelas({ tipo: "receber", categoria: "honorarios", descricao: `Honorários — ${descricao}`, total, primeiro, parcelas, pessoa, processo, benef: null, contrato: cid, reembolsavel: 0, observacoes: "", userId }) : [];
    return { ...obterContrato(cid), lancamentos };
  })();
}
export function obterContrato(id: number) {
  const c = db.prepare(`SELECT c.*, pe.nome AS pessoa_nome, pr.numero AS processo_numero, pr.pasta AS processo_pasta,
      (SELECT COALESCE(SUM(COALESCE(valor_pago_centavos,valor_centavos)),0) FROM gestao_lancamentos l WHERE l.contrato_id=c.id AND l.cancelado=0 AND l.pago_em IS NOT NULL) AS recebido_centavos,
      (SELECT COALESCE(SUM(valor_centavos),0) FROM gestao_lancamentos l WHERE l.contrato_id=c.id AND l.cancelado=0 AND l.pago_em IS NULL) AS em_aberto_centavos,
      (SELECT COUNT(*) FROM gestao_lancamentos l WHERE l.contrato_id=c.id AND l.cancelado=0 AND l.pago_em IS NULL AND l.vencimento<?) AS parcelas_atrasadas
    FROM gestao_contratos c LEFT JOIN gestao_pessoas pe ON pe.id=c.pessoa_id LEFT JOIN gestao_processos pr ON pr.id=c.processo_id WHERE c.id=?`).get(hojeSaoPaulo(), id);
  if (!c) throw new ErroGestao("Contrato não encontrado.", 404);
  return c as Record<string, any>;
}
export function listarContratos(f: { status?: string; pessoa?: string }) {
  const onde: string[] = []; const par: unknown[] = [];
  if (f.status && ["ativo", "quitado", "cancelado"].includes(f.status)) { onde.push("c.status=?"); par.push(f.status); }
  if (f.pessoa && Number(f.pessoa)) { onde.push("c.pessoa_id=?"); par.push(Number(f.pessoa)); }
  const ids = db.prepare(`SELECT c.id FROM gestao_contratos c ${onde.length ? "WHERE " + onde.join(" AND ") : ""} ORDER BY c.criado_em DESC, c.id DESC LIMIT 200`).all(...par) as { id: number }[];
  return ids.map((r) => obterContrato(r.id));
}
export function cancelarContrato(id: number) {
  obterContrato(id);
  db.transaction(() => {
    db.prepare("UPDATE gestao_lancamentos SET cancelado=1,atualizado_em=CURRENT_TIMESTAMP WHERE contrato_id=? AND pago_em IS NULL").run(id);
    db.prepare("UPDATE gestao_contratos SET status='cancelado',atualizado_em=CURRENT_TIMESTAMP WHERE id=?").run(id);
  })();
  return obterContrato(id);
}

// ---------- resumo e fluxo de caixa ----------
const mesValido = (m: unknown) => (/^\d{4}-(0[1-9]|1[0-2])$/.test(String(m)) ? String(m) : hojeSaoPaulo().slice(0, 7));
const fimDoMes = (mes: string) => somarMeses(`${mes}-01`, 1);

export function resumoFinanceiro(mesBruto?: unknown) {
  const mes = mesValido(mesBruto), ini = `${mes}-01`, fim = fimDoMes(mes), hoje = hojeSaoPaulo();
  const soma = (sql: string, ...p: unknown[]) => (db.prepare(sql).get(...p) as { v: number }).v;
  const ativo = "cancelado=0";
  const receber_previsto = soma(`SELECT COALESCE(SUM(valor_centavos),0) v FROM gestao_lancamentos WHERE tipo='receber' AND ${ativo} AND vencimento>=? AND vencimento<?`, ini, fim);
  const recebido = soma(`SELECT COALESCE(SUM(COALESCE(valor_pago_centavos,valor_centavos)),0) v FROM gestao_lancamentos WHERE tipo='receber' AND ${ativo} AND pago_em>=? AND pago_em<?`, ini, fim);
  const pagar_previsto = soma(`SELECT COALESCE(SUM(valor_centavos),0) v FROM gestao_lancamentos WHERE tipo='pagar' AND ${ativo} AND vencimento>=? AND vencimento<?`, ini, fim);
  const pago = soma(`SELECT COALESCE(SUM(COALESCE(valor_pago_centavos,valor_centavos)),0) v FROM gestao_lancamentos WHERE tipo='pagar' AND ${ativo} AND pago_em>=? AND pago_em<?`, ini, fim);
  return {
    mes, receber_previsto_centavos: receber_previsto, recebido_centavos: recebido, pagar_previsto_centavos: pagar_previsto, pago_centavos: pago, saldo_realizado_centavos: recebido - pago,
    inadimplencia_centavos: soma(`SELECT COALESCE(SUM(valor_centavos),0) v FROM gestao_lancamentos WHERE tipo='receber' AND ${ativo} AND pago_em IS NULL AND vencimento<?`, hoje),
    inadimplentes: soma(`SELECT COUNT(DISTINCT pessoa_id) v FROM gestao_lancamentos WHERE tipo='receber' AND ${ativo} AND pago_em IS NULL AND vencimento<? AND pessoa_id IS NOT NULL`, hoje),
    a_receber_30_dias_centavos: soma(`SELECT COALESCE(SUM(valor_centavos),0) v FROM gestao_lancamentos WHERE tipo='receber' AND ${ativo} AND pago_em IS NULL AND vencimento>=? AND vencimento<=?`, hoje, somarDias(hoje, 30)),
    a_pagar_30_dias_centavos: soma(`SELECT COALESCE(SUM(valor_centavos),0) v FROM gestao_lancamentos WHERE tipo='pagar' AND ${ativo} AND pago_em IS NULL AND vencimento<=?`, somarDias(hoje, 30)),
    custas_reembolsaveis_centavos: soma(`SELECT COALESCE(SUM(valor_centavos),0) v FROM gestao_lancamentos WHERE tipo='pagar' AND categoria='custas' AND reembolsavel=1 AND ${ativo} AND pago_em IS NOT NULL`),
    /** Quem mais deve (parcelas a receber vencidas e não pagas), do maior valor para o menor: a lista de quem cobrar primeiro. */
    maiores_devedores: db.prepare(`SELECT l.pessoa_id, pe.nome, pe.telefone, SUM(l.valor_centavos) AS total_centavos, COUNT(*) AS parcelas, MIN(l.vencimento) AS mais_antigo
      FROM gestao_lancamentos l JOIN gestao_pessoas pe ON pe.id=l.pessoa_id WHERE l.tipo='receber' AND l.cancelado=0 AND l.pago_em IS NULL AND l.vencimento<?
      GROUP BY l.pessoa_id ORDER BY total_centavos DESC LIMIT 10`).all(hoje),
    por_categoria: db.prepare(`SELECT tipo, categoria, COALESCE(SUM(CASE WHEN pago_em IS NOT NULL THEN COALESCE(valor_pago_centavos,valor_centavos) ELSE 0 END),0) AS realizado_centavos, COALESCE(SUM(valor_centavos),0) AS previsto_centavos
      FROM gestao_lancamentos WHERE ${ativo} AND vencimento>=? AND vencimento<? GROUP BY tipo, categoria ORDER BY tipo, categoria`).all(ini, fim),
    comissoes_e_repasses: db.prepare(`SELECT COALESCE(NULLIF(u.display_name,''),u.username,'Sem beneficiário') AS beneficiario, l.categoria,
      COALESCE(SUM(l.valor_centavos),0) AS previsto_centavos, COALESCE(SUM(CASE WHEN l.pago_em IS NOT NULL THEN COALESCE(l.valor_pago_centavos,l.valor_centavos) ELSE 0 END),0) AS pago_centavos
      FROM gestao_lancamentos l LEFT JOIN users u ON u.id=l.beneficiario_user_id WHERE l.tipo='pagar' AND l.categoria IN ('comissao','repasse') AND l.cancelado=0 AND l.vencimento>=? AND l.vencimento<? GROUP BY beneficiario, l.categoria ORDER BY beneficiario`).all(ini, fim),
  };
}

/** Fluxo de caixa mês a mês: de 5 meses atrás até N meses à frente, previsto x realizado. */
export function fluxoDeCaixa(mesesAfrente = 6) {
  const atual = hojeSaoPaulo().slice(0, 7) + "-01";
  const n = Math.min(12, Math.max(0, Math.trunc(mesesAfrente) || 6));
  const meses: ReturnType<typeof linhaMes>[] = [];
  const linhaMes = (ini: string) => {
    const fim = somarMeses(ini, 1);
    const v = (sql: string) => (db.prepare(sql).get(ini, fim) as { v: number }).v;
    const prev = (tipo: string) => v(`SELECT COALESCE(SUM(valor_centavos),0) v FROM gestao_lancamentos WHERE tipo='${tipo}' AND cancelado=0 AND vencimento>=? AND vencimento<?`);
    const real = (tipo: string) => v(`SELECT COALESCE(SUM(COALESCE(valor_pago_centavos,valor_centavos)),0) v FROM gestao_lancamentos WHERE tipo='${tipo}' AND cancelado=0 AND pago_em>=? AND pago_em<?`);
    const r = real("receber"), p = real("pagar");
    return { mes: ini.slice(0, 7), receber_previsto_centavos: prev("receber"), recebido_centavos: r, pagar_previsto_centavos: prev("pagar"), pago_centavos: p, saldo_centavos: r - p };
  };
  for (let i = -5; i <= n; i++) meses.push(linhaMes(somarMeses(atual, i)));
  return meses;
}

/** Situação financeira de uma pessoa: totais, contratos e lançamentos (para a aba Financeiro do cadastro). */
export function financeiroDaPessoa(pessoaId: number) {
  const pe = db.prepare("SELECT id,nome FROM gestao_pessoas WHERE id=?").get(pessoaId) as { id: number; nome: string } | undefined;
  if (!pe) throw new ErroGestao("Pessoa não encontrada.", 404);
  const hoje = hojeSaoPaulo();
  const v = (sql: string, ...p: unknown[]) => (db.prepare(sql).get(...p) as { v: number }).v;
  const base = "FROM gestao_lancamentos WHERE pessoa_id=? AND tipo='receber' AND cancelado=0";
  return {
    pessoa: pe,
    totais: {
      contratado_centavos: v("SELECT COALESCE(SUM(valor_total_centavos),0) v FROM gestao_contratos WHERE pessoa_id=? AND status<>'cancelado'", pessoaId),
      recebido_centavos: v(`SELECT COALESCE(SUM(COALESCE(valor_pago_centavos,valor_centavos)),0) v ${base} AND pago_em IS NOT NULL`, pessoaId),
      em_aberto_centavos: v(`SELECT COALESCE(SUM(valor_centavos),0) v ${base} AND pago_em IS NULL`, pessoaId),
      atrasado_centavos: v(`SELECT COALESCE(SUM(valor_centavos),0) v ${base} AND pago_em IS NULL AND vencimento<?`, pessoaId, hoje),
      proximo_vencimento: (db.prepare(`SELECT MIN(vencimento) d ${base} AND pago_em IS NULL`).get(pessoaId) as { d: string | null }).d,
    },
    contratos: listarContratos({ pessoa: String(pessoaId) }),
    lancamentos: listarLancamentos({ pessoa: pessoaId, status: "", limite: 50 }).itens,
  };
}
