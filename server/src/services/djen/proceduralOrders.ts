import { createHash } from "node:crypto";

/** Fonte única de ordens: destinatário + comando + período no mesmo contexto literal.
 * Não calcula vencimentos nem cria prazo a partir de menções legais ou resumo da IA.
 */
export type DestinatarioOrdem = "escritorio" | "ambas_partes" | "parte_contraria" | "perito" | "contadoria";
export interface OrdemProcessual {
  responsavel: DestinatarioOrdem;
  destinatario: string;
  tipo: "prazo_explicito" | "cumprimento" | "ciencia";
  acao: string;
  descricao: string;
  trecho: string;
  dias: number | null;
  unidade: "uteis" | "corridos" | "horas" | "meses" | "data_expressa" | null;
  prazo_texto: string | null;
  alerta: string | null;
}
function fonteNormalizada(texto: string) {
  let normal = ""; let espaco = false; const indices: number[] = [];
  const caracteres = new Map<string, string>();
  for (let i = 0; i < texto.length; i++) {
    const quebra = texto[i] === "-" ? texto.slice(i).match(/^-\s*\r?\n\s*(?=[a-zá-ú])/i) : null;
    if (quebra) { i += quebra[0].length - 1; continue; }
    if (texto[i] === "\u00ad") continue;
    const codigo = texto.charCodeAt(i);
    let valor: string;
    if (codigo < 128) {
      valor = codigo >= 65 && codigo <= 90 ? String.fromCharCode(codigo + 32) : texto[i];
    } else {
      const caractere = texto[i];
      valor = caracteres.get(caractere) ?? caractere.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      caracteres.set(caractere, valor);
    }
    for (const c of valor) {
      const codigoNormalizado = c.charCodeAt(0);
      const branco = codigoNormalizado < 128
        ? codigoNormalizado === 32 || (codigoNormalizado >= 9 && codigoNormalizado <= 13)
        : /\s/.test(c);
      if (branco) { if (!espaco) { normal += " "; indices.push(i); } espaco = true; }
      else { normal += c; indices.push(i); espaco = false; }
    }
  }
  return { normal, original: (a: number, b: number) => texto.slice(indices[a] ?? texto.length, b >= indices.length ? texto.length : indices[b]).trim() };
}
const numeroPalavras: Record<string, number> = { um:1, uma:1, dois:2, duas:2, tres:3, quatro:4, cinco:5, seis:6, sete:7, oito:8, nove:9, dez:10, onze:11, doze:12, treze:13, quatorze:14, catorze:14, quinze:15, dezesseis:16, dezessete:17, dezassete:17, dezoito:18, dezenove:19, vinte:20, trinta:30, quarenta:40, cinquenta:50, sessenta:60, setenta:70, oitenta:80, noventa:90, cem:100, cento:100, duzentos:200, trezentos:300 };
function numero(s: string): number | null {
  if (/^\d+$/.test(s.trim())) return Number(s);
  const partes = s.trim().split(/\s+e\s+/).map((p) => numeroPalavras[p]);
  if (!partes.length || partes.some((p, i) => !p || (i > 0 && p >= partes[i - 1]) || (i < partes.length - 1 && p < 20))) return null;
  return partes.reduce((a,b) => a+b,0);
}
const numerais = Object.keys(numeroPalavras).sort((a,b) => b.length-a.length).join("|");
const periodo = new RegExp(String.raw`\b(\d{1,3}|(?:${numerais})(?:\s+e\s+(?:${numerais}))*)\s*(?:\(([^)]{1,40})\)\s*)?(dias?|horas?|mes(?:es)?)(?:\s+(uteis|corridos))?\b`, "g");
const alvo = /\b(ambas as partes|as partes|parte autora|autor(?:a|es|as)?|demandante|requerente|exequente|impetrante|advogad[oa]s?|procurador[ae]?s?|patron[oa]s?|perit[oa](?: de calculos)?|calculista|contadoria|inss|ceab|parte re|parte contraria|reu|requerid[oa]|executad[oa]|autarquia)\b/g;
const chamada = /\b(?:intime-se|intimem-se|notifique-se|notifiquem-se|cite-se|citem-se|de-se vista|abra-se vista|intimad[oa]s?)\s+(?:(?:o|a|ao|aos|as|os)\s+)?(?:(?:sr\.?|sra\.?|dr\.?|dra\.?|senhor|senhora)\s+)?$/;
const intimacaoDepois = /^\s+(?:(?:e|foi|foram|fica|ficam|esta|estao|resta|restam)\s+)?(?:(?:regularmente|devidamente|novamente|desde ja)\s+){0,2}intimad[oa]s?\b/;
const ordemDepois = /^\s+(?:(?:devera|deverao)\s+(?:se\s+)?)?(?:cumpra|cumpram|devera|deverao|manifeste|manifestem|apresente|apresentem|junte|juntem|emende|emendem|regularize|regularizem|comprove|comprovem)\b/;
const historicoOuHipotese = /\b(?:apos|quando|caso|se houver|se necessario|se nao|eventual|hipotese|anteriormente|despacho anterior|decisao anterior|ja havia|na ocasiao|transcrevo|precedente|jurisprudencia|requer(?:eu)? (?:a|seja|que)|solicita(?:ou)? (?:a|seja|que)|pedido de|revogad[oa]|sem efeito|cancelad[oa]|dispensad[oa]|nao determino|nao (?:se )?intime|sem necessidade)\b/;
/** Usado também pelas etapas: evita interpretar hipótese ou citação como ato atual. */
export function contextoNaoAtual(texto: string) { return /^\s*(?:(?:conforme|segundo|em|nos termos de)\s+)?(?:apos|quando|caso|se houver|se necessario|eventual|hipotese|anteriormente|despacho anterior|decisao anterior|precedente|jurisprudencia|transcrevo)\b/.test(fonteNormalizada(texto).normal); }
function sentencas(s: string) {
  const out: { inicio: number; fim: number }[] = []; let inicio = 0;
  for (const m of s.matchAll(/[.;!?](?=\s|$)/g)) {
    const i = m.index!;
    let comeco = i;
    while (comeco > inicio) {
      const codigo = s.charCodeAt(comeco - 1);
      if (!((codigo >= 97 && codigo <= 122) || (codigo >= 48 && codigo <= 57))) break;
      comeco--;
    }
    const anterior = s.slice(comeco, i);
    if (s[i] === "." && (/^(?:sr|sra|dr|dra|art|arts|inc|n|no|num)$/.test(anterior) || anterior.length === 1)) continue;
    out.push({ inicio, fim: i }); inicio = i + 1;
  }
  if (inicio < s.length) out.push({ inicio, fim: s.length });
  return out;
}
function destinatario(valor: string): { responsavel: DestinatarioOrdem; destinatario: string } {
  if (/^(?:as partes|ambas as partes)$/.test(valor)) return { responsavel:"ambas_partes", destinatario:"Ambas as partes" };
  if (/^(?:perit|calculista|contadoria)/.test(valor)) return { responsavel: /calcul|contadoria/.test(valor) ? "contadoria" : "perito", destinatario:/calcul|contadoria/.test(valor) ? "Perito de cálculos / contadoria" : "Perito" };
  if (/^(?:inss|ceab|parte re|parte contraria|reu|requerid|executad|autarquia)/.test(valor)) return { responsavel:"parte_contraria", destinatario:/^(?:inss|ceab|autarquia)/.test(valor) ? "INSS / autarquia" : "Parte contrária" };
  return { responsavel:"escritorio", destinatario:"Escritório / parte representada" };
}
function acao(s: string) {
  if (/\b(?:ciencia|conhecimento)\b/.test(s) && !/\b(?:para (?:se )?(?:manifest|apresent|junt|emend|promov|cumpr|impugn)|manifeste|apresente|junte|cumpra|emende|e (?:manifestacao|cumprimento|apresentacao))/.test(s)) return { acao:"ciencia", descricao:"Ciência / comunicação" };
  const tipos: [string,string,RegExp][] = [
    ["emenda_inicial","Emenda à inicial",/\b(?:emend[ae]|emendar|emendada)\b.{0,65}\binicial\b|\binicial\b.{0,45}\bemend[ae]\b/],
    ["implantacao","Implantação / restabelecimento do benefício",/\b(?:implant|restabelec|conced)\w*\b.{0,70}\b(?:beneficio|auxilio|pensao|aposentadoria)\b/],
    ["calculos","Apresentação / manifestação sobre cálculos",/\b(?:calcul[oa]s?|contadoria)\b/],
    ["esclarecimentos","Esclarecimentos / complementação pericial",/\b(?:esclarec|complement|retific)\w*\b/],
    ["laudo","Apresentação do laudo",/\b(?:apresent|junt|entreg|elabor)\w*\b.{0,80}\blaudo\b/],
    ["recurso","Contrarrazões / providência recursal",/\b(?:contrarrazo|recorr|apel)\w*\b/],
    ["manifestacao","Manifestação / providência processual",/\b(?:manifest|apresent|junt|impugn|emend|regulariz|cumpr|cumpra|comprov|contest|replic|promov|recolh)\w*\b/],
  ];
  const item = tipos.find(([, , re]) => re.test(s));
  if (!item) return { acao:"ciencia", descricao:"Ciência / comunicação" };
  return { acao:item[0], descricao:/proposta\b.{0,70}\bacordo/.test(s) ? "Manifestação sobre proposta de acordo" : item[1] };
}
// O resultado depende somente do texto. A chave muda automaticamente quando a
// publicação é corrigida. Guarda apenas resultados compactos, nunca o texto completo.
const MAX_CACHE_ORDENS_BYTES = 8 * 1024 * 1024;
const MAX_CACHE_ORDENS_ENTRADAS = 2000;
const cacheOrdens = new Map<string, { valor: OrdemProcessual[]; bytes: number }>();
let bytesCacheOrdens = 0;
const copiarOrdens = (ordens: OrdemProcessual[]) => ordens.map(ordem => ({ ...ordem }));

