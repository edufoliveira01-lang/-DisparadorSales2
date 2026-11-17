import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import type { Publicacao } from "@/pages/Acompanhamento";

export function ConferirCompromisso({ publicacao, aoFechar, aoSalvar }: {
  publicacao: Publicacao | null;
  aoFechar: () => void;
  aoSalvar: (p: Publicacao) => void;
}) {
  const [data, setData] = useState("");
  const [horario, setHorario] = useState("");
  const [local, setLocal] = useState("");
  const [conferido, setConferido] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  useEffect(() => {
    const ag = publicacao?.triagem?.compromisso;
    setData(ag?.data || ""); setHorario(ag?.horario || ""); setLocal(ag?.local || "");
    setConferido(false); setErro("");
  }, [publicacao?.id]);
  async function salvar() {
    if (!publicacao || ocupado || !conferido) return;
    setOcupado(true); setErro("");
    try {
      const atualizada = await api.put<Publicacao>(`/djen/publicacoes/${publicacao.id}/revisao`, {
        categorias: publicacao.categorias, resultado: publicacao.resultado, situacao: publicacao.situacao,
        agendamento: { data, horario, local },
      });
      aoSalvar(atualizada); aoFechar();
    } catch (e) { setErro(e instanceof ApiError ? e.message : "Não foi possível registrar o compromisso."); }
    finally { setOcupado(false); }
  }
  return <Modal open={Boolean(publicacao)} onClose={() => { if (!ocupado) aoFechar(); }} title="Conferir e registrar compromisso"
    description="Confira a data, o horário e o local no texto da publicação."
    footer={<><Button variant="outline" disabled={ocupado} onClick={aoFechar}>Cancelar</Button><Button loading={ocupado} disabled={!data || !horario || !conferido} onClick={() => void salvar()}>Salvar e registrar no controle</Button></>}>
    <div className="space-y-4">
      <blockquote className="pub-source max-h-48 overflow-auto whitespace-pre-wrap">{publicacao?.texto}</blockquote>
      <div className="grid grid-cols-2 gap-3">
        <div><Label htmlFor="compromisso-data">Data</Label><Input id="compromisso-data" type="date" value={data} onChange={e => setData(e.target.value)} /></div>
        <div><Label htmlFor="compromisso-hora">Horário</Label><Input id="compromisso-hora" type="time" value={horario} onChange={e => setHorario(e.target.value)} /></div>
      </div>
      <div><Label htmlFor="compromisso-local">Local ou link da audiência</Label><Input id="compromisso-local" value={local} maxLength={1000} onChange={e => setLocal(e.target.value)} placeholder="Endereço, sala ou link informado na publicação" /></div>
      {!local.trim() && <p className="text-xs text-amber-700 dark:text-amber-300">O local continuará sinalizado como pendente de conferência.</p>}
      <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={conferido} onChange={e => setConferido(e.target.checked)} />Conferi os dados e o vínculo do cliente para registrar este compromisso.</label>
      {erro && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{erro}</p>}
    </div>
  </Modal>;
}
