import { createHash } from "node:crypto";

/**
 * Extensão de TEMA do DeskcommCRM com a identidade visual do DisparaZap (superfícies, bordas e textos em azul-acinzentado,
 * com o roxo da marca). O Deskcomm instala extensões a partir de um CATÁLOGO que o administrador admite manualmente; o pacote é
 * baixado de `<origem>/packages/<sha256>.json`. Aqui o painel serve as duas coisas, gerando-as em tempo de execução para que o
 * resumo (sha256) e o tamanho nunca saiam diferentes do conteúdo entregue.
 *
 * Formato e limites: docs do DeskcommCRM (docs/specs/extensoes-declarativas-v1.md). Os valores abaixo seguem a régua de forma
 * do tema (#rrggbb, rgb(), rgba(), var(--x)); a cor de ação da INSTALAÇÃO continua vindo da tela Marca (o tema da plataforma
 * descarta as chaves --color-accent*), e fica aqui para o tema valer também por empresa.
 */
const ACENTO = {
  "--color-accent-50": "#f3f0ff", "--color-accent-100": "#e9e2ff", "--color-accent-200": "#d6c8ff", "--color-accent-300": "#bba2ff",
  "--color-accent-400": "#a07aff", "--color-accent-500": "#8556ee", "--color-accent-600": "#7340d9", "--color-accent-700": "#6030b9",
  "--color-accent-800": "#502a97", "--color-accent-900": "#432779", "--color-accent-950": "#2b1655",
} as const;

export const TEMA_DISPARAZAP = {
  palette: "mist",
  claro: {
    "--color-bg": "#f6f7fb", "--color-surface": "#ffffff", "--color-surface-elevated": "#eef0f6",
    "--color-text": "#182033", "--color-text-muted": "#505d75", "--color-text-subtle": "#647089",
    "--color-border": "#e1e5ef", "--color-border-strong": "#c7cedd",
    ...ACENTO,
    "--color-accent": "#7340d9", "--color-accent-fg": "#ffffff", "--color-accent-soft": "#f3f0ff", "--color-accent-hover": "#6030b9",
  },
  escuro: {
    "--color-bg": "#101626", "--color-surface": "#182033", "--color-surface-elevated": "#202a3f",
    "--color-text": "#eef0f6", "--color-text-muted": "#c7cedd", "--color-text-subtle": "#8993aa",
    "--color-border": "#252e43", "--color-border-strong": "#39455d",
    "--color-accent": "#7340d9", "--color-accent-fg": "#ffffff", "--color-accent-soft": "rgba(133, 86, 238, 0.18)", "--color-accent-hover": "#8556ee",
  },
} as const;

export const IDENTIDADE_DA_EXTENSAO = { publisher: "saleseassociados", name: "tema-disparazap", version: "1.0.0" } as const;
const REVISAO_DO_CATALOGO = 1; // sobe a cada nova versão publicada (o Deskcomm exige revisão crescente por origem)

const exibicao = {
  title: { "pt-BR": "Tema DisparaZap" },
  summary: { "pt-BR": "Visual do DisparaZap no atendimento: fundos e bordas em azul-acinzentado, textos nítidos e o roxo da marca." },
  category: "productivity",
  icon: "Lightbulb",
} as const;

export interface ExtensaoDeskcomm { pacote: Buffer; sha256: string; catalogo: Buffer }

/** Monta o pacote do tema e o catálogo que o admite, para a origem (https, sem caminho) dada. */
export function montarExtensaoDeskcomm(origem: string): ExtensaoDeskcomm {
  const pacote = Buffer.from(JSON.stringify({
    format_version: 1, profile: "declarative", ...IDENTIDADE_DA_EXTENSAO, license: "MIT", host_api: { min: 1, max: 2 },
    permissions: ["theme.apply"], dependencies: [], data: { mode: "none" }, display: exibicao,
    configuration: { density: "comfortable", show_description: true },
    contributions: { crm_cards: [], theme: TEMA_DISPARAZAP },
  }, null, 2), "utf8");
  const sha256 = createHash("sha256").update(pacote).digest("hex");
  const catalogo = Buffer.from(JSON.stringify({
    format_version: 1, origin: origem, revision: REVISAO_DO_CATALOGO,
    entries: [{ ...IDENTIDADE_DA_EXTENSAO, license: "MIT", host_api: { min: 1, max: 2 }, display: exibicao, permissions: ["theme.apply"], sha256, byte_length: pacote.length, publisher_label: "Sales & Associados", tags: ["tema"] }],
  }, null, 2), "utf8");
  return { pacote, sha256, catalogo };
}
