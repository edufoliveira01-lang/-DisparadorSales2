import { db } from "../../../db";
import { getSetting, setSetting } from "../../settingsService";
import { WorkflowInputError } from "../workflow";
import { evento, chaveEscopo, norm, unicos, diasIntervalo } from "./utils";
import type {
  AjustesCalendario,
  EscopoCalendario,
  EventoForense,
} from "./types";
import type { CalendarioForense } from "../deadlines";
export const INTERVALO_CALENDARIOS_MS = 6 * 60 * 60 * 1000;
export interface ConfigImportacao {
  ativo: boolean;
  localidades: {
    tribunal: string;
    orgao: string;
    municipio: string;
    uf: string;
    instancia: "primeiro" | "segundo";
  }[];
}
export interface CalendarioOficial extends EscopoCalendario {
  chave: string;
  status: string;
  eventos: EventoForense[];
  fontes: string[];
  avisos: string[];
  erro: string | null;
  consultado_em: string | null;
  atualizado_em: string | null;
  proxima_tentativa: number;
  ajustes: AjustesCalendario;
}
export function configImportacao(): ConfigImportacao {
  const s = getSetting("djen_calendarios_automaticos");
  return s ? JSON.parse(s) : { ativo: true, localidades: [] };
}
export function salvarConfigImportacao(data: ConfigImportacao) {
  if (
    !data ||
    typeof data.ativo !== "boolean" ||
    !Array.isArray(data.localidades) ||
    data.localidades.length > 200
  )
    throw new WorkflowInputError("Configuração da importação inválida.");
  const chaves = new Set<string>();
  for (const l of data.localidades) {
    if (
      !l ||
      typeof l.tribunal !== "string" ||
      !/^[A-Z0-9-]{2,20}$/.test(l.tribunal) ||
      typeof l.orgao !== "string" ||
      !l.orgao.trim() ||
      l.orgao.length > 300 ||
      typeof l.municipio !== "string" ||
      l.municipio.length > 150 ||
      typeof l.uf !== "string" ||
      !/^$|^(?:AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/.test(
        l.uf,
      ) ||
      !["primeiro", "segundo"].includes(l.instancia)
    )
      throw new WorkflowInputError(
        "Confira tribunal, órgão, localidade, UF e instância.",
      );
    const c = `${l.tribunal}:${norm(l.orgao)}`;
    if (chaves.has(c))
      throw new WorkflowInputError("Localidade repetida para o mesmo órgão.");
    chaves.add(c);
  }
  const old = configImportacao();
  const invalidar = (l: ConfigImportacao["localidades"][number]) => {
    const registros = db
      .prepare(
        "SELECT chave,orgao FROM djen_calendarios_oficiais WHERE tribunal=?",
      )
      .all(l.tribunal) as { chave: string; orgao: string }[];
    for (const r of registros)
      if (norm(r.orgao) === norm(l.orgao))
        db.prepare(
          "UPDATE djen_calendarios_oficiais SET status='localidade_pendente',proxima_tentativa=0,erro='A localidade mudou; aguardando nova importação.' WHERE chave=?",
        ).run(r.chave);
  };
  db.transaction(() => {
    setSetting("djen_calendarios_automaticos", JSON.stringify(data));
    for (const l of data.localidades) {
      const anterior = old.localidades.find(
        (x) => x.tribunal === l.tribunal && norm(x.orgao) === norm(l.orgao),
      );
      if (JSON.stringify(anterior) !== JSON.stringify(l)) invalidar(l);
    }
    for (const l of old.localidades)
      if (
        !data.localidades.some(
          (x) => x.tribunal === l.tribunal && norm(x.orgao) === norm(l.orgao),
        )
      )
        invalidar(l);
  })();

  return data;
}
export function validarEscopo(e: EscopoCalendario) {
  if (
    !e ||
    typeof e.tribunal !== "string" ||
    !/^[A-Z0-9-]{2,20}$/.test(e.tribunal) ||
    typeof e.orgao !== "string" ||
    !e.orgao.trim() ||
    e.orgao.length > 300 ||
    !Number.isInteger(e.ano) ||
    e.ano < 2000 ||
    e.ano > 2100
  )
    throw new WorkflowInputError("Informe tribunal, órgão e ano válidos.");
}
export function criarRegistro(e: EscopoCalendario) {
  validarEscopo(e);
  const chave = chaveEscopo(e.tribunal, e.orgao, e.ano);
  db.prepare(
    "INSERT OR IGNORE INTO djen_calendarios_oficiais(chave,tribunal,orgao,ano) VALUES (?,?,?,?)",
  ).run(chave, e.tribunal, e.orgao, e.ano);
  return chave;
}
export function lerCalendario(chave: string): CalendarioOficial | undefined {
  const row = db
    .prepare(
      "SELECT c.*,a.ajustes_json FROM djen_calendarios_oficiais c LEFT JOIN djen_calendario_ajustes a ON a.chave=c.chave WHERE c.chave=?",
    )
    .get(chave) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  const { eventos_json, fontes_json, avisos_json, ajustes_json, ...resto } =
    row;
  return {
    ...resto,
    eventos: JSON.parse(String(eventos_json)),
    fontes: JSON.parse(String(fontes_json)),
    avisos: JSON.parse(String(avisos_json)),
    ajustes: ajustes_json
      ? JSON.parse(String(ajustes_json))
      : { adicionar: [], ignorar: [] },
  } as unknown as CalendarioOficial;
}
export function listarCalendariosOficiais() {
  return (
    db
      .prepare(
        "SELECT chave FROM djen_calendarios_oficiais ORDER BY ano DESC,tribunal,orgao LIMIT 500",
      )
      .all() as { chave: string }[]
  ).map((r) => lerCalendario(r.chave)!);
}
export function registrarCalendario(
  chave: string,
  tipo: string,
  descricao: string,
  dados?: unknown,
) {
  db.prepare(
    "INSERT INTO djen_calendario_historico(chave,tipo,descricao,dados_json) VALUES (?,?,?,?)",
  ).run(chave, tipo, descricao, dados ? JSON.stringify(dados) : null);
}
export function salvarAjustes(chave: string, data: unknown) {
  const c = lerCalendario(chave);
  if (!c) throw new WorkflowInputError("Calendário não encontrado.");
  const a = data as AjustesCalendario;
  if (
    !a ||
    !Array.isArray(a.adicionar) ||
    a.adicionar.length > 500 ||
    !Array.isArray(a.ignorar) ||
    a.ignorar.length > 1500 ||
    a.ignorar.some((id) => typeof id !== "string" || !/^[a-f0-9]{32}$/.test(id))
  )
    throw new WorkflowInputError("Ajustes manuais inválidos.");
  const adicionar = a.adicionar.map((e) => {
    if (
      !e ||
      !["feriado", "suspensao", "expediente_parcial"].includes(e.tipo) ||
      typeof e.descricao !== "string" ||
      !e.descricao.trim() ||
      e.descricao.length > 2000 ||
      typeof e.inicio !== "string" ||
      typeof e.fim !== "string" ||
      !e.inicio.startsWith(`${c.ano}-`) ||
      !e.fim.startsWith(`${c.ano}-`)
    )
      throw new WorkflowInputError(
        "Informe tipo, período e motivo do ajuste dentro do ano do calendário.",
      );
    try {
      return evento(e.tipo, e.inicio, e.fim, e.descricao, "manual");
    } catch {
      throw new WorkflowInputError("Datas inválidas no ajuste manual.");
    }
  });
  const novo = {
    adicionar: unicos(adicionar),
    ignorar: [...new Set(a.ignorar)],
  };
  db.transaction(() => {
    db.prepare(
      "INSERT INTO djen_calendario_ajustes(chave,ajustes_json) VALUES (?,?) ON CONFLICT(chave) DO UPDATE SET ajustes_json=excluded.ajustes_json,updated_at=CURRENT_TIMESTAMP",
    ).run(chave, JSON.stringify(novo));
    registrarCalendario(
      chave,
      "ajuste",
      "Ajustes manuais do calendário alterados.",
      { antes: c.ajustes, depois: novo },
    );
  })();
  return lerCalendario(chave)!;
}
export function eventosEfetivos(c: CalendarioOficial) {
  return unicos([
    ...c.eventos.filter((e) => !c.ajustes.ignorar.includes(e.id)),
    ...c.ajustes.adicionar,
  ]);
}
export function calendarioParaCalculo(
  c: CalendarioOficial,
): CalendarioForense | null {
  if (
    !["ok", "parcial"].includes(c.status) ||
    !c.atualizado_em ||
    Date.now() - Date.parse(c.atualizado_em) > INTERVALO_CALENDARIOS_MS
  )
    return null;
  const eventos = eventosEfetivos(c);
  return {
    tribunal: c.tribunal,
    orgao: c.orgao,
    inicio: `${c.ano}-01-01`,
    fim: `${c.ano}-12-31`,
    fonte: c.fontes[0],
    conferido: true,
    feriados: [
      ...new Set(
        eventos
          .filter((e) => e.tipo === "feriado")
          .flatMap((e) => diasIntervalo(e.inicio, e.fim)),
      ),
    ],
    suspensoes: eventos
      .filter((e) => e.tipo === "suspensao")
      .map((e) => ({ inicio: e.inicio, fim: e.fim, motivo: e.descricao })),
    expediente_parcial: eventos
      .filter((e) => e.tipo === "expediente_parcial")
      .flatMap((e) =>
        diasIntervalo(e.inicio, e.fim).map((data) => ({
          data,
          motivo: e.descricao,
        })),
      ),
    pendencias: eventos
      .filter((e) => e.tipo === "pendencia")
      .map((e) => ({ inicio: e.inicio, fim: e.fim, motivo: e.descricao })),
    origem: "automatico",
    atualizado_em: c.atualizado_em,
    fontes: c.fontes,
  };
}
