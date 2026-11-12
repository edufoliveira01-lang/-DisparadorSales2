/**
 * Clientes são a única lista de pessoas. Os avisos (perícias, lembretes) e o casamento com o DJEN ainda leem a tabela `contacts`,
 * então cada cliente com telefone válido é ESPELHADO nela, um contato por processo (o casamento é por nome + processo).
 *
 * Contatos antigos (cadastrados à mão) são adotados: ligados ao cliente de mesmo nome e telefone, ou viram cliente novo. O espelho é recalculado
 * sozinho (ao salvar clientes/processos, ao iniciar e a cada 10 minutos); ninguém edita a tabela `contacts` diretamente.
 */
import { db } from "../../db";
import { normalizePhone } from "../../utils/phone";
import { normalizeProcesso } from "../../utils/processo";
import { normalizeName } from "../matcherService";
import { telefoneValidoParaLembrete } from "../lembreteUtils";
import { deleteContacts } from "../contactsService";
import { parseImportContent } from "../contactImportService";

interface Linha { id: number; nome: string; telefone: string; processo: string | null; processo_chave: string; pessoa_id: number | null; origem: string; observacoes: string | null }
interface PessoaLinha { id: number; nome: string; telefone: string; telefone2: string; observacoes: string }

const formatarCnj = (n: string) => { const d = n.replace(/\D/g, ""); return d.length === 20 ? `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d[13]}.${d.slice(14, 16)}.${d.slice(16)}` : n.trim(); };

export interface ResultadoEspelho { adotados: number; pessoas_criadas: number; contatos_criados: number; atualizados: number; removidos: number }

export function reconciliarContatos(): ResultadoEspelho {
  const r: ResultadoEspelho = { adotados: 0, pessoas_criadas: 0, contatos_criados: 0, atualizados: 0, removidos: 0 };
  db.transaction(() => {
    // Cliente apagado: seus contatos espelhados saem junto (e não voltam a virar cliente).
    const orfaos = db.prepare("SELECT id FROM contacts WHERE pessoa_id IS NOT NULL AND pessoa_id NOT IN (SELECT id FROM gestao_pessoas)").all() as { id: number }[];
    if (orfaos.length) r.removidos += deleteContacts(orfaos.map((o) => o.id));

    // 1) Contatos antigos, sem cliente: liga ao cliente igual (nome + telefone) ou cria o cliente.
    const clientes = db.prepare("SELECT id,nome,telefone,telefone2,observacoes FROM gestao_pessoas WHERE tipo='cliente'").all() as PessoaLinha[];
    const chaveP = (p: PessoaLinha) => [p.telefone, p.telefone2].map((t) => normalizePhone(t)).filter(Boolean).map((t) => `${normalizeName(p.nome)}|${t}`);
    const porNomeFone = new Map<string, number>(); for (const p of clientes) for (const k of chaveP(p)) if (!porNomeFone.has(k)) porNomeFone.set(k, p.id);
    for (const c of db.prepare("SELECT * FROM contacts WHERE pessoa_id IS NULL").all() as Linha[]) {
      if (c.nome.trim().length < 2) continue;
      const k = `${normalizeName(c.nome)}|${normalizePhone(c.telefone)}`;
      let pid = porNomeFone.get(k);
      if (!pid) {
        const livre = !db.prepare("SELECT 1 FROM gestao_pessoas WHERE contact_id=?").get(c.id);
        const info = db.prepare("INSERT INTO gestao_pessoas(tipo,nome,telefone,observacoes,origem,contact_id) VALUES ('cliente',?,?,?,'Contatos do sistema',?)").run(c.nome.trim().slice(0, 200), c.telefone, c.observacoes || "", livre ? c.id : null);
        pid = Number(info.lastInsertRowid); porNomeFone.set(k, pid); r.pessoas_criadas++;
      }
      db.prepare("UPDATE contacts SET pessoa_id=?, origem='manual' WHERE id=?").run(pid, c.id); r.adotados++;
    }

    // 2) Cada cliente com telefone válido: um contato por processo (ou um só, sem processo).
    const processos = new Map<number, { numero: string; chave: string }[]>();
    for (const x of db.prepare("SELECT g.pessoa_id, pr.numero FROM gestao_partes g JOIN gestao_processos pr ON pr.id=g.processo_id ORDER BY pr.id").all() as { pessoa_id: number; numero: string }[]) {
      const chave = normalizeProcesso(x.numero); if (!chave) continue;
      const lista = processos.get(x.pessoa_id) ?? []; if (!lista.some((y) => y.chave === chave)) lista.push({ numero: formatarCnj(x.numero), chave }); processos.set(x.pessoa_id, lista);
    }
    const ligados = new Map<number, Linha[]>();
    for (const c of db.prepare("SELECT * FROM contacts WHERE pessoa_id IS NOT NULL").all() as Linha[]) (ligados.get(c.pessoa_id!) ?? ligados.set(c.pessoa_id!, []).get(c.pessoa_id!)!).push(c);
    const ins = db.prepare("INSERT INTO contacts (nome, telefone, processo, processo_chave, observacoes, pessoa_id, origem) VALUES (?,?,?,?,?,?, 'espelho')");
    for (const p of clientes) {
      if (!telefoneValidoParaLembrete(p.telefone)) continue;
      const fone = normalizePhone(p.telefone), nome = p.nome.trim();
      const ls = ligados.get(p.id) ?? [];
      for (const l of ls) if (l.nome !== nome || l.telefone !== fone) { db.prepare("UPDATE contacts SET nome=?, telefone=? WHERE id=?").run(nome, fone, l.id); r.atualizados++; }
      const desejados = processos.get(p.id) ?? [];
      const chaves = new Set(desejados.map((d) => d.chave)), tem = new Set(ls.map((l) => l.processo_chave)), usados = new Set<number>();
      for (const d of desejados) {
        if (tem.has(d.chave)) continue;
        const sobra = ls.find((l) => l.origem === "espelho" && !chaves.has(l.processo_chave) && !usados.has(l.id));
        if (sobra) { db.prepare("UPDATE contacts SET processo=?, processo_chave=? WHERE id=?").run(d.numero, d.chave, sobra.id); usados.add(sobra.id); r.atualizados++; }
        else { ins.run(nome, fone, d.numero, d.chave, null, p.id); r.contatos_criados++; }
      }
      if (!desejados.length && ls.length === 0) { ins.run(nome, fone, null, "", null, p.id); r.contatos_criados++; }
      const sobrando = ls.filter((l) => l.origem === "espelho" && !usados.has(l.id) && !(desejados.length === 0 ? l.processo_chave === "" : chaves.has(l.processo_chave))).map((l) => l.id);
      if (sobrando.length) r.removidos += deleteContacts(sobrando);
    }
  })();
  return r;
}

