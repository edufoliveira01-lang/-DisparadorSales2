import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Inbox, RefreshCw, Search, Send, WifiOff } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { CardViewModel, Contact, Template, WhatsappState } from "@/lib/types";
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
type FiltroTipo = "todos" | "medica" | "social" | "ambas";

export function Dashboard() {
  const { show } = useToast();
  const navigate = useNavigate();

  const [cards, setCards] = useState<CardViewModel[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [whatsapp, setWhatsapp] = useState<WhatsappState>({ status: "desconectado", qrDataUrl: null, lastError: null });

  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [contatoOverrides, setContatoOverrides] = useState<Record<string, Contact>>({});
  const [enviandoCardId, setEnviandoCardId] = useState<string | null>(null);

  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>("todos");
  const [filtroTipo, setFiltroTipo] = useState<FiltroTipo>("todos");

  const [preview, setPreview] = useState<{ card: CardViewModel; mensagens: string[] } | null>(null);
  const [batchConfirm, setBatchConfirm] = useState(false);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ ativo: boolean; total: number } | null>(null);

  const [cadastro, setCadastro] = useState<{ card: CardViewModel; nome: string; telefone: string; observacoes: string } | null>(
    null
  );
  const [salvandoContato, setSalvandoContato] = useState(false);

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
    
    const eventSource = new EventSource(`${api.baseUrl}/whatsapp/events`);
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setWhatsapp(data);
      } catch (err) {
        console.error("Erro ao processar evento de WhatsApp:", err);
      }
    };

    return () => {
      eventSource.close();
    };
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
    // Se for sucesso, recarregar a lista para refletir a mudança de board/status se necessário
    if (payload.status === "sucesso") {
      carregarCards();
    }
  });

  useSocketEvent<{ total: number }>("send:batch-started", ({ total }) => {
    setBatchProgress({ ativo: true, total });
    show(`Envio em lote iniciado (${total} card${total > 1 ? "s" : ""}).`, "info");
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
    return card.contato || contatoOverrides[card.cardId] || null;
  }

  const cardsFiltrados = useMemo(() => {
    if (!cards) return [];
    const termo = busca.trim().toLowerCase();
    return cards.filter((card) => {
      if (termo && !card.nomeCliente.toLowerCase().includes(termo) && !card.cardNome.toLowerCase().includes(termo)) {
        return false;
      }
      if (filtroStatus === "enviado" && card.ultimoEnvio?.status !== "sucesso") return false;
      if (filtroStatus === "falhou" && card.ultimoEnvio?.status !== "falha") return false;
      if (filtroStatus === "nao_enviado" && card.ultimoEnvio) return false;

      if (filtroTipo !== "todos") {
        const origens = card.pericias.map((p) => p.origem || "geral");
        if (filtroTipo === "ambas" && card.pericias.length < 2) return false;
        if (filtroTipo === "medica" && !origens.includes("medica")) return false;
        if (filtroTipo === "social" && !origens.includes("social")) return false;
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

  function usarSugestao(card: CardViewModel) {
    if (!card.sugestaoContato) return;
    setContatoOverrides((prev) => ({ ...prev, [card.cardId]: card.sugestaoContato! }));
  }

  function abrirCadastro(card: CardViewModel) {
    setCadastro({ card, nome: card.nomeCliente, telefone: "", observacoes: "" });
  }

  async function salvarCadastroRapido() {
    if (!cadastro) return;
    setSalvandoContato(true);
    try {
      const contato = await api.post<Contact>("/contacts", {
        nome: cadastro.nome,
        telefone: cadastro.telefone,
        observacoes: cadastro.observacoes,
      });
      setContatoOverrides((prev) => ({ ...prev, [cadastro.card.cardId]: contato }));
      show("Contato cadastrado.", "success");
      setCadastro(null);
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao cadastrar contato.", "error");
    } finally {
      setSalvandoContato(false);
    }
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
    if (!templateId) {
      show("Selecione um template de mensagem.", "error");
      return;
    }
    try {
      const { mensagens } = await api.post<{ mensagens: string[] }>("/templates/preview", {
        templateId,
        nome: card.nomeCliente,
        pericias: card.pericias,
      });
      setPreview({ card, mensagens });
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao gerar pré-visualização.", "error");
    }
  }

  async function confirmarEnvioIndividual() {
    if (!preview || !templateId) return;
    const contato = contatoEfetivo(preview.card);
    if (!contato) return;

    setEnviandoCardId(preview.card.cardId);
    setPreview(null);
    try {
      await api.post("/send/single", {
        cardId: preview.card.cardId,
        nomeCliente: preview.card.nomeCliente,
        telefone: contato.telefone,
        contactId: contato.id,
        pericias: preview.card.pericias,
        templateId,
      });
      show(`Mensagem enviada para ${preview.card.nomeCliente}.`, "success");
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao enviar mensagem.", "error");
    } finally {
      setEnviandoCardId(null);
    }
  }

  const cardsSelecionadosValidos = useMemo(
    () => cardsFiltrados.filter((c) => selecionados.has(c.cardId) && contatoEfetivo(c) && c.pericias.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cardsFiltrados, selecionados, contatoOverrides]
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
    if (!templateId) return;
    setBatchLoading(true);
    try {
      const items = cardsSelecionadosValidos.map((card) => {
        const contato = contatoEfetivo(card)!;
        return {
          cardId: card.cardId,
          nomeCliente: card.nomeCliente,
          telefone: contato.telefone,
          contactId: contato.id,
          pericias: card.pericias,
        };
      });
      await api.post("/send/batch", { items, templateId });
      setBatchConfirm(false);
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao iniciar envio em lote.", "error");
    } finally {
      setBatchLoading(false);
    }
  }

  return (
    <div className="w-full max-w-full space-y-6 overflow-x-hidden">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Dashboard</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Cards da lista do Trello configurada.</p>
        </div>
        <div className="flex items-center gap-2">
          {whatsapp.status !== "conectado" && (
            <Badge tone="warning" className="flex">
              <WifiOff className="h-3.5 w-3.5" /> <span className="hidden xs:inline ml-1">WhatsApp desconectado</span>
            </Badge>
          )}
          <Button variant="outline" onClick={carregarCards} loading={carregando} className="flex-1 sm:flex-none">
            <RefreshCw className="h-4 w-4" /> <span className="xs:inline">Atualizar</span>
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
          <div className="flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <Input 
                placeholder="Buscar cliente ou card..." 
                className="pl-9 h-11 text-base sm:text-sm" 
                value={busca} 
                onChange={(e) => setBusca(e.target.value)} 
              />
            </div>
            
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="grid grid-cols-2 gap-2 flex-1 sm:grid-cols-3 lg:grid-cols-3">
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase font-bold text-zinc-400 ml-1">Status</Label>
                  <Select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value as FiltroStatus)} className="h-10 text-sm">
                    <option value="todos">Todos</option>
                    <option value="nao_enviado">Não env.</option>
                    <option value="enviado">Enviados</option>
                    <option value="falhou">Falhas</option>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase font-bold text-zinc-400 ml-1">Perícia</Label>
                  <Select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value as FiltroTipo)} className="h-10 text-sm">
                    <option value="todos">Todas</option>
                    <option value="medica">Médica</option>
                    <option value="social">Social</option>
                    <option value="ambas">Ambas</option>
                  </Select>
                </div>
                <div className="space-y-1 col-span-2 sm:col-span-1">
                  <Label className="text-[10px] uppercase font-bold text-zinc-400 ml-1">Template</Label>
                  <Select value={templateId ?? ""} onChange={(e) => setTemplateId(Number(e.target.value))} className="h-10 text-sm">
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>{t.nome}</option>
                    ))}
                  </Select>
                </div>
              </div>
              
              <div className="pt-2 lg:pt-5">
                <Button 
                  onClick={abrirConfirmBatch} 
                  disabled={selecionados.size === 0 || Boolean(batchProgress)} 
                  className="w-full h-11 lg:w-auto px-6"
                >
                  <Send className="h-4 w-4" /> Enviar Selecionados ({selecionados.size})
                </Button>
              </div>
            </div>
          </div>

          {batchProgress?.ativo && (
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
                  card={card}
                  selecionado={selecionados.has(card.cardId)}
                  onToggleSelecionar={() => toggleSelecionado(card.cardId)}
                  temContatoEfetivo={Boolean(contatoEfetivo(card))}
                  onEnviar={() => abrirPreview(card)}
                  onCadastrarContato={() => abrirCadastro(card)}
                  onUsarSugestao={() => usarSugestao(card)}
                  enviando={enviandoCardId === card.cardId}
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
              <span>{c.nomeCliente}</span>
              <span className="text-xs text-zinc-400">{c.pericias.length} perícia(s)</span>
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
        title="Cadastrar contato"
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
                onChange={(e) => setCadastro({ ...cadastro, telefone: e.target.value })}
                placeholder="Ex: 5511999999999"
              />
            </div>
            <div>
              <Label>Observações</Label>
              <Textarea rows={2} value={cadastro.observacoes} onChange={(e) => setCadastro({ ...cadastro, observacoes: e.target.value })} />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
