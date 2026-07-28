import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Inbox, RefreshCw, Search, Send, WifiOff } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { formatPhoneInput } from "@/lib/phone";
import type { CardViewModel, Contact, Pericia, Template, WhatsappState } from "@/lib/types";
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
  const [nomeOverrides, setNomeOverrides] = useState<Record<string, string>>({});
  const [periciasOverrides, setPericiasOverrides] = useState<Record<string, Pericia[]>>({});
  const [enviandoCardId, setEnviandoCardId] = useState<string | null>(null);

  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>("todos");
  const [filtroTipo, setFiltroTipo] = useState<FiltroTipo>("todos");

  const [preview, setPreview] = useState<{ card: CardViewModel; mensagens: string[] } | null>(null);
  const [batchConfirm, setBatchConfirm] = useState(false);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ ativo: boolean; total: number } | null>(null);

  const [cadastro, setCadastro] = useState<{
    card: CardViewModel;
    nome: string;
    telefone: string;
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

  function nomeEfetivo(card: CardViewModel): string {
    return nomeOverrides[card.cardId] ?? card.nomeCliente;
  }

  function periciasEfetivas(card: CardViewModel): Pericia[] {
    return periciasOverrides[card.cardId] ?? card.pericias;
  }

  /** Aplica os overrides locais (nome, perícias, contato) — são os dados usados na mensagem enviada. */
  function cardEfetivo(card: CardViewModel): CardViewModel {
    return { ...card, nomeCliente: nomeEfetivo(card), pericias: periciasEfetivas(card) };
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
    setCadastro({ card, nome: nomeEfetivo(card), telefone: "", observacoes: "" });
  }

  function abrirEdicaoContato(card: CardViewModel) {
    const contato = contatoEfetivo(card);
    if (!contato) return;
    setCadastro({
      card,
      nome: contato.nome,
      telefone: formatPhoneInput(contato.telefone),
      observacoes: contato.observacoes || "",
      contatoId: contato.id,
    });
  }

  async function salvarCadastroRapido() {
    if (!cadastro) return;
    setSalvandoContato(true);
    try {
      const payload = { nome: cadastro.nome, telefone: cadastro.telefone, observacoes: cadastro.observacoes };
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
    if (!templateId) {
      show("Selecione um template de mensagem.", "error");
      return;
    }
    const cardComOverrides = cardEfetivo(card);
    try {
      const { mensagens } = await api.post<{ mensagens: string[] }>("/templates/preview", {
        templateId,
        nome: cardComOverrides.nomeCliente,
        pericias: cardComOverrides.pericias,
      });
      setPreview({ card: cardComOverrides, mensagens });
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
    if (!templateId) return;
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
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Dashboard · DisparaZap</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Cards da lista do Trello configurada.</p>
        </div>
        <div className="flex items-center gap-2">
          {whatsapp.status !== "conectado" && (
            <Badge tone="warning">
              <WifiOff className="h-3.5 w-3.5" /> WhatsApp desconectado
            </Badge>
          )}
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
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <Input placeholder="Buscar por cliente…" className="pl-9" value={busca} onChange={(e) => setBusca(e.target.value)} />
            </div>
            <Select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value as FiltroStatus)} className="w-44">
              <option value="todos">Todos os status</option>
              <option value="nao_enviado">Não enviado</option>
              <option value="enviado">Enviado</option>
              <option value="falhou">Falhou</option>
            </Select>
            <Select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value as FiltroTipo)} className="w-44">
              <option value="todos">Médica e Social</option>
              <option value="medica">Só Médica</option>
              <option value="social">Só Social</option>
              <option value="ambas">Ambas (2 perícias)</option>
            </Select>
            <Select value={templateId ?? ""} onChange={(e) => setTemplateId(Number(e.target.value))} className="w-52">
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome}
                </option>
              ))}
            </Select>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={toggleSelecionarTodos}
                disabled={cardsFiltrados.length === 0 || Boolean(batchProgress)}
              >
                {cardsFiltrados.length > 0 && cardsFiltrados.every((c) => selecionados.has(c.cardId))
                  ? "Desmarcar Todos"
                  : "Selecionar Todos"}
              </Button>
              <Button onClick={abrirConfirmBatch} disabled={selecionados.size === 0 || Boolean(batchProgress)}>
                <Send className="h-4 w-4" /> Enviar selecionados ({selecionados.size})
              </Button>
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
                  card={cardEfetivo(card)}
                  selecionado={selecionados.has(card.cardId)}
                  onToggleSelecionar={() => toggleSelecionado(card.cardId)}
                  temContatoEfetivo={Boolean(contatoEfetivo(card))}
                  onEnviar={() => abrirPreview(card)}
                  onCadastrarContato={() => abrirCadastro(card)}
                  onEditarContato={() => abrirEdicaoContato(card)}
                  onEditarNome={() => abrirEdicaoNome(card)}
                  onEditarPericia={(index) => abrirEdicaoPericia(card, index)}
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
          </div>
        )}
      </Modal>
    </div>
  );
}
