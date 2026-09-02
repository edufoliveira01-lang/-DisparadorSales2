import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Inbox, RefreshCw, Search, Send, WifiOff } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { formatPhoneDisplay, formatPhoneInput } from "@/lib/phone";
import { cn } from "@/lib/utils";
import type { CardViewModel, Contact, ModoEnvio, Pericia, Settings, Template } from "@/lib/types";
import { classificarModalidadeAudiencia } from "@/lib/audiencia";
import { useWhatsapp } from "@/context/WhatsappContext";
import { useSocketEvent } from "@/hooks/useSocketEvent";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { CardItem } from "@/components/CardItem";

type FiltroStatus = "todos" | "enviado" | "nao_enviado" | "falhou";
type FiltroTipo = "todos" | "medica" | "social" | "audiencia";

const STATUS_OPTIONS: { value: FiltroStatus; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "nao_enviado", label: "Pendentes" },
  { value: "enviado", label: "Enviados" },
  { value: "falhou", label: "Falhas" },
];

const TIPO_OPTIONS: { value: FiltroTipo; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "medica", label: "Médica" },
  { value: "social", label: "Social" },
  { value: "audiencia", label: "Audiência" },
];

const MODALIDADE_POR_MODO: Record<Exclude<ModoEnvio, "template">, "presencial" | "online" | "hibrida"> = {
  audiencia_presencial: "presencial",
  audiencia_online: "online",
  audiencia_hibrida: "hibrida",
};