export function identificarOrdensProcessuais(texto: string): OrdemProcessual[] {
  const chave = createHash("sha256").update(texto, "utf16le").digest("hex");
  const salvo = cacheOrdens.get(chave);
  if (salvo) {
    cacheOrdens.delete(chave);
    cacheOrdens.set(chave, salvo);
    return copiarOrdens(salvo.valor);
  }
  const resultado = identificarOrdensSemCache(texto);
  const bytes = 128 + JSON.stringify(resultado).length * 2;
  if (bytes <= MAX_CACHE_ORDENS_BYTES) {
    cacheOrdens.set(chave, { valor: copiarOrdens(resultado), bytes });
    bytesCacheOrdens += bytes;
    while (cacheOrdens.size > MAX_CACHE_ORDENS_ENTRADAS || bytesCacheOrdens > MAX_CACHE_ORDENS_BYTES) {
      const primeira = cacheOrdens.entries().next().value;
      if (!primeira) break;
      cacheOrdens.delete(primeira[0]);
      bytesCacheOrdens -= primeira[1].bytes;
    }
  }
  return resultado;
}

function identificarOrdensSemCache(texto: string): OrdemProcessual[] {
  const fonte = fonteNormalizada(texto); const s = fonte.normal; const saida: OrdemProcessual[] = [];
  for (const frase of sentencas(s)) {
    const trechoFrase = s.slice(frase.inicio, frase.fim);
    const ancoras: { inicio: number; fim: number; valor: string; comando: number }[] = [];
    for (const m of trechoFrase.matchAll(new RegExp(alvo))) {
      const prefixo = trechoFrase.slice(0,m.index!); const depois = trechoFrase.slice(m.index!+m[0].length);
      const direto = chamada.exec(prefixo);
      if (!direto && !intimacaoDepois.test(depois) && !ordemDepois.test(depois)) continue;
      const comando = direto ? direto.index : m.index!;
      if (historicoOuHipotese.test(prefixo.slice(Math.max(0,comando-150), comando))) continue;
      ancoras.push({ inicio:frase.inicio+m.index!, fim:frase.inicio+m.index!+m[0].length, valor:m[0], comando:frase.inicio+comando });
    }
    for (let i=0; i<ancoras.length; i++) {
      const a=ancoras[i]; const limite=Math.min(frase.fim, ancoras[i+1]?.comando ?? frase.fim, a.fim+1600);
      // Uma segunda ordem encerra a anterior, mesmo se o novo destinatário
      // não estiver no catálogo (ex.: secretaria). Não transfira seus dias à autora.
      const proximoComando=/\b(?:intime-se|intimem-se|notifique-se|notifiquem-se|cite-se|citem-se|de-se vista|abra-se vista)\b/.exec(s.slice(a.fim,limite));
      const fim=proximoComando ? a.fim+proximoComando.index : limite;
      const inicio = i===0 && a.inicio-frase.inicio < 350 ? frase.inicio : a.comando;
      const ordem = s.slice(a.fim,fim); const ident=acao(ordem); const quem=destinatario(a.valor);
      // Pedido e hipótese depois do destinatário também não são ordem atual.
      if (/^.{0,45}\b(?:nao (?:deve|devera|precisa)|fica dispensad[oa]|esta dispensad[oa])\b/.test(ordem)) continue;
      let prazo: { dias:number|null; unidade:OrdemProcessual["unidade"]; texto:string; alerta:string|null } | null=null;
      for (const m of ordem.matchAll(new RegExp(periodo))) {
        const antes=ordem.slice(Math.max(0,m.index!-110),m.index!); const depois=ordem.slice(m.index!+m[0].length,m.index!+m[0].length+60);
        if (!/\b(?:prazo(?:\s+(?:improrrogavel|comum|legal|maximo|sucessivo|assinalado|peremptorio)){0,3}\s*(?:de)?|em|dentro de)\s*$/.test(antes)) continue;
        if (/^\s*(?:antes|anteriores|retroativ|de antecedencia)\b/.test(depois) || /\b(?:emitid[oa]|expedid[oa]|comprovante|documento)\b.{0,55}\b(?:maximo|datad[oa]|data|antiguidade)\b/.test(antes)) continue;
        const n=numero(m[1]); const ext=m[2] ? numero(m[2]) : n;
        const divergente=n!==null && ext!==null && n!==ext;
        const unidade = /^hora/.test(m[3]) ? "horas" : /^mes/.test(m[3]) ? "meses" : m[4]==="corridos" ? "corridos" : "uteis";
        if (prazo) { prazo.dias=null; prazo.alerta="Mais de um período para o mesmo destinatário. Confira cada ordem antes de escolher o prazo."; break; }
        const marcoEspecifico = /^.{0,35}\b(?:apos|quando|a contar d[aeo]|contad[oa]s? d[aeo]|a partir d[aeo])\b/.test(depois);
        prazo={ dias: !divergente && !marcoEspecifico && (unidade==="uteis"||unidade==="corridos") && n && n<=365 ? n : null, unidade, texto:fonte.original(a.fim+m.index!,a.fim+m.index!+m[0].length), alerta: marcoEspecifico ? "Marco inicial específico no texto. Confira o evento que inicia a contagem antes de calcular; não use a disponibilização automaticamente." : divergente ? "Divergência entre número e extenso: confira o período no documento." : unidade==="horas"||unidade==="meses" ? "Unidade não calculada automaticamente. Confira o marco e registre a data manualmente." : null };
      }
      if (!prazo) {
        const data=/\bate\s+(?:o dia\s+)?\d{1,2}\/\d{1,2}\/\d{4}\b/.exec(ordem);
        if (data) prazo={dias:null,unidade:"data_expressa",texto:fonte.original(a.fim+data.index,a.fim+data.index+data[0].length),alerta:"Data limite expressa: confira e registre a data informada, sem converter em quantidade de dias."};
      }
      if (ident.acao==="ciencia") prazo=null;
      saida.push({ ...quem, ...ident, tipo: prazo ? "prazo_explicito" : ident.acao==="ciencia" ? "ciencia" : "cumprimento", trecho:fonte.original(inicio,fim), dias:prazo?.dias??null, unidade:prazo?.unidade??null, prazo_texto:prazo?.texto??null, alerta:prazo?.alerta??null });
    }
  }
  return saida.slice(0,40);
}
export const ordemDoEscritorio = (o: OrdemProcessual) => o.responsavel==="escritorio" || o.responsavel==="ambas_partes";
