import { db } from "../../db";
import { ErroGestao } from "./erro";
import { valoresParaImpressao } from "./campos";
import { formatarCep, formatarDocumento, formatarPis, formatarCnj } from "./validacao";
import type { Pessoa } from "./pessoas";
import { comoDataUri, fotoDaPessoa, lerConfig, logoDaFicha, type ConfigFicha } from "./fichaConfig";
import { listarCampos } from "./campos";

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

interface DadosFicha {
  pessoa: Pessoa; processos: { numero: string; pasta: string; tribunal: string; titulo: string; status: string; papel: string }[];
  personalizados: { campo: { nome: string; grupo: string }; valor: string }[]; foto: string | null; logo: string | null;
}
interface OpcoesFicha { comSenhas: boolean; imprimir: boolean; emitidaPor: string; amostra?: boolean }

/** Monta a ficha (A4) com o modelo configurado: cabeçalho, seções ligadas/desligadas, foto, assinatura e rodapé. */
export function renderizarFicha(d: DadosFicha, cfg: ConfigFicha, o: OpcoesFicha): string {
  const { pessoa: p, processos, personalizados } = d;
  const agora = new Date(Date.now() - 3 * 3600_000);
  const stamp = `${String(agora.getUTCDate()).padStart(2, "0")}/${String(agora.getUTCMonth() + 1).padStart(2, "0")}/${agora.getUTCFullYear()} ${String(agora.getUTCHours()).padStart(2, "0")}:${String(agora.getUTCMinutes()).padStart(2, "0")}`;
  const juridica = Boolean(p.pessoa_juridica);

  const grupos = new Map<string, { campo: { nome: string }; valor: string }[]>();
  for (const x of personalizados) { const g = x.campo.grupo || "Dados complementares"; (grupos.get(g) || grupos.set(g, []).get(g)!).push(x); }
  const blocoCampos = cfg.secoes.campos ? [...grupos].map(([nome, itens]) => {
    const linhas: string[] = [];
    for (let i = 0; i < itens.length; i += 2) {
      const par = itens.slice(i, i + 2);
      linhas.push(linha(par.map((x): Celula => [x.campo.nome, x.valor, par.length === 1 ? 12 : 6])));
    }
    return secao(nome.toUpperCase(), linhas.join(""));
  }).join("") : "";

  const tabProcessos = cfg.secoes.processos && processos.length
    ? secao("PROCESSOS VINCULADOS", `<tr><td colspan="12" class="sem"><table class="i"><tr><th>Pasta</th><th>Número</th><th>Tribunal</th><th>Papel</th><th>Situação</th></tr>${processos.map((x) => `<tr><td>${esc(x.pasta)}</td><td>${esc(formatarCnj(x.numero))}</td><td>${esc(x.tribunal)}</td><td>${esc(x.papel)}</td><td>${esc(x.status)}</td></tr>`).join("")}</table></td></tr>`)
    : "";
  const pautas = Array.from({ length: cfg.linhas_observacoes }, () => `<tr><td colspan="12" class="pauta">&nbsp;</td></tr>`).join("");
  const caixaFoto = cfg.mostrar_foto
    ? `<td style="width:3.8cm;padding:4px"><div class="foto">${d.foto ? `<img src="${d.foto}" alt="Foto">` : "<br><br>FOTO 3x4"}</div></td>`
    : "";
  const alinhaLogo = cfg.logo_alinhamento;
  const logoCelula = d.logo && alinhaLogo !== "center" ? `<td style="width:3cm;padding:4px;text-align:center"><img class="logo" src="${d.logo}" alt="Logotipo"></td>` : "";
  const logoNoTitulo = d.logo && alinhaLogo === "center" ? `<div style="text-align:center;margin-bottom:2px"><img class="logo" src="${d.logo}" alt="Logotipo"></div>` : "";
  const logo = alinhaLogo === "left" ? logoCelula : "";
  const logoDireita = alinhaLogo === "right" ? logoCelula : "";
  const cabecalhoTexto = [cfg.nome_escritorio, ...cfg.cabecalho_linhas].filter(Boolean);

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Ficha de cadastro — ${esc(p.nome)}</title>
<style>
@page { size: A4; margin: 9mm; }
* { box-sizing: border-box; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 10.5px; color: #000; margin: 0; }
.cab { width: 100%; border-collapse: collapse; border: 2px solid #000; margin-bottom: 0; }
.cab td { border: 0; vertical-align: middle; }
.foto { width: 3.4cm; height: 3.4cm; border: 2px solid #000; text-align: center; color: #888; font-size: 9px; overflow: hidden; }
.foto img { width: 100%; height: 100%; object-fit: cover; display: block; }
.logo { max-width: 2.8cm; max-height: 2.8cm; object-fit: contain; }
.titulo { font-size: 20px; font-weight: 700; text-align: center; letter-spacing: .3px; }
.sub { text-align: center; font-size: 10px; color: #333; margin-top: 3px; }
.esc { text-align: center; font-size: 9px; color: #222; margin-top: 4px; line-height: 1.35; }
.meta { width: 4.2cm; font-size: 10px; text-align: right; padding-right: 6px !important; }
table.g { width: 100%; border-collapse: collapse; table-layout: fixed; border: 1.5px solid #000; border-top: 0; }
table.g td, table.g th { border: 1px solid #000; padding: 3px 5px; vertical-align: top; }
table.g th { background: #d9d9d9; text-align: center; font-size: 10px; letter-spacing: .6px; padding: 2px; }
.r { display: block; font-size: 8px; font-weight: 700; text-transform: uppercase; color: #333; }
.v { display: block; font-size: 11.5px; min-height: 14px; word-break: break-word; }
td.sem { padding: 0; }
table.i { width: 100%; border-collapse: collapse; }
table.i th, table.i td { border: 0; border-top: 1px solid #999; padding: 3px 5px; text-align: left; font-size: 10px; background: none; letter-spacing: 0; }
td.pauta { height: 20px; }
.assina { margin-top: 18px; font-size: 10px; }
.assina .linha { margin-top: 30px; border-top: 1px solid #000; width: 8cm; padding-top: 3px; text-align: center; }
.rodape { margin-top: 6px; font-size: 8.5px; color: #444; display: flex; justify-content: space-between; gap: 12px; }
.amostra { background: #fff7d6; border: 1px solid #e0c36a; color: #6b5200; padding: 6px 10px; font-size: 11px; margin-bottom: 8px; }
@media screen { body { background: #eee; padding: 12px; } .folha { background: #fff; max-width: 190mm; margin: 0 auto; padding: 9mm; box-shadow: 0 1px 6px rgba(0,0,0,.25); } }
@media print { .amostra { display: none; } }
</style></head><body><div class="folha">
${o.amostra ? '<div class="amostra">Pré-visualização com dados de exemplo. Na ficha real entram os dados do cliente.</div>' : ""}
<table class="cab"><tr>${caixaFoto}${logo}
<td${alinhaLogo === "center" ? ' style="text-align:center"' : ""}>${logoNoTitulo}<div class="titulo">${esc(cfg.titulo)}</div>${cfg.subtitulo ? `<div class="sub">${esc(cfg.subtitulo)}</div>` : ""}${cabecalhoTexto.length ? `<div class="esc">${cabecalhoTexto.map(esc).join("<br>")}</div>` : ""}</td>
<td class="meta">Cadastro nº <b>${p.id}</b><br>Em ${esc(dataBr(p.criado_em))}${processos[0] ? `<br>Pasta <b>${esc(processos[0].pasta)}</b>` : ""}</td>${logoDireita}</tr></table>
${cfg.secoes.identificacao ? secao("DADOS DE IDENTIFICAÇÃO", [
    linha([[juridica ? "Razão social" : "Nome", p.nome]]),
    linha([["Nasc.", dataBr(p.data_nascimento), 3], ["Idade", idade(p.data_nascimento), 2], ["RG", p.rg, 3], [juridica ? "CNPJ" : "CPF", formatarDocumento(p.documento), 4]]),
    linha([["Escolaridade", p.escolaridade, 4], ["Est. civil", p.estado_civil, 4], ["PIS/NIT", formatarPis(p.pis), 4]]),
    linha([["Profissão", p.profissao]]),
    linha([["Mãe", p.nome_mae]]),
    linha([["Filiação", p.filiacao]]),
  ].join("")) : ""}
${cfg.secoes.endereco ? secao("ENDEREÇO", [
    linha([["Rua/Av.", p.logradouro, 8], ["Nº", p.numero, 1.5], ["Compl.", p.complemento, 2.5]]),
    linha([["Bairro", p.bairro, 4], ["Cidade", p.cidade, 5], ["UF", p.uf, 1], ["CEP", formatarCep(p.cep), 2]]),
  ].join("")) : ""}
${cfg.secoes.contato ? secao("CONTATO", linha([["Telefone / WhatsApp", p.telefone, 4], ["Telefone 2", p.telefone2, 3], ["E-mail", p.email, 5]])) : ""}
${blocoCampos}${tabProcessos}
${cfg.secoes.observacoes ? secao("OBSERVAÇÕES", `<tr><td colspan="12"><span class="v">${esc(p.observacoes) || "&nbsp;"}</span></td></tr>${pautas}`) : ""}
${cfg.assinatura ? `<div class="assina">${cfg.texto_assinatura ? `<p>${esc(cfg.texto_assinatura).replace(/\n/g, "<br>")}</p>` : ""}<div class="linha">${esc(p.nome)}</div><div style="width:8cm;text-align:center;font-size:9px">Assinatura do cliente · Data: ____/____/________</div></div>` : ""}
<div class="rodape"><span>${cfg.rodape ? `${esc(cfg.rodape)} · ` : ""}Impressa em ${stamp} por ${esc(o.emitidaPor)}</span><span>${o.comSenhas ? "CONTÉM SENHAS — guarde com cuidado" : "Senhas omitidas"}</span></div>
</div>${o.imprimir ? "<script>window.addEventListener('load',function(){setTimeout(function(){window.print()},250)})</script>" : ""}</body></html>`;
}

/** Ficha de um cadastro real. Senhas só saem quando `comSenhas` é verdadeiro (a rota registra na auditoria). */
export function fichaDeCadastroHtml(pessoaId: number, opcoes: { comSenhas: boolean; imprimir: boolean; emitidaPor: string }): string {
  const p = db.prepare("SELECT * FROM gestao_pessoas WHERE id=?").get(pessoaId) as Pessoa | undefined;
  if (!p) throw new ErroGestao("Pessoa não encontrada.", 404);
  const processos = db.prepare("SELECT pr.numero,pr.pasta,pr.tribunal,pr.titulo,pr.status,g.papel FROM gestao_partes g JOIN gestao_processos pr ON pr.id=g.processo_id WHERE g.pessoa_id=? ORDER BY pr.criado_em DESC LIMIT 12").all(pessoaId) as DadosFicha["processos"];
  const personalizados = valoresParaImpressao("pessoa", pessoaId, opcoes.comSenhas);
  return renderizarFicha({ pessoa: p, processos, personalizados: personalizados.map((x) => ({ campo: { nome: x.campo.nome, grupo: x.campo.grupo }, valor: x.valor })), foto: comoDataUri(fotoDaPessoa(pessoaId)), logo: comoDataUri(logoDaFicha()) }, lerConfig(), opcoes);
}

/** Pré-visualização do modelo com um cliente fictício (usa os campos personalizados que já existem). */
export function fichaDeExemplo(cfg: ConfigFicha, emitidaPor: string): string {
  const pessoa = { id: 0, tipo: "cliente", pessoa_juridica: 0, nome: "MARIA DA SILVA SANTOS (exemplo)", documento: "52998224725", rg: "12.345.678-9", email: "maria@exemplo.com.br", telefone: "(11) 99999-0000", telefone2: "", cep: "01001000", logradouro: "Praça da Sé", numero: "100", complemento: "Sala 2", bairro: "Sé", cidade: "São Paulo", uf: "SP", data_nascimento: "1968-02-15", profissao: "Auxiliar administrativa", estado_civil: "Casado(a)", origem: "", observacoes: "", escolaridade: "Médio completo", pis: "12345678919", nome_mae: "JOANA DA SILVA", filiacao: "Joana da Silva e José Santos", contact_id: null, ativo: 1, criado_em: new Date().toISOString(), atualizado_em: "" } as unknown as Pessoa;
  const personalizados = listarCampos("pessoa").filter((c) => c.imprimir).map((c) => ({ campo: { nome: c.nome, grupo: c.grupo }, valor: c.tipo === "senha" ? "••••••••" : c.tipo === "data" ? "01/03/2026" : c.tipo === "sim_nao" ? "Sim" : c.tipo === "lista" ? c.opcoes[0] ?? "" : c.tipo === "moeda" ? "R$ 1.500,00" : "Exemplo" }));
  return renderizarFicha({ pessoa, processos: [{ numero: "00012345-67", pasta: "2026/0001", tribunal: "TJSP", titulo: "Exemplo", status: "ativo", papel: "autor" }], personalizados, foto: null, logo: comoDataUri(logoDaFicha(cfg)) }, cfg, { comSenhas: false, imprimir: false, emitidaPor, amostra: true });
}
