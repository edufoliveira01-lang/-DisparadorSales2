import { db } from "../../db";
import { ErroGestao } from "./erro";
import { valoresParaImpressao } from "./campos";
import { formatarCep, formatarDocumento, formatarPis, formatarCnj } from "./validacao";
import type { Pessoa } from "./pessoas";

const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const dataBr = (iso: string) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "");
const idade = (nasc: string) => {
  if (!nasc) return "";
  const n = new Date(`${nasc}T12:00:00Z`), h = new Date(Date.now() - 3 * 3600_000);
  let a = h.getUTCFullYear() - n.getUTCFullYear();
  if (h.getUTCMonth() < n.getUTCMonth() || (h.getUTCMonth() === n.getUTCMonth() && h.getUTCDate() < n.getUTCDate())) a--;
  return a >= 0 && a < 130 ? `${a} anos` : "";
};

type Celula = [rotulo: string, valor: string, largura?: number];
/** Linha de uma tabela de 12 colunas: cada célula é "rótulo + valor" ocupando uma fração da largura. */
const linha = (celulas: Celula[]) => {
  const pesos = celulas.map((c) => c[2] ?? 12 / celulas.length);
  const total = pesos.reduce((a, b) => a + b, 0) || 12;
  let acumulado = 0, anterior = 0;
  const colunas = pesos.map((w) => { acumulado += w; const ate = Math.round((acumulado / total) * 12); const n = Math.max(1, ate - anterior); anterior = ate; return n; });
  return `<tr>${celulas.map(([r, v], i) => `<td colspan="${colunas[i]}"><span class="r">${esc(r)}</span><span class="v">${esc(v) || "&nbsp;"}</span></td>`).join("")}</tr>`;
};
const secao = (titulo: string, corpo: string) => `<table class="g"><tr><th colspan="12">${esc(titulo)}</th></tr>${corpo}</table>`;

/**
 * Ficha de cadastro para imprimir (A4), no estilo de formulário com quadros e faixas de seção.
 * Senhas só saem quando `comSenhas` é verdadeiro (e a rota registra isso na auditoria).
 */
