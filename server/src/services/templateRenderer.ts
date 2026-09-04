import Handlebars from "handlebars";
import type { Pericia } from "./parserService";

export interface RenderableTemplate {
  conteudo_1_pericia: string;
  conteudo_2_pericias: string;
  conteudo_pericia_medica?: string | null;
  conteudo_pericia_social?: string | null;
  modo_envio_2_pericias: "combinada" | "separadas";
}

function periciaToVars(p: Pericia) {
  return {
    TIPO_PERICIA: p.tipo,
    DATA: p.data,
    HORARIO: p.horario,
    LOCAL: p.local,
    TELEFONE: p.telefone || "",
    WHATSAPP: p.whatsapp || "",
    PROCESSO: p.processo || "",
    PROFISSIONAL_PERITO: p.profissionalPerito || "",
  };
}

function compromissosToText(pericias: Pericia[]): string {
  return pericias
    .map((pericia) => {
      const linhas = [
        `• ${pericia.tipo || "Compromisso"}: ${pericia.data}${pericia.horario ? ` às ${pericia.horario}` : ""}`,
      ];
      if (pericia.local) linhas.push(`  Local: ${pericia.local}`);
      if (pericia.processo) linhas.push(`  Processo: ${pericia.processo}`);
      return linhas.join("\n");
    })
    .join("\n\n");
}

export function renderMessages(template: RenderableTemplate, nome: string, pericias: Pericia[]): string[] {
  if (pericias.length === 0) return [];

  if (pericias.length === 1) {
    const compiled = Handlebars.compile(template.conteudo_1_pericia, { noEscape: true });
    return [compiled({ NOME: nome, ...periciaToVars(pericias[0]) })];
  }

  if (template.modo_envio_2_pericias === "separadas") {
    return pericias.map((p) => {
      let content = template.conteudo_1_pericia;
      if (p.origem === "medica" && template.conteudo_pericia_medica) {
        content = template.conteudo_pericia_medica;
      } else if (p.origem === "social" && template.conteudo_pericia_social) {
        content = template.conteudo_pericia_social;
      }
      const compiled = Handlebars.compile(content, { noEscape: true });
      return compiled({ NOME: nome, ...periciaToVars(p) });
    });
  }

  const compiled = Handlebars.compile(template.conteudo_2_pericias, { noEscape: true });
  return [compiled({ NOME: nome, PERICIAS: pericias.map(periciaToVars) })];
}

export function renderCobranca(mensagem: string, nome: string, pericia: Pericia | null): string {
  const compiled = Handlebars.compile(mensagem, { noEscape: true });
  return compiled({
    NOME: nome,
    ...(pericia
      ? periciaToVars(pericia)
      : {
          TIPO_PERICIA: "",
          DATA: "",
          HORARIO: "",
          LOCAL: "",
          TELEFONE: "",
          WHATSAPP: "",
          PROCESSO: "",
          PROFISSIONAL_PERITO: "",
        }),
  });
}

export function renderLembrete(mensagem: string, nome: string, pericias: Pericia[]): string {
  if (pericias.length === 0) return "";
  const compromissos = compromissosToText(pericias);
  const usaLista = /\{\{\s*COMPROMISSOS\s*\}\}/.test(mensagem);
  const compiled = Handlebars.compile(mensagem, { noEscape: true });
  const renderizada = compiled({
    NOME: nome,
    ...periciaToVars(pericias[0]),
    COMPROMISSOS: compromissos,
  });

  if (pericias.length > 1 && !usaLista) {
    return `${renderizada}\n\nCompromissos:\n${compromissos}`;
  }
  return renderizada;
}

export function renderAudiencia(mensagem: string, nome: string, pericia: Pericia): string {
  const compiled = Handlebars.compile(mensagem, { noEscape: true });
  return compiled({ NOME: nome, ...periciaToVars(pericia) });
}
