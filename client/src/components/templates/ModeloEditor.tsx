import { useRef, type ReactNode, type RefObject } from "react";
import { Check, MessageSquareText, Save } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { SettingsFooter } from "@/components/ui/Settings";
import { cn } from "@/lib/utils";

/** Insere `{{VARIAVEL}}` na posição do cursor do textarea e devolve o cursor logo após. */
export function inserirNoCursor(ref: RefObject<HTMLTextAreaElement | null>, atual: string, variavel: string, aplicar: (novo: string) => void) {
  const el = ref.current;
  const token = `{{${variavel}}}`;
  if (!el) {
    aplicar(atual + token);
    return;
  }
  const inicio = el.selectionStart ?? atual.length;
  const fim = el.selectionEnd ?? inicio;
  aplicar(atual.slice(0, inicio) + token + atual.slice(fim));
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(inicio + token.length, inicio + token.length);
  });
}

/** Lista de variáveis clicáveis: cada uma é inserida no texto onde o cursor estiver. */
export function VariaveisInseriveis({ variaveis, onInsert, disabled, fixo }: {
  variaveis: string[]; onInsert: (variavel: string) => void; disabled?: boolean; fixo?: ReactNode;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Variáveis — clique para inserir no texto</p>
      <div className="flex flex-wrap gap-1.5">
        {fixo}
        {variaveis.map((v) => (
          <button
            key={v}
            type="button"
            disabled={disabled}
            onClick={() => onInsert(v)}
            className="rounded-md bg-zinc-100 px-2 py-1 font-mono text-xs text-zinc-600 transition-colors hover:bg-accent-50 hover:text-accent-700 disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-accent-900/30 dark:hover:text-accent-300"
          >
            {`{{${v}}}`}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Prévia no formato de balão do WhatsApp. */
export function PreviaWhatsApp({ titulo = "Prévia no WhatsApp", mensagens, erro, rodape }: {
  titulo?: string; mensagens: string[]; erro?: string; rodape?: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-200 bg-zinc-50 px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">{titulo}</p>
        <span className="text-[11px] text-zinc-400">com dados de exemplo</span>
      </div>
      <div className="space-y-2 bg-zinc-100 p-4 dark:bg-zinc-950">
        {erro ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">{erro}</p>
        ) : (
          (mensagens.length ? mensagens : [""]).map((m, i) => (
            <div key={i} className="max-w-[92%] whitespace-pre-wrap break-words rounded-2xl rounded-tl-sm bg-white px-3.5 py-2.5 text-sm text-zinc-800 shadow-sm dark:bg-zinc-800 dark:text-zinc-100">
              {m || <span className="text-zinc-400">A mensagem aparece aqui…</span>}
            </div>
          ))
        )}
      </div>
      {rodape && <div className="border-t border-zinc-200 px-4 py-2 text-[11px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">{rodape}</div>}
    </div>
  );
}

/** Cartão compacto de um modelo, com «Padrão» em destaque. */
export function ModeloCard({ nome, trecho, padrao, selecionado, disabled, onClick }: {
  nome: string; trecho?: string; padrao?: boolean; selecionado?: boolean; disabled?: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={selecionado}
      className={cn(
        "flex w-full flex-col gap-1 rounded-xl border px-3.5 py-3 text-left transition-colors disabled:opacity-60",
        selecionado
          ? "border-accent-500 bg-accent-50 dark:border-accent-500/60 dark:bg-accent-900/20"
          : "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800/60",
      )}
    >
      <span className="flex items-center gap-2">
        <MessageSquareText className="h-4 w-4 shrink-0 text-zinc-400" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{nome || "Sem nome"}</span>
        {padrao && <Badge tone="success"><Check className="h-3 w-3" /> Padrão</Badge>}
      </span>
      {trecho && <span className="line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">{trecho}</span>}
    </button>
  );
}

/** Grade de cartões de modelos, com título opcional (ex.: a aplicação). */
export function GrupoModelos({ titulo, children }: { titulo?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0">
      {titulo && <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{titulo}</p>}
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{children}</div>
    </div>
  );
}

/** Abas internas (segmentadas) usadas dentro de uma categoria. */
export function AbasInternas<T extends string>({ abas, valor, onChange, rotulo }: {
  abas: { key: T; label: string }[]; valor: T; onChange: (key: T) => void; rotulo: string;
}) {
  return (
    <div role="tablist" aria-label={rotulo} className="inline-flex max-w-full gap-1 overflow-x-auto rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800/70">
      {abas.map((a) => (
        <button
          key={a.key}
          type="button"
          role="tab"
          aria-selected={valor === a.key}
          onClick={() => onChange(a.key)}
          className={cn(
            "shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
            valor === a.key
              ? "bg-white text-accent-700 shadow-sm dark:bg-zinc-900 dark:text-accent-300"
              : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200",
          )}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}

export function CarregandoModelos() {
  return (
    <div className="space-y-3" aria-busy="true">
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

/**
 * Editor simples de uma mensagem por aba (ex.: Presencial/Online/Híbrida): abas, variáveis clicáveis,
 * texto à esquerda e prévia do WhatsApp à direita, com um botão de salvar no rodapé.
 */
export function MensagensPorAba<T extends string>({
  abas, aba, onAba, mensagens, onChange, variaveis, previa, onSalvar, salvando, rotuloSalvar = "Salvar mensagens", ajuda, carregando, linhas = 10,
}: {
  abas: { key: T; label: string }[];
  aba: T;
  onAba: (key: T) => void;
  mensagens: Record<T, string>;
  onChange: (key: T, valor: string) => void;
  variaveis: string[];
  previa: (key: T, texto: string) => string;
  onSalvar: () => void;
  salvando: boolean;
  rotuloSalvar?: string;
  ajuda?: ReactNode;
  carregando?: boolean;
  linhas?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const texto = mensagens[aba];
  return (
    <section className="surface-panel overflow-hidden">
      <div className="border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
        <AbasInternas abas={abas} valor={aba} onChange={onAba} rotulo="Tipo de mensagem" />
      </div>
      {carregando ? (
        <div className="p-5"><CarregandoModelos /></div>
      ) : (
        <div className="grid items-start gap-5 p-5 lg:grid-cols-2">
          <div className="min-w-0 space-y-3">
            {ajuda && <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{ajuda}</p>}
            <VariaveisInseriveis variaveis={variaveis} onInsert={(v) => inserirNoCursor(ref, texto, v, (n) => onChange(aba, n))} />
            <Textarea
              key={aba}
              ref={ref}
              rows={linhas}
              aria-label="Texto da mensagem"
              value={texto}
              onChange={(e) => onChange(aba, e.target.value)}
              className="font-mono text-[13px]"
            />
          </div>
          <div className="min-w-0 lg:sticky lg:top-24">
            <PreviaWhatsApp mensagens={[previa(aba, texto)]} />
          </div>
        </div>
      )}
      <SettingsFooter left="O texto de cada aba é salvo junto.">
        <Button onClick={onSalvar} loading={salvando} disabled={carregando}>
          <Save className="h-4 w-4" /> {rotuloSalvar}
        </Button>
      </SettingsFooter>
    </section>
  );
}

/** Substitui {{VARIAVEL}} por valores de exemplo (prévia local). */
export function aplicarExemplo(texto: string, valores: Record<string, string>) {
  return texto.replace(/\{\{([A-Z_]+)\}\}/g, (m, k: string) => (k in valores ? valores[k] : m));
}
