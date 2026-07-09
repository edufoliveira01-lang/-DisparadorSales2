import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  RefreshCw,
  Search,
  Send,
  Inbox,
  WifiOff,
} from "lucide-react";
import { api } from "@/lib/api";
import { socket } from "@/lib/socket";
import type { Card, Template, Contato, WhatsAppStatus } from "@/lib/types";
import { Layout } from "@/components/Layout";
import { CardItem } from "@/components/CardItem";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { Label } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Input";

type FiltroStatus = "todos" | "nao_enviado" | "enviado" | "falhou";
type FiltroTipo = "todos" | "medica" | "social" | "ambas";

export default function Dashboard() {
  const navigate = useNavigate();
  const [cards, setCards] = useState<Card[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [contatos, setContatos] = useState<Contato[]>([]);
  const [whatsapp, setWhatsapp] = useState<WhatsAppStatus>({ status: "desconectado" });
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>("todos");
  const [filtroTipo, setFiltroTipo] = useState<FiltroTipo>("todos");
  const [templateId, setTemplateId] = useState<number | null>(null);

  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<{ card: Card; mensagens: string[] } | null>(null);
  const [enviandoCardId, setEnviandoCardId] = useState<string | null>(null);

  const [batchConfirm, setBatchConfirm] = useState(false);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ ativo: boolean; total: number; atual: number } | null>(null);

  const [cadastro, setCadastro] = useState<{ card: Card; nome: string; telefone: string; observacoes: string } | null>(null);
  const [salvandoContato, setSalvandoContato] = useState(false);

  useEffect(() => {
    carregarDadosIniciais();

    socket.on("whatsapp:status", setWhatsapp);
    socket.on("whatsapp:qr", (qr) => setWhatsapp({ status: "qrcode", qrcode: qr }));
    socket.on("dispatch:result", () => carregarCards(false));
    socket.on("batch:progress", (progress) => {
      setBatchProgress(progress);
      if (!progress.ativo) {
        setBatchLoading(false);
        carregarCards(false);
      }
    });

    return () => {
      socket.off("whatsapp:status");
      socket.off("whatsapp:qr");
      socket.off("dispatch:result");
      socket.off("batch:progress");
    };
  }, []);

  async function carregarDadosIniciais() {
    try {
      setCarregando(true);
      const [cardsRes, templatesRes, contatosRes, wsRes] = await Promise.all([
        api.get("/cards"),
        api.get("/templates"),
        api.get("/contatos"),
        api.get("/whatsapp/status"),
      ]);

      setCards(cardsRes.data);
      setTemplates(templatesRes.data);
      setContatos(contatosRes.data);
      setWhatsapp(wsRes.data);

      if (templatesRes.data.length > 0) {
        setTemplateId(templatesRes.data[0].id);
      }
    } catch (err: any) {
      setErro(err.response?.data?.error || "Erro ao carregar dados");
    } finally {
      setCarregando(false);
    }
  }

  async function carregarCards(comLoading = true) {
    try {
      if (comLoading) setCarregando(true);
      const res = await api.get("/cards");
      setCards(res.data);
    } catch (err: any) {
      setErro(err.response?.data?.error || "Erro ao carregar cards");
    } finally {
      if (comLoading) setCarregando(false);
    }
  }

  const contatoEfetivo = (card: Card) => {
    return contatos.find((c) => c.telefone === card.telefone) || null;
  };

  const cardsFiltrados = useMemo(() => {
    return cards.filter((card) => {
      const matchBusca =
        card.nomeCliente.toLowerCase().includes(busca.toLowerCase()) ||
        card.cardNome.toLowerCase().includes(busca.toLowerCase());

      const matchStatus =
        filtroStatus === "todos" ||
        (filtroStatus === "nao_enviado" && !card.ultimoEnvio) ||
        (filtroStatus === "enviado" && card.ultimoEnvio?.status === "sucesso") ||
        (filtroStatus === "falhou" && card.ultimoEnvio?.status === "falha");

      const matchTipo =
        filtroTipo === "todos" ||
        (filtroTipo === "medica" && card.pericias.length === 1 && card.pericias[0].tipo?.toLowerCase().includes("médica")) ||
        (filtroTipo === "social" && card.pericias.length === 1 && card.pericias[0].tipo?.toLowerCase().includes("social")) ||
        (filtroTipo === "ambas" && card.pericias.length === 2);

      return matchBusca && matchStatus && matchTipo;
    });
  }, [cards, busca, filtroStatus, filtroTipo]);

  const toggleSelecionado = (id: string) => {
    const newSet = new Set(selecionados);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelecionados(newSet);
  };

  async function abrirPreview(card: Card) {
    if (!templateId) return;
    try {
      setEnviandoCardId(card.cardId);
      const res = await api.post("/templates/preview", {
        templateId,
        cardId: card.cardId,
      });
      setPreview({ card, mensagens: res.data.mensagens });
    } catch (err) {
      alert("Erro ao gerar preview");
    } finally {
      setEnviandoCardId(null);
    }
  }

  async function confirmarEnvioIndividual() {
    if (!preview || !templateId) return;
    try {
      setEnviandoCardId(preview.card.cardId);
      setPreview(null);
      await api.post("/dispatch/send", {
        templateId,
        cardId: preview.card.cardId,
      });
    } catch (err) {
      alert("Erro ao enviar mensagem");
    } finally {
      setEnviandoCardId(null);
    }
  }

  const cardsSelecionadosValidos = cards.filter(
    (c) => selecionados.has(c.cardId) && contatoEfetivo(c) && c.pericias.length > 0
  );

  function abrirConfirmBatch() {
    if (cardsSelecionadosValidos.length === 0) {
      alert("Nenhum dos cards selecionados possui contato cadastrado ou perícia identificada.");
      return;
    }
    setBatchConfirm(true);
  }

  async function confirmarBatch() {
    if (!templateId) return;
    try {
      setBatchLoading(true);
      setBatchConfirm(false);
      await api.post("/dispatch/batch", {
        templateId,
        cardIds: cardsSelecionadosValidos.map((c) => c.cardId),
      });
    } catch (err) {
      alert("Erro ao iniciar envio em lote");
      setBatchLoading(false);
    }
  }

  function abrirCadastro(card: Card) {
    setCadastro({
      card,
      nome: card.nomeCliente,
      telefone: "",
      observacoes: `Cadastrado via Dashboard para o card: ${card.cardNome}`,
    });
  }

  function usarSugestao(card: Card) {
    if (!card.sugestaoContato) return;
    setCadastro({
      card,
      nome: card.sugestaoContato.nome,
      telefone: card.sugestaoContato.telefone,
      observacoes: `Sugestão do Trello para o card: ${card.cardNome}`,
    });
  }

  async function salvarCadastroRapido() {
    if (!cadastro) return;
    try {
      setSalvandoContato(true);
      await api.post("/contatos", {
        nome: cadastro.nome,
        telefone: cadastro.telefone,
        observacoes: cadastro.observacoes,
      });
      const contatosRes = await api.get("/contatos");
      setContatos(contatosRes.data);
      setCadastro(null);
    } catch (err) {
      alert("Erro ao salvar contato");
    } finally {
      setSalvandoContato(false);
    }
  }

  return (
    <div className="w-full max-w-full space-y-4 sm:space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-1">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-zinc-900 dark:text-zinc-100">Dashboard</h1>
          <p className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400">Cards da lista do Trello configurada.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={carregarCards} loading={carregando} className="flex-1 sm:flex-none h-9">
            <RefreshCw className="h-3.5 w-3.5" /> Atualizar
          </Button>
        </div>
      </div>

      {erro ? (
        <EmptyState
          icon={Inbox}
          title="Erro ao carregar cards"
          description={erro}
          action={<Button variant="outline" onClick={() => navigate("/configuracoes")}>Configurações</Button>}
        />
      ) : (
        <div className="w-full max-w-full overflow-hidden space-y-4">
          <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <Input 
                placeholder="Buscar..." 
                className="pl-9 h-10 text-sm" 
                value={busca} 
                onChange={(e) => setBusca(e.target.value)} 
              />
            </div>
            
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2">
                <Select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value as FiltroStatus)} className="h-9 text-[11px]">
                  <option value="todos">Todos Status</option>
                  <option value="nao_enviado">Não Env.</option>
                  <option value="enviado">Enviados</option>
                  <option value="falhou">Falhas</option>
                </Select>
                <Select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value as FiltroTipo)} className="h-9 text-[11px]">
                  <option value="todos">Todas Perícias</option>
                  <option value="medica">Médica</option>
                  <option value="social">Social</option>
                  <option value="ambas">Ambas</option>
                </Select>
              </div>
              <Select value={templateId ?? ""} onChange={(e) => setTemplateId(Number(e.target.value))} className="h-9 text-[11px] w-full">
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.nome}</option>
                ))}
              </Select>
              
              <Button 
                onClick={abrirConfirmBatch} 
                disabled={selecionados.size === 0 || Boolean(batchProgress)} 
                className="w-full h-10 text-xs font-bold"
              >
                <Send className="h-3.5 w-3.5" /> Enviar Selecionados ({selecionados.size})
              </Button>
            </div>
          </div>

          {batchProgress?.ativo && (
            <div className="flex items-center gap-2 rounded-xl bg-accent-50 px-4 py-2.5 text-sm text-accent-700 dark:bg-accent-900/20 dark:text-accent-300">
              <RefreshCw className="h-4 w-4 animate-spin" /> Enviando em lote… acompanhe os status atualizando em tempo real.
            </div>
          )}

          {carregando ? (
            <div className="flex flex-col items-center justify-center py-12">
              <RefreshCw className="h-8 w-8 animate-spin text-zinc-300" />
              <p className="mt-4 text-sm text-zinc-500">Buscando cards no Trello…</p>
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
        </div>
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