export function Dashboard() {
  const { show } = useToast();
  const navigate = useNavigate();

  const [cards, setCards] = useState<CardViewModel[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState<number | null>(null);
  const whatsapp = useWhatsapp();

  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [contatoOverrides, setContatoOverrides] = useState<Record<string, Contact>>({});
  const [nomeOverrides, setNomeOverrides] = useState<Record<string, string>>({});
  const [periciasOverrides, setPericiasOverrides] = useState<Record<string, Pericia[]>>({});
  const [modoOverrides, setModoOverrides] = useState<Record<string, ModoEnvio>>({});
  const [mensagensAudiencia, setMensagensAudiencia] = useState({ presencial: "", online: "", hibrida: "" });
  const [intervaloEnvio, setIntervaloEnvio] = useState({ min: 5, max: 15 });
  const [enviandoCardId, setEnviandoCardId] = useState<string | null>(null);

  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>("todos");
  const [filtroTipo, setFiltroTipo] = useState<FiltroTipo>("todos");

  const [preview, setPreview] = useState<{ card: CardViewModel; mensagens: string[]; modo: ModoEnvio } | null>(null);
  const [batchConfirm, setBatchConfirm] = useState(false);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ ativo: boolean; total: number; aguardandoReconexao?: boolean } | null>(
    null
  );

  const [cadastro, setCadastro] = useState<{
    card: CardViewModel;
    nome: string;
    telefone: string;
    processo: string;
    observacoes: string;
    contatoId?: number;
  } | null>(null);
  const [salvandoContato, setSalvandoContato] = useState(false);

  const [edicaoNome, setEdicaoNome] = useState<{ card: CardViewModel; nome: string } | null>(null);
  const [edicaoPericia, setEdicaoPericia] = useState<{ card: CardViewModel; index: number; pericia: Pericia } | null>(null);

  const carregarCards = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const data = await api.get<CardViewModel[]>("/cards");
      setCards(data);
    } catch (err) {
      setCards([]);
      setErro(err instanceof ApiError ? err.message : "Erro ao carregar os cards do Trello.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregarCards();
    api.get<Template[]>("/templates").then((data) => {
      setTemplates(data);
      if (data.length > 0) setTemplateId(data[0].id);
    });
    api.get<Settings>("/settings").then((data) => {
      setMensagensAudiencia({
        presencial: data.audiencia_presencial_mensagem ?? "",
        online: data.audiencia_online_mensagem ?? "",
        hibrida: data.audiencia_hibrida_mensagem ?? "",
      });
      setIntervaloEnvio({
        min: Number(data.send_interval_min) || 5,
        max: Number(data.send_interval_max) || 15,
      });
    });
  }, [carregarCards]);

  useSocketEvent<{ cardId: string; status: "sucesso" | "falha"; erro?: string }>("send:update", (payload) => {
    setEnviandoCardId(null);
    setCards((prev) =>
      prev
        ? prev.map((c) =>
            c.cardId === payload.cardId
              ? { ...c, ultimoEnvio: { status: payload.status, data: new Date().toISOString(), erro: payload.erro || null } }
              : c
          )
        : prev
    );
  });

  useSocketEvent<{ total: number }>("send:batch-started", ({ total }) => {
    setBatchProgress({ ativo: true, total });
    show(`Envio em lote iniciado (${total} card${total > 1 ? "s" : ""}).`, "info");
  });
  useSocketEvent<{ reason: string; total: number }>("send:batch-waiting-reconnect", ({ reason, total }) => {
    setBatchProgress({ ativo: true, total, aguardandoReconexao: true });
    show(reason, "error");
  });
  useSocketEvent("send:batch-resumed", () => {
    setBatchProgress((prev) => (prev ? { ...prev, aguardandoReconexao: false } : prev));
    show("WhatsApp reconectado — envio em lote retomado automaticamente.", "success");
  });
  useSocketEvent<{ reason: string }>("send:batch-paused", ({ reason }) => {
    setBatchProgress(null);
    show(reason, "error");
  });
  useSocketEvent("send:batch-completed", () => {
    setBatchProgress(null);
    show("Envio em lote concluído.", "success");
    setSelecionados(new Set());
    carregarCards();
  });

  function contatoEfetivo(card: CardViewModel): Contact | null {
    return contatoOverrides[card.cardId] || card.contato || null;
  }

  function nomeEfetivo(card: CardViewModel): string {
    return nomeOverrides[card.cardId] ?? card.nomeCliente;
  }

  function periciasEfetivas(card: CardViewModel): Pericia[] {
    return periciasOverrides[card.cardId] ?? card.pericias;
  }

  function processoDoCard(card: CardViewModel): string {
    return periciasEfetivas(card).map((p) => p.processo || "").find((processo) => processo.trim()) || "";
  }

  function criterioContatoEfetivo(card: CardViewModel): CardViewModel["criterioContato"] | "manual" {
    return contatoOverrides[card.cardId] ? "manual" : card.criterioContato;
  }

  /** Aplica os overrides locais (nome, perícias, contato) — são os dados usados na mensagem enviada. */
  function cardEfetivo(card: CardViewModel): CardViewModel {
    return {
      ...card,
      nomeCliente: nomeEfetivo(card),
      pericias: periciasEfetivas(card),
      contato: contatoEfetivo(card),
    };
  }

  /** true quando o card tem uma perícia marcada como audiência (cabeçalho "AUDIÊNCIA" no card do Trello). */
  function temAudiencia(card: CardViewModel): boolean {
    return periciasEfetivas(card).some((p) => p.origem === "audiencia");
  }

  /** Modo de envio detectado automaticamente a partir da descrição do card. */
  function modoDetectado(card: CardViewModel): ModoEnvio {
    const pericia = periciasEfetivas(card).find((p) => p.origem === "audiencia");
    if (!pericia) return "template";
    const modalidade = classificarModalidadeAudiencia(pericia.tipo);
    if (modalidade === "online") return "audiencia_online";
    if (modalidade === "hibrida") return "audiencia_hibrida";
    return "audiencia_presencial";
  }

  /** Modo efetivo: usa o override manual se o usuário tiver ajustado, senão o detectado automaticamente. */
  function modoEfetivo(card: CardViewModel): ModoEnvio {
    return modoOverrides[card.cardId] ?? modoDetectado(card);
  }

  function renderAudienciaLocal(mensagem: string, nome: string, pericia: Pericia): string {
    return mensagem
      .replace(/\{\{NOME\}\}/g, nome)
      .replace(/\{\{TIPO_PERICIA\}\}/g, pericia.tipo)
      .replace(/\{\{DATA\}\}/g, pericia.data)
      .replace(/\{\{HORARIO\}\}/g, pericia.horario)
      .replace(/\{\{LOCAL\}\}/g, pericia.local)
      .replace(/\{\{TELEFONE\}\}/g, pericia.telefone || "")
      .replace(/\{\{WHATSAPP\}\}/g, pericia.whatsapp || "")
      .replace(/\{\{PROCESSO\}\}/g, pericia.processo || "")
      .replace(/\{\{PROFISSIONAL_PERITO\}\}/g, pericia.profissionalPerito || "");
  }

  const cardsFiltrados = useMemo(() => {
    if (!cards) return [];
    const termo = busca.trim().toLowerCase();
    return cards.filter((card) => {
      if (termo) {
        const processoOuProfissional = card.pericias.some(
          (p) =>
            (p.processo || "").toLowerCase().includes(termo) ||
            (p.profissionalPerito || "").toLowerCase().includes(termo)
        );
        if (
          !card.nomeCliente.toLowerCase().includes(termo) &&
          !card.cardNome.toLowerCase().includes(termo) &&
          !processoOuProfissional
        ) {
          return false;
        }
      }
      if (filtroStatus === "enviado" && card.ultimoEnvio?.status !== "sucesso") return false;
      if (filtroStatus === "falhou" && card.ultimoEnvio?.status !== "falha") return false;
      if (filtroStatus === "nao_enviado" && card.ultimoEnvio) return false;

      if (filtroTipo !== "todos") {
        const origens = card.pericias.map((p) => p.origem || "geral");
        if (filtroTipo === "medica" && !origens.includes("medica")) return false;
        if (filtroTipo === "social" && !origens.includes("social")) return false;
        if (filtroTipo === "audiencia" && !origens.includes("audiencia")) return false;
      }
      return true;
    });
  }, [cards, busca, filtroStatus, filtroTipo]);

  function toggleSelecionado(cardId: string) {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  }

  function toggleSelecionarTodos() {
    const todosVisiveisSelecionados = cardsFiltrados.every((c) => selecionados.has(c.cardId));
    if (todosVisiveisSelecionados) {
      setSelecionados((prev) => {
        const next = new Set(prev);
        cardsFiltrados.forEach((c) => next.delete(c.cardId));
        return next;
      });
    } else {
      setSelecionados((prev) => {
        const next = new Set(prev);
        cardsFiltrados.forEach((c) => next.add(c.cardId));
        return next;
      });
    }
  }

  function usarSugestao(card: CardViewModel) {
    if (!card.sugestaoContato) return;
    setContatoOverrides((prev) => ({ ...prev, [card.cardId]: card.sugestaoContato! }));
  }

  function abrirCadastro(card: CardViewModel) {
    setCadastro({ card, nome: nomeEfetivo(card), telefone: "", processo: processoDoCard(card), observacoes: "" });
  }

  function abrirEdicaoContato(card: CardViewModel) {
    const contato = contatoEfetivo(card);
    if (!contato) return;
    setCadastro({
      card,
      nome: contato.nome,
      telefone: formatPhoneDisplay(contato.telefone),
      processo: contato.processo || processoDoCard(card),
      observacoes: contato.observacoes || "",
      contatoId: contato.id,
    });
  }

  async function salvarCadastroRapido() {
    if (!cadastro) return;
    setSalvandoContato(true);
    try {
      const payload = {
        nome: cadastro.nome,
        telefone: cadastro.telefone,
        processo: cadastro.processo,
        observacoes: cadastro.observacoes,
      };
      const contato = cadastro.contatoId
        ? await api.put<Contact>(`/contacts/${cadastro.contatoId}`, payload)
        : await api.post<Contact>("/contacts", payload);
      setContatoOverrides((prev) => ({ ...prev, [cadastro.card.cardId]: contato }));
      show(cadastro.contatoId ? "Contato atualizado." : "Contato cadastrado.", "success");
      setCadastro(null);
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao salvar contato.", "error");
    } finally {
      setSalvandoContato(false);
    }
  }

  function abrirEdicaoNome(card: CardViewModel) {
    setEdicaoNome({ card, nome: nomeEfetivo(card) });
  }

  function salvarEdicaoNome() {
    if (!edicaoNome || !edicaoNome.nome.trim()) return;
    setNomeOverrides((prev) => ({ ...prev, [edicaoNome.card.cardId]: edicaoNome.nome.trim() }));
    setEdicaoNome(null);
  }

  function abrirEdicaoPericia(card: CardViewModel, index: number) {
    const pericias = periciasEfetivas(card);
    setEdicaoPericia({ card, index, pericia: { ...pericias[index] } });
  }

  function salvarEdicaoPericia() {
    if (!edicaoPericia) return;
    const { card, index, pericia } = edicaoPericia;
    const atuais = periciasEfetivas(card);
    const atualizadas = atuais.map((p, i) => (i === index ? pericia : p));
    setPericiasOverrides((prev) => ({ ...prev, [card.cardId]: atualizadas }));
    setEdicaoPericia(null);
  }

  async function abrirPreview(card: CardViewModel) {
    if (whatsapp.status !== "conectado") {
      show("Conecte o WhatsApp antes de enviar mensagens.", "error");
      navigate("/configuracoes");
      return;
    }
    const contato = contatoEfetivo(card);
    if (!contato) {
      show("Cadastre o contato deste cliente antes de enviar.", "error");
      return;
    }
    const modo = modoEfetivo(card);
    const cardComOverrides = cardEfetivo(card);

    if (modo !== "template") {
      const pericia = cardComOverrides.pericias[0];
      if (!pericia) {
        show("Nenhuma perícia identificada para gerar mensagem.", "error");
        return;
      }
      const mensagemConfigurada = mensagensAudiencia[MODALIDADE_POR_MODO[modo]];
      const mensagem = renderAudienciaLocal(mensagemConfigurada, cardComOverrides.nomeCliente, pericia);
      setPreview({ card: cardComOverrides, mensagens: [mensagem], modo });
      return;
    }

    if (!templateId) {
      show("Selecione um template de mensagem.", "error");
      return;
    }
    try {
      const { mensagens } = await api.post<{ mensagens: string[] }>("/templates/preview", {
        templateId,
        nome: cardComOverrides.nomeCliente,
        pericias: cardComOverrides.pericias,
      });
      setPreview({ card: cardComOverrides, mensagens, modo: "template" });
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao gerar pré-visualização.", "error");
    }
  }

  async function confirmarEnvioIndividual() {
    if (!preview) return;
    const contato = contatoEfetivo(preview.card);
    if (!contato) return;
    if (preview.modo === "template" && !templateId) return;

    setEnviandoCardId(preview.card.cardId);
    setPreview(null);
    try {
      await api.post("/send/single", {
        cardId: preview.card.cardId,
        nomeCliente: preview.card.nomeCliente,
        telefone: contato.telefone,
        contactId: contato.id,
        pericias: preview.card.pericias,
        templateId: preview.modo === "template" ? templateId : undefined,
        modo: preview.modo,
      });
      show(`Mensagem enviada para ${preview.card.nomeCliente}.`, "success");
      // Recarregar cards para refletir possível movimentação no Trello
      carregarCards();
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao enviar mensagem.", "error");
    } finally {
      setEnviandoCardId(null);
    }
  }

  const cardsSelecionadosValidos = useMemo(
    () => cardsFiltrados.filter((c) => selecionados.has(c.cardId) && contatoEfetivo(c) && periciasEfetivas(c).length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cardsFiltrados, selecionados, contatoOverrides, nomeOverrides, periciasOverrides]
  );

  function abrirConfirmBatch() {
    if (whatsapp.status !== "conectado") {
      show("Conecte o WhatsApp antes de enviar mensagens.", "error");
      navigate("/configuracoes");
      return;
    }
    if (cardsSelecionadosValidos.length === 0) {
      show("Selecione ao menos um card com contato cadastrado.", "error");
      return;
    }
    setBatchConfirm(true);
  }

  async function confirmarBatch() {
    setBatchLoading(true);
    try {
      const items = cardsSelecionadosValidos.map((card) => {
        const contato = contatoEfetivo(card)!;
        const cardComOverrides = cardEfetivo(card);
        return {
          cardId: card.cardId,
          nomeCliente: cardComOverrides.nomeCliente,
          telefone: contato.telefone,
          contactId: contato.id,
          pericias: cardComOverrides.pericias,
          modo: modoEfetivo(card),
        };
      });
      await api.post("/send/batch", {
        items,
        templateId,
        intervalMinSec: intervaloEnvio.min,
        intervalMaxSec: intervaloEnvio.max,
      });
      setBatchConfirm(false);
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao iniciar envio em lote.", "error");
    } finally {
      setBatchLoading(false);
    }
  }

  return (
    <div className="space-y-5 md:space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 md:text-3xl">Dashboard</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Revise os dados do Trello e envie mensagens com segurança.</p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Badge tone={whatsapp.status === "conectado" ? "success" : "warning"}>
            {whatsapp.status === "conectado" ? (
              <><span className="h-2 w-2 rounded-full bg-accent-500" /> WhatsApp conectado</>
            ) : (
              <><WifiOff className="h-3.5 w-3.5" /> WhatsApp desconectado</>
            )}
          </Badge>
          <Button variant="outline" onClick={carregarCards} loading={carregando}>
            <RefreshCw className="h-4 w-4" /> Atualizar
          </Button>
        </div>
      </div>

      {erro ? (
        <EmptyState
          icon={Inbox}
          title="Não foi possível carregar os cards"
          description={erro}
          action={
            <Button variant="outline" onClick={() => navigate("/configuracoes")}>
              Ir para Configurações
            </Button>
          }
        />
      ) : (
        <>
          <div className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-soft dark:border-zinc-800 dark:bg-zinc-900 md:p-4">
            <div className="grid grid-cols-2 gap-2 md:hidden">
              <div className="relative col-span-2">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <Input
                  placeholder="Buscar cliente, processo ou perito…"
                  className="pl-9"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                />
              </div>
              <Select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value as FiltroStatus)} className="w-full">
                <option value="todos">Todos os status</option>
                <option value="nao_enviado">Pendentes</option>
                <option value="enviado">Enviados</option>
                <option value="falhou">Falhas</option>
              </Select>
              <Select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value as FiltroTipo)} className="w-full">
                <option value="todos">Todos os tipos</option>
                <option value="medica">Perícia médica</option>
                <option value="social">Perícia social</option>
                <option value="audiencia">Audiência</option>
              </Select>
              <Select value={templateId ?? ""} onChange={(e) => setTemplateId(Number(e.target.value))} className="col-span-2 w-full">
                {templates.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
              </Select>
            </div>

            <div className="hidden md:block">
              <div className="grid gap-4 lg:grid-cols-[minmax(320px,1fr)_280px]">
                <div>
                  <p className="mb-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Buscar cartões</p>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                    <Input
                      placeholder="Nome, processo ou profissional/perito…"
                      className="pl-9"
                      value={busca}
                      onChange={(e) => setBusca(e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <p className="mb-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Template de envio</p>
                  <Select value={templateId ?? ""} onChange={(e) => setTemplateId(Number(e.target.value))} className="w-full">
                    {templates.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
                  </Select>
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800 xl:flex-row xl:items-center">
                <FiltroRapido
                  label="Situação"
                  options={STATUS_OPTIONS}
                  value={filtroStatus}
                  onChange={(value) => setFiltroStatus(value as FiltroStatus)}
                />
                <div className="hidden h-7 w-px bg-zinc-200 dark:bg-zinc-700 xl:block" />
                <FiltroRapido
                  label="Tipo"
                  options={TIPO_OPTIONS}
                  value={filtroTipo}
                  onChange={(value) => setFiltroTipo(value as FiltroTipo)}
                />
              </div>
            </div>
            <div className="mt-3 flex flex-col gap-3 border-t border-zinc-100 pt-3 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {cardsFiltrados.length} de {cards?.length ?? 0} card(s) exibido(s) · {selecionados.size} selecionado(s)
              </p>
              <div className="grid grid-cols-2 gap-2 sm:flex">
              <Button
                variant="outline"
                onClick={toggleSelecionarTodos}
                disabled={cardsFiltrados.length === 0 || Boolean(batchProgress)}
              >
                {cardsFiltrados.length > 0 && cardsFiltrados.every((c) => selecionados.has(c.cardId))
                  ? "Desmarcar todos"
                  : "Selecionar todos"}
              </Button>
              <Button className="min-w-0" onClick={abrirConfirmBatch} disabled={selecionados.size === 0 || Boolean(batchProgress)}>
                <Send className="h-4 w-4" /> <span className="truncate">Enviar selecionados ({selecionados.size})</span>
              </Button>
              </div>
            </div>
          </div>

          {batchProgress?.ativo && batchProgress.aguardandoReconexao && (
            <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
              <WifiOff className="h-4 w-4" /> WhatsApp desconectou — aguardando reconexão para continuar o envio em lote
              automaticamente.
            </div>
          )}
          {batchProgress?.ativo && !batchProgress.aguardandoReconexao && (
            <div className="flex items-center gap-2 rounded-xl bg-accent-50 px-4 py-2.5 text-sm text-accent-700 dark:bg-accent-900/20 dark:text-accent-300">
              <RefreshCw className="h-4 w-4 animate-spin" /> Enviando em lote… acompanhe os status atualizando em tempo real.
            </div>
          )}

          {cards === null ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-40 w-full" />
              ))}
            </div>
          ) : cardsFiltrados.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title={cards.length === 0 ? "Nenhum card encontrado na lista" : "Nenhum card corresponde aos filtros"}
              description={
                cards.length === 0
                  ? "Verifique se a lista configurada tem cards ou ajuste a lista em Configurações."
                  : "Tente ajustar a busca ou os filtros aplicados."
              }
            />
          ) : (
            <div className="space-y-3">
              {cardsFiltrados.map((card) => (
                <CardItem
                  key={card.cardId}
                  card={cardEfetivo(card)}
                  selecionado={selecionados.has(card.cardId)}
                  onToggleSelecionar={() => toggleSelecionado(card.cardId)}
                  contatoEfetivo={contatoEfetivo(card)}
                  criterioContato={criterioContatoEfetivo(card)}
                  onEnviar={() => abrirPreview(card)}
                  onCadastrarContato={() => abrirCadastro(card)}
                  onEditarContato={() => abrirEdicaoContato(card)}
                  onEditarNome={() => abrirEdicaoNome(card)}
                  onEditarPericia={(index) => abrirEdicaoPericia(card, index)}
                  onUsarSugestao={() => usarSugestao(card)}
                  enviando={enviandoCardId === card.cardId}
                  temAudiencia={temAudiencia(card)}
                  modo={modoEfetivo(card)}
                  onChangeModo={(modo) => setModoOverrides((prev) => ({ ...prev, [card.cardId]: modo }))}
                />
              ))}
            </div>
          )}
        </>
      )}

      <Modal
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        title={`Confirmar envio para ${preview?.card.nomeCliente ?? ""}`}
        maxWidth="max-w-xl"
        footer={
          <>
            <Button variant="outline" onClick={() => setPreview(null)}>
              Cancelar
            </Button>
            <Button onClick={confirmarEnvioIndividual}>
              <Send className="h-4 w-4" /> Confirmar envio
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {preview?.mensagens.map((msg, i) => (
            <div
              key={i}
              className="whitespace-pre-wrap rounded-2xl rounded-tl-none bg-accent-50 px-4 py-3 text-sm text-zinc-800 dark:bg-accent-900/20 dark:text-zinc-200"
            >
              {msg}
            </div>
          ))}
        </div>
      </Modal>

      <Modal
        open={batchConfirm}
        onClose={() => setBatchConfirm(false)}
        title="Confirmar envio em lote"
        description={`${cardsSelecionadosValidos.length} mensagem(ns) será(ão) enviada(s), com intervalo aleatório entre elas.`}
        footer={
          <>
            <Button variant="outline" onClick={() => setBatchConfirm(false)}>
              Cancelar
            </Button>
            <Button onClick={confirmarBatch} loading={batchLoading}>
              <Send className="h-4 w-4" /> Iniciar envio
            </Button>
          </>
        }
      >
        <ul className="max-h-64 space-y-1.5 overflow-y-auto text-sm text-zinc-600 dark:text-zinc-300">
          {cardsSelecionadosValidos.map((c) => (
            <li key={c.cardId} className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/50">
              <span>{nomeEfetivo(c)}</span>
              <span className="text-xs text-zinc-400">{periciasEfetivas(c).length} perícia(s)</span>
            </li>
          ))}
        </ul>
        {selecionados.size > cardsSelecionadosValidos.length && (
          <p className="mt-3 text-xs text-amber-600 dark:text-amber-500">
            {selecionados.size - cardsSelecionadosValidos.length} card(s) selecionado(s) foram ignorados por não terem contato
            cadastrado ou perícia identificada.
          </p>
        )}
      </Modal>

      <Modal
        open={Boolean(cadastro)}
        onClose={() => setCadastro(null)}
        title={cadastro?.contatoId ? "Editar contato" : "Cadastrar contato"}
        footer={
          <>
            <Button variant="outline" onClick={() => setCadastro(null)}>
              Cancelar
            </Button>
            <Button onClick={salvarCadastroRapido} loading={salvandoContato} disabled={!cadastro?.telefone.trim()}>
              Salvar
            </Button>
          </>
        }
      >
        {cadastro && (
          <div className="space-y-4">
            <div>
              <Label>Nome</Label>
              <Input value={cadastro.nome} onChange={(e) => setCadastro({ ...cadastro, nome: e.target.value })} />
            </div>
            <div>
              <Label>Telefone</Label>
              <Input
                value={cadastro.telefone}
                onChange={(e) => setCadastro({ ...cadastro, telefone: formatPhoneInput(e.target.value) })}
                placeholder="Ex: (11) 99999-8888"
              />
            </div>
            <div>
              <Label>Número do processo</Label>
              <Input
                value={cadastro.processo}
                onChange={(e) => setCadastro({ ...cadastro, processo: e.target.value })}
                placeholder="Ex: 5364774-26.2026.8.09.0006"
              />
              <p className="mt-1 text-xs text-zinc-400">Confirma o vínculo entre o cartão e o contato da Agenda.</p>
            </div>
            <div>
              <Label>Observações</Label>
              <Textarea rows={2} value={cadastro.observacoes} onChange={(e) => setCadastro({ ...cadastro, observacoes: e.target.value })} />
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(edicaoNome)}
        onClose={() => setEdicaoNome(null)}
        title="Editar nome do cliente"
        description="Esse é o nome usado na variável {{NOME}} da mensagem enviada."
        footer={
          <>
            <Button variant="outline" onClick={() => setEdicaoNome(null)}>
              Cancelar
            </Button>
            <Button onClick={salvarEdicaoNome} disabled={!edicaoNome?.nome.trim()}>
              Salvar
            </Button>
          </>
        }
      >
        {edicaoNome && (
          <div>
            <Label>Nome</Label>
            <Input value={edicaoNome.nome} onChange={(e) => setEdicaoNome({ ...edicaoNome, nome: e.target.value })} />
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(edicaoPericia)}
        onClose={() => setEdicaoPericia(null)}
        title="Editar informações da perícia"
        description="Esses dados são usados nas variáveis da mensagem enviada."
        footer={
          <>
            <Button variant="outline" onClick={() => setEdicaoPericia(null)}>
              Cancelar
            </Button>
            <Button onClick={salvarEdicaoPericia}>Salvar</Button>
          </>
        }
      >
        {edicaoPericia && (
          <div className="space-y-4">
            <div>
              <Label>Tipo de perícia</Label>
              <Input
                value={edicaoPericia.pericia.tipo}
                onChange={(e) => setEdicaoPericia({ ...edicaoPericia, pericia: { ...edicaoPericia.pericia, tipo: e.target.value } })}
              />
            </div>
            <div>
              <Label>Data</Label>
              <Input
                value={edicaoPericia.pericia.data}
                onChange={(e) => setEdicaoPericia({ ...edicaoPericia, pericia: { ...edicaoPericia.pericia, data: e.target.value } })}
                placeholder="Ex: 15/07/2026"
              />
            </div>
            <div>
              <Label>Horário</Label>
              <Input
                value={edicaoPericia.pericia.horario}
                onChange={(e) => setEdicaoPericia({ ...edicaoPericia, pericia: { ...edicaoPericia.pericia, horario: e.target.value } })}
                placeholder="Ex: 14:30"
              />
            </div>
            <div>
              <Label>Local</Label>
              <Input
                value={edicaoPericia.pericia.local}
                onChange={(e) => setEdicaoPericia({ ...edicaoPericia, pericia: { ...edicaoPericia.pericia, local: e.target.value } })}
              />
            </div>
            <div>
              <Label>Telefone informado no cartão</Label>
              <Input
                value={edicaoPericia.pericia.telefone}
                onChange={(e) =>
                  setEdicaoPericia({
                    ...edicaoPericia,
                    pericia: { ...edicaoPericia.pericia, telefone: e.target.value },
                  })
                }
              />
            </div>
            <div>
              <Label>WhatsApp</Label>
              <Input
                value={edicaoPericia.pericia.whatsapp || ""}
                onChange={(e) =>
                  setEdicaoPericia({
                    ...edicaoPericia,
                    pericia: { ...edicaoPericia.pericia, whatsapp: e.target.value },
                  })
                }
                placeholder="Ex: SIM"
              />
            </div>
            <div>
              <Label>Número do processo</Label>
              <Input
                value={edicaoPericia.pericia.processo || ""}
                onChange={(e) =>
                  setEdicaoPericia({
                    ...edicaoPericia,
                    pericia: { ...edicaoPericia.pericia, processo: e.target.value },
                  })
                }
                placeholder="Ex: 5364774-26.2026.8.09.0006"
              />
            </div>
            <div>
              <Label>Profissional / Perito</Label>
              <Input
                value={edicaoPericia.pericia.profissionalPerito || ""}
                onChange={(e) =>
                  setEdicaoPericia({
                    ...edicaoPericia,
                    pericia: { ...edicaoPericia.pericia, profissionalPerito: e.target.value },
                  })
                }
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function FiltroRapido({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</span>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
            value === option.value
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
