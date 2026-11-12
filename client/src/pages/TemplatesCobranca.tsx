import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Pericia, Settings } from "@/lib/types";
import { VARIAVEIS, EXEMPLO_PERICIAS } from "@/lib/templateSamples";
import { EXEMPLO_AUDIENCIA_PRESENCIAL, VARIAVEIS_AUDIENCIA } from "@/lib/audiencia";
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

type Categoria = "pericia" | "audiencia";

const ABAS: { key: Categoria; label: string }[] = [
  { key: "pericia", label: "Perícia" },
  { key: "audiencia", label: "Audiência" },
];

const VARIAVEIS_POR_CATEGORIA: Record<Categoria, string[]> = {
  pericia: VARIAVEIS,
  audiencia: VARIAVEIS_AUDIENCIA,
};

const EXEMPLO_POR_CATEGORIA: Record<Categoria, Pericia> = {
  pericia: EXEMPLO_PERICIAS[0],
  audiencia: EXEMPLO_AUDIENCIA_PRESENCIAL,
};

export function TemplatesCobranca() {
  const { show } = useToast();
  const [aba, setAba] = useState<Categoria>("pericia");
  const [mensagens, setMensagens] = useState<Record<Categoria, string>>({ pericia: "", audiencia: "" });
  const [salvando, setSalvando] = useState(false);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    api.get<Settings>("/settings").then((data) => {
      setMensagens({
        pericia: data.cobranca_mensagem ?? "",
        audiencia: data.cobranca_audiencia_mensagem ?? "",
      });
    }).catch((err) => show(err instanceof ApiError ? err.message : "Erro ao carregar mensagens de cobrança.", "error"))
      .finally(() => setCarregando(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function salvar() {
    setSalvando(true);
    try {
      await api.put("/settings", {
        cobranca_mensagem: mensagens.pericia,
        cobranca_audiencia_mensagem: mensagens.audiencia,
      });
      show("Mensagens de cobrança salvas.", "success");
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao salvar mensagens de cobrança.", "error");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        compact
        title="Mensagem de Cobrança"
        description={'Enviada pelo botão "Cobrar resposta" em Pendentes de Resposta, perguntando ao cliente se recebeu o envio anterior. Audiência tem texto próprio.'}
      />
      <MensagensPorAba
        abas={ABAS}
        aba={aba}
        onAba={setAba}
        mensagens={mensagens}
        onChange={(k, v) => setMensagens((prev) => ({ ...prev, [k]: v }))}
        variaveis={VARIAVEIS_POR_CATEGORIA[aba]}
        previa={(k, texto) => aplicarExemplo(texto, valoresDe(EXEMPLO_POR_CATEGORIA[k]))}
        onSalvar={salvar}
        salvando={salvando}
        carregando={carregando}
        ajuda="As variáveis ficam em branco se o sistema não encontrar mais os dados originais do envio."
        rotuloSalvar="Salvar mensagens de cobrança"
        linhas={8}
      />
    </div>
  );
}