let agendada: ReturnType<typeof setTimeout> | null = null;
/** Recalcula o espelho daqui a pouco (junta várias gravações seguidas). */
export function agendarReconciliacao(atrasoMs = 2500): void {
  if (agendada) return;
  agendada = setTimeout(() => { agendada = null; try { reconciliarContatos(); } catch (e) { console.error("[Contatos] espelho:", e instanceof Error ? e.message : e); } }, atrasoMs);
  agendada.unref?.();
}

/** Importa um CSV (Google/Android) ou vCard direto como CLIENTES (sem duplicar: mesmo nome e telefone). O processo do arquivo, quando houver, fica nos avisos. */
export function importarArquivoComoClientes(content: string): { total: number; criados: number; ignorados: number } {
  const lidos = parseImportContent(content);
  if (lidos.length === 0) throw new Error("vazio");
  let criados = 0, ignorados = 0;
  db.transaction(() => {
    const clientes = db.prepare("SELECT id,nome,telefone,telefone2 FROM gestao_pessoas WHERE tipo='cliente'").all() as { id: number; nome: string; telefone: string; telefone2: string }[];
    const mapa = new Map<string, number>();
    for (const p of clientes) for (const t of [p.telefone, p.telefone2]) { const d = normalizePhone(t); if (d) mapa.set(`${normalizeName(p.nome)}|${d}`, p.id); }
    for (const c of lidos) {
      const fone = normalizePhone(c.telefone);
      if (!fone || c.nome.trim().length < 2) { ignorados++; continue; }
      const k = `${normalizeName(c.nome)}|${fone}`;
      let pid = mapa.get(k), novo = false;
      if (!pid) {
        pid = Number(db.prepare("INSERT INTO gestao_pessoas(tipo,nome,telefone,observacoes,origem) VALUES ('cliente',?,?,?,'Importação de contatos')").run(c.nome.trim().slice(0, 200), c.telefone, (c.observacoes || "").slice(0, 2000)).lastInsertRowid);
        mapa.set(k, pid); novo = true;
      }
      const chave = normalizeProcesso(c.processo || "");
      let extra = false;
      if (chave && !db.prepare("SELECT 1 FROM contacts WHERE pessoa_id=? AND processo_chave=?").get(pid, chave)) {
        db.prepare("INSERT INTO contacts (nome, telefone, processo, processo_chave, observacoes, pessoa_id, origem) VALUES (?,?,?,?,?,?, 'manual')").run(c.nome.trim(), fone, c.processo.trim(), chave, null, pid); extra = true;
      }
      if (novo) criados++; else if (!extra) ignorados++;
    }
  })();
  reconciliarContatos();
  return { total: lidos.length, criados, ignorados };
}