export function fichaDeCadastroHtml(pessoaId: number, opcoes: { comSenhas: boolean; imprimir: boolean; emitidaPor: string; titulo?: string }): string {
  const p = db.prepare("SELECT * FROM gestao_pessoas WHERE id=?").get(pessoaId) as Pessoa | undefined;
  if (!p) throw new ErroGestao("Pessoa não encontrada.", 404);
  const processos = db.prepare("SELECT pr.numero,pr.pasta,pr.tribunal,pr.titulo,pr.status,g.papel FROM gestao_partes g JOIN gestao_processos pr ON pr.id=g.processo_id WHERE g.pessoa_id=? ORDER BY pr.criado_em DESC LIMIT 12").all(pessoaId) as { numero: string; pasta: string; tribunal: string; titulo: string; status: string; papel: string }[];
  const personalizados = valoresParaImpressao("pessoa", pessoaId, opcoes.comSenhas);
  const agora = new Date(Date.now() - 3 * 3600_000);
  const stamp = `${String(agora.getUTCDate()).padStart(2, "0")}/${String(agora.getUTCMonth() + 1).padStart(2, "0")}/${agora.getUTCFullYear()} ${String(agora.getUTCHours()).padStart(2, "0")}:${String(agora.getUTCMinutes()).padStart(2, "0")}`;
  const juridica = Boolean(p.pessoa_juridica);

  const grupos = new Map<string, { campo: { nome: string }; valor: string }[]>();
  for (const x of personalizados) { const g = x.campo.grupo || "Dados complementares"; (grupos.get(g) || grupos.set(g, []).get(g)!).push(x); }
  const blocoCampos = [...grupos].map(([nome, itens]) => {
    const linhas: string[] = [];
    for (let i = 0; i < itens.length; i += 2) {
      const par = itens.slice(i, i + 2);
      linhas.push(linha(par.map((x): Celula => [x.campo.nome, x.valor, par.length === 1 ? 12 : 6])));
    }
    return secao(nome.toUpperCase(), linhas.join(""));
  }).join("");

  const tabProcessos = processos.length
    ? secao("PROCESSOS VINCULADOS", `<tr><td colspan="12" class="sem"><table class="i"><tr><th>Pasta</th><th>Número</th><th>Tribunal</th><th>Papel</th><th>Situação</th></tr>${processos.map((x) => `<tr><td>${esc(x.pasta)}</td><td>${esc(formatarCnj(x.numero))}</td><td>${esc(x.tribunal)}</td><td>${esc(x.papel)}</td><td>${esc(x.status)}</td></tr>`).join("")}</table></td></tr>`)
    : "";
  const pautas = Array.from({ length: 9 }, () => `<tr><td colspan="12" class="pauta">&nbsp;</td></tr>`).join("");

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Ficha de cadastro — ${esc(p.nome)}</title>
<style>
@page { size: A4; margin: 9mm; }
* { box-sizing: border-box; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 10.5px; color: #000; margin: 0; }
.cab { width: 100%; border-collapse: collapse; border: 2px solid #000; margin-bottom: 0; }
.cab td { border: 0; vertical-align: middle; }
.foto { width: 3.4cm; height: 3.4cm; border: 2px solid #000; text-align: center; color: #888; font-size: 9px; }
.titulo { font-size: 20px; font-weight: 700; text-align: center; letter-spacing: .3px; }
.sub { text-align: center; font-size: 10px; color: #333; margin-top: 3px; }
.meta { width: 4.2cm; font-size: 10px; text-align: right; }
table.g { width: 100%; border-collapse: collapse; table-layout: fixed; border: 1.5px solid #000; border-top: 0; }
table.g td, table.g th { border: 1px solid #000; padding: 3px 5px; vertical-align: top; }
table.g th { background: #d9d9d9; text-align: center; font-size: 10px; letter-spacing: .6px; padding: 2px; }
.r { display: block; font-size: 8px; font-weight: 700; text-transform: uppercase; color: #333; }
.v { display: block; font-size: 11.5px; min-height: 14px; word-break: break-word; }
td.sem { padding: 0; }
table.i { width: 100%; border-collapse: collapse; }
table.i th, table.i td { border: 0; border-top: 1px solid #999; padding: 3px 5px; text-align: left; font-size: 10px; background: none; letter-spacing: 0; }
td.pauta { height: 20px; }
.rodape { margin-top: 6px; font-size: 8.5px; color: #444; display: flex; justify-content: space-between; }
@media screen { body { background: #eee; padding: 12px; } .folha { background: #fff; max-width: 190mm; margin: 0 auto; padding: 9mm; box-shadow: 0 1px 6px rgba(0,0,0,.25); } }
</style></head><body><div class="folha">
<table class="cab"><tr><td style="width:3.8cm;padding:4px"><div class="foto"><br><br>FOTO 3x4<br>/ LOGO</div></td>
<td><div class="titulo">${esc(opcoes.titulo || "FICHA PROCESSUAL")}</div><div class="sub">Ficha de cadastro do ${juridica ? "cliente (pessoa jurídica)" : "cliente"}</div></td>
<td class="meta">Cadastro nº <b>${p.id}</b><br>Em ${esc(dataBr(p.criado_em))}${processos[0] ? `<br>Pasta <b>${esc(processos[0].pasta)}</b>` : ""}</td></tr></table>
${secao("DADOS DE IDENTIFICAÇÃO", [
    linha([[juridica ? "Razão social" : "Nome", p.nome]]),
    linha([["Nasc.", dataBr(p.data_nascimento), 3], ["Idade", idade(p.data_nascimento), 2], ["RG", p.rg, 3], [juridica ? "CNPJ" : "CPF", formatarDocumento(p.documento), 4]]),
    linha([["Escolaridade", p.escolaridade, 4], ["Est. civil", p.estado_civil, 4], ["PIS/NIT", formatarPis(p.pis), 4]]),
    linha([["Profissão", p.profissao]]),
    linha([["Mãe", p.nome_mae]]),
    linha([["Filiação", p.filiacao]]),
  ].join(""))}
${secao("ENDEREÇO", [
    linha([["Rua/Av.", p.logradouro, 8], ["Nº", p.numero, 1.5], ["Compl.", p.complemento, 2.5]]),
    linha([["Bairro", p.bairro, 4], ["Cidade", p.cidade, 5], ["UF", p.uf, 1], ["CEP", formatarCep(p.cep), 2]]),
  ].join(""))}
${secao("CONTATO", linha([["Telefone / WhatsApp", p.telefone, 4], ["Telefone 2", p.telefone2, 3], ["E-mail", p.email, 5]]))}
${blocoCampos}${tabProcessos}
${secao("OBSERVAÇÕES", `<tr><td colspan="12"><span class="v">${esc(p.observacoes) || "&nbsp;"}</span></td></tr>${pautas}`)}
<div class="rodape"><span>Impressa em ${stamp} por ${esc(opcoes.emitidaPor)}</span><span>${opcoes.comSenhas ? "CONTÉM SENHAS — guarde com cuidado" : "Senhas omitidas"}</span></div>
</div>${opcoes.imprimir ? "<script>window.addEventListener('load',function(){setTimeout(function(){window.print()},250)})</script>" : ""}</body></html>`;
}
