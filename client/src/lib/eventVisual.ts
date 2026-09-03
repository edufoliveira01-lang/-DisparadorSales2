export type CategoriaEvento =
  | "pericia_medica"
  | "pericia_social"
  | "pericia_geral"
  | "audiencia_presencial"
  | "audiencia_online"
  | "audiencia_hibrida"
  | "tipo_nao_identificado"
  | "outro";

export interface EventoClassificavel {
  tipo?: string | null;
  origem?: string | null;
  nome?: string | null;
}

export interface ClassificacaoEvento {
  categoria: CategoriaEvento;
  rotulo: string;
  audiencia: boolean;
  identificado: boolean;
}

function textoComparavel(valor: string | null | undefined): string {
  return (valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function rotuloNormalizado(valor: string | null | undefined): string {
  const limpo = (valor || "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().toLocaleLowerCase("pt-BR");
  return limpo ? limpo.charAt(0).toLocaleUpperCase("pt-BR") + limpo.slice(1) : "Tipo não identificado";
}

export function classificarEvento(evento: EventoClassificavel): ClassificacaoEvento {
  const tipo = textoComparavel(evento.tipo);
  const origem = textoComparavel(evento.origem);
  const nome = textoComparavel(evento.nome);
  const nomeEhMarcador = /^\[?(AUDIENCIA|ONLINE|VIDEOCONFERENCIA|VIDEO CONFERENCIA|VIRTUAL|HIBRIDA)\]?(\s|$)/.test(nome);
  const contexto = `${tipo} ${origem}${nomeEhMarcador ? ` ${nome}` : ""}`;

  const indicaHibrida = /\b(HIBRIDA|HIBRIDO|SEMIPRESENCIAL|MISTA|MISTO)\b/.test(contexto);
  const indicaOnline = /\b(ONLINE|VIRTUAL|REMOTA|REMOTO|VIDEOCONFERENCIA|VIDEO CONFERENCIA|TELEPRESENCIAL|MEET|TEAMS|ZOOM)\b/.test(contexto);
  const indicaAudiencia =
    origem === "AUDIENCIA" ||
    /\bAUDIENCIA\b/.test(contexto) ||
    indicaOnline ||
    indicaHibrida;

  if (indicaAudiencia) {
    if (indicaHibrida) {
      return { categoria: "audiencia_hibrida", rotulo: "Audiência híbrida", audiencia: true, identificado: true };
    }
    if (indicaOnline) {
      return { categoria: "audiencia_online", rotulo: "Audiência online", audiencia: true, identificado: true };
    }
    return { categoria: "audiencia_presencial", rotulo: "Audiência presencial", audiencia: true, identificado: true };
  }

  if (tipo.includes("SOCIAL") || origem === "SOCIAL") {
    return { categoria: "pericia_social", rotulo: "Perícia social", audiencia: false, identificado: true };
  }
  if (tipo.includes("MEDICA") || origem === "MEDICA") {
    return { categoria: "pericia_medica", rotulo: "Perícia médica", audiencia: false, identificado: true };
  }
  if (!tipo || tipo.includes("TIPO NAO IDENTIFICADO")) {
    return { categoria: "tipo_nao_identificado", rotulo: "Tipo não identificado", audiencia: false, identificado: false };
  }
  if (tipo === "PERICIA") {
    return { categoria: "pericia_geral", rotulo: "Perícia", audiencia: false, identificado: true };
  }

  return { categoria: "outro", rotulo: rotuloNormalizado(evento.tipo), audiencia: false, identificado: true };
}
