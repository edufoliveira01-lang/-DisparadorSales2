import { useState } from "react";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { AlertCircle, ArrowRight, CalendarDays, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { RegisterAction } from "./ActivityBadge";
import { useAuth } from "@/context/AuthContext";
import type { Publicacao } from "@/pages/Acompanhamento";

const dia = (d: string | null | undefined) => d ? d.slice(0, 10).split("-").reverse().join("/") : "A confirmar";

export function ResumoPublicacao({ publicacao: p, ocupado, aoConferir, aoClassificar, aoPrazos, aoPublicacao, aoAvisar, aoAtualizar, responsaveis }: {
  responsaveis: { id: number; nome: string }[];
  publicacao: Publicacao; ocupado: boolean; aoConferir: () => void; aoClassificar: () => void;
  aoPrazos: () => void; aoPublicacao: () => void; aoAvisar: () => void; aoAtualizar: () => Promise<void>;
}) {
  const { can } = useAuth();
  const { show } = useToast();
  const [atribuindo, setAtribuindo] = useState(false);
  const t = p.triagem, ag = t?.compromisso;
  const podePrazo = can("deadlines.manage");
  const temPrazo = t?.prazo_aberto || t?.prazo_a_lancar || p.acao?.tipo === "prazo_explicito";
  const titulo = ag ? ag.registro_id ? "Compromisso registrado · conferir comunicação" : "Conferir e registrar o compromisso"
    : temPrazo ? t?.vencido ? "Prazo vencido · registrar a providência" : t?.vence_hoje ? "Cumprir a providência de hoje" : "Conferir o prazo do escritório"
    : !p.revisada ? "Conferir a classificação e a providência" : "Registrar ciência ou providência realizada";
  const trecho = p.evidencias?.find(e => e.categoria === ag?.tipo)?.trecho || p.acao?.prazo_texto || p.evidencias?.[0]?.trecho || p.texto || "";
  return <div className="space-y-5">
    <section className={`pub-next ${t?.vencido || t?.vence_hoje ? "is-urgent" : ag?.registro_id && !t?.dados_incompletos ? "is-registered" : ""}`} aria-label="O que fazer agora">
      <p className="pub-eyebrow">O que fazer agora</p>
      <h3>{titulo}</h3>
      <p>{p.concluida && t?.prazo_aberto ? "Triagem concluída. O prazo do escritório continua em aberto e exige acompanhamento." : t?.motivo || p.acao?.descricao || "Confira o inteiro teor e registre o próximo passo."}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {ag && <Button size="sm" disabled={ocupado || Boolean(p.cancelada)} onClick={aoConferir}>{ag.registro_id ? "Conferir ou ajustar compromisso" : "Conferir e registrar"}</Button>}
        {temPrazo && <Button size="sm" disabled={!can("deadlines.view")} onClick={aoPrazos}>{podePrazo ? "Conferir e registrar prazo" : "Consultar prazo"}<ArrowRight className="h-3.5 w-3.5" /></Button>}
        {!ag && !temPrazo && !p.revisada && <Button size="sm" onClick={aoClassificar}>Conferir classificação</Button>}
        {ag?.registro_id && can("calendar.view") && <Link className="pub-action-link" to={`/calendario?compromisso=${ag.registro_id}`}><CalendarDays className="h-3.5 w-3.5" />Ver na agenda</Link>}
        {ag?.registro_id && can("messages.send") && <Button size="sm" variant="outline" disabled={ocupado || !p.revisada} onClick={aoAvisar}>Preparar aviso</Button>}
      </div>
    </section>
    <div className="pub-facts">
      {ag ? <><div><small>Compromisso</small><strong>{ag.tipo === "audiencia" ? "Audiência" : "Perícia"} · {dia(ag.data)}{ag.horario ? ` às ${ag.horario}` : " · horário a confirmar"}</strong></div><div><small>Situação no controle</small><strong>{ag.registro_id ? ag.avisado ? "Registrado · aviso confirmado" : "Registrado · conferir aviso" : "Aguardando registro"}</strong></div><div className="col-span-2"><small>Local ou modalidade</small><strong>{ag.local || "A confirmar no inteiro teor"}</strong></div></>
        : <><div><small>Providência para</small><strong>{temPrazo ? "Conferir no prazo cadastrado" : "Conferir destinatário da ordem"}</strong></div><div><small>Vencimento cadastrado</small><strong>{dia(t?.prazo_aberto ? t.data_prioridade : p.proximo_prazo)}</strong></div></>}
      <div><small>Responsável interno do processo</small>{t?.gestao_processo_id && can("gestao.manage") ? <select className="w-full rounded-md border bg-transparent px-2 py-1 text-xs" aria-label="Responsável pelo processo" disabled={atribuindo} value={t.responsavel_id || ""} onChange={e => {
        const id = e.target.value ? Number(e.target.value) : null;
        setAtribuindo(true);
        void api.put(`/gestao/processos/${t.gestao_processo_id}`, { responsavel_user_id: id }).then(aoAtualizar).then(() => show("Responsável do processo atualizado.", "success")).catch(e => show(e instanceof Error ? e.message : "Não foi possível atribuir o processo.", "error")).finally(() => setAtribuindo(false));
      }}><option value="">Sem responsável</option>{responsaveis.map(r => <option key={r.id} value={r.id}>{r.nome}</option>)}</select> : <strong>{t?.responsavel_nome || "Sem responsável definido"}</strong>}</div>
      <div><small>Cliente</small><strong>{p.cliente_vinculado ? "Vínculo confirmado" : "Vínculo pendente"}</strong></div>
      {t?.gestao_processo_id && can("gestao.view") && <Link className="pub-action-link col-span-2" to={`/gestao/processos/${t.gestao_processo_id}`}>Abrir ficha e responsável do processo<ExternalLink className="h-3 w-3" /></Link>}
    </div>
    <section aria-label="Evidência da publicação">
      <div className="pub-section-heading"><h3>Trecho que fundamenta a orientação</h3><button type="button" onClick={aoPublicacao}>Ver inteiro teor ↗</button></div>
      <blockquote className="pub-source">{trecho.length > 900 ? `${trecho.slice(0, 900)}…` : trecho}</blockquote>
    </section>
    {(p.ia_status === "erro" || p.ia_provedor === "regra") && <div className="pub-review-notice" role="status"><AlertCircle className="h-4 w-4 shrink-0" /><p><strong>{p.ia_provedor === "regra" ? "Classificação provisória por regra" : "A análise da IA falhou"}</strong><br />{p.revisada ? "A categoria foi conferida por uma pessoa. Confira também o registro de prazos e compromissos." : "Confira os dados no trecho oficial. A revisão manual está disponível."}</p></div>}
    {p.acao?.encerradas?.length ? <details className="pub-disclosure"><summary>Ordens encerradas por andamentos posteriores ({p.acao.encerradas.length})</summary><div className="space-y-2 pt-3">{p.acao.encerradas.map((o, i) => <p key={i} className="text-xs"><Badge>{o.situacao}</Badge> {o.descricao} · {o.motivo}</p>)}</div></details> : null}
    <RegisterAction publicacaoId={p.id} onSaved={aoAtualizar} />
  </div>;
}
