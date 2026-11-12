import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Pericia, Settings } from "@/lib/types";
import {
  EXEMPLO_AUDIENCIA_HIBRIDA,
  EXEMPLO_AUDIENCIA_ONLINE,
  EXEMPLO_AUDIENCIA_PRESENCIAL,
  VARIAVEIS_AUDIENCIA,
  type ModalidadeAudiencia,
} from "@/lib/audiencia";
import { useToast } from "@/components/ui/Toast";
import { PageHeader } from "@/components/ui/PageHeader";
import { MensagensPorAba, aplicarExemplo } from "@/components/templates/ModeloEditor";

function valoresDe(p: Pericia, extra: Record<string, string> = {}): Record<string, string> {
  return {
    NOME: p.nome, TIPO_PERICIA: p.tipo, DATA: p.data, HORARIO: p.horario, LOCAL: p.local,
    TELEFONE: p.telefone || "", WHATSAPP: p.whatsapp || "", PROCESSO: p.processo || "",
    PROFISSIONAL_PERITO: p.profissionalPerito || "", ...extra,
  };
}

const ABAS: { key: ModalidadeAudiencia; label: string }[] = [
  { key: "presencial", label: "Presencial" },
  { key: "online", label: "Online" },
  { key: "hibrida", label: "Híbrida" },
];

const EXEMPLOS: Record<ModalidadeAudiencia, Pericia> = {
  presencial: EXEMPLO_AUDIENCIA_PRESENCIAL,
  online: EXEMPLO_AUDIENCIA_ONLINE,
  hibrida: EXEMPLO_AUDIENCIA_HIBRIDA,
};

export function TemplatesAudiencia() {
  const { show } = useToast();
  const [aba, setAba] = useState<ModalidadeAudiencia>("presencial");
  const [mensagens, setMensagens] = useState<Record<ModalidadeAudiencia, string>>({ presencial: "", online: "", hibrida: "" });
  const [salvando, setSalvando] = useState(false);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    api.get<Settings>("/settings").then((data) => {
      setMensagens({
        presencial: data.audiencia_presencial_mensagem ?? "",
        online: data.audiencia_online_mensagem ?? "",
        hibrida: data.audiencia_hibrida_mensagem ?? "",
      });
    }).catch((err) => show(err instanceof ApiError ? err.message : "Erro ao carregar mensagens de audiência.", "error"))
      .finally(() => setCarregando(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function salvar() {
    setSalvando(true);
    try {
      await api.put("/settings", {
        audiencia_presencial_mensagem: mensagens.presencial,
        audiencia_online_mensagem: mensagens.online,
        audiencia_hibrida_mensagem: mensagens.hibrida,
      });
      show("Mensagens de audiência salvas.", "success");
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao salvar mensagens de audiência.", "error");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        compact
        title="Mensagens de Audiência"
        description="Enviadas no lugar da mensagem de perícia quando o sistema identifica uma audiência no card. Há um texto para cada modalidade."
      />
      <MensagensPorAba
        abas={ABAS}
        aba={aba}
        onAba={setAba}
        mensagens={mensagens}
        onChange={(k, v) => setMensagens((prev) => ({ ...prev, [k]: v }))}
        variaveis={VARIAVEIS_AUDIENCIA}
        previa={(k, texto) => aplicarExemplo(texto, valoresDe(EXEMPLOS[k]))}
        onSalvar={salvar}
        salvando={salvando}
        carregando={carregando}
        rotuloSalvar="Salvar mensagens de audiência"
        linhas={11}
      />
    </div>
  );
}
