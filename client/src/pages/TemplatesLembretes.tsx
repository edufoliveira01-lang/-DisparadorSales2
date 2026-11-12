import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Pericia, Settings } from "@/lib/types";
import { VARIAVEIS, EXEMPLO_PERICIAS } from "@/lib/templateSamples";
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

type Periodo = "hoje" | "amanha" | "futuro";

const ABAS: { key: Periodo; label: string }[] = [
  { key: "hoje", label: "Hoje" },
  { key: "amanha", label: "Amanhã" },
  { key: "futuro", label: "Data futura" },
];

const exemplo = EXEMPLO_PERICIAS[0];
const VARIAVEIS_LEMBRETE = [...VARIAVEIS, "COMPROMISSOS"];
const compromissosExemplo = EXEMPLO_PERICIAS.map((pericia) =>
  `• ${pericia.tipo}: ${pericia.data} às ${pericia.horario}\n  Local: ${pericia.local}\n  Processo: ${pericia.processo || ""}`
).join("\n\n");

export function TemplatesLembretes() {
  const { show } = useToast();
  const [aba, setAba] = useState<Periodo>("hoje");
  const [mensagens, setMensagens] = useState<Record<Periodo, string>>({ hoje: "", amanha: "", futuro: "" });
  const [salvando, setSalvando] = useState(false);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    api.get<Settings>("/settings").then((data) => {
      setMensagens({
        hoje: data.lembrete_hoje_mensagem ?? "",
        amanha: data.lembrete_amanha_mensagem ?? "",
        futuro: data.lembrete_futuro_mensagem ?? "",
      });
    }).catch((err) => show(err instanceof ApiError ? err.message : "Erro ao carregar mensagens de lembrete.", "error"))
      .finally(() => setCarregando(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function salvar() {
    setSalvando(true);
    try {
      await api.put("/settings", {
        lembrete_hoje_mensagem: mensagens.hoje,
        lembrete_amanha_mensagem: mensagens.amanha,
        lembrete_futuro_mensagem: mensagens.futuro,
      });
      show("Mensagens de lembrete salvas.", "success");
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao salvar mensagens de lembrete.", "error");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        compact
        title="Mensagens de Lembrete"
        description="O sistema escolhe sozinho a mensagem de hoje, de amanhã ou de uma data futura."
      />
      <MensagensPorAba
        abas={ABAS}
        aba={aba}
        onAba={setAba}
        mensagens={mensagens}
        onChange={(k, v) => setMensagens((prev) => ({ ...prev, [k]: v }))}
        variaveis={VARIAVEIS_LEMBRETE}
        previa={(_k, texto) => aplicarExemplo(texto, valoresDe(exemplo, { COMPROMISSOS: compromissosExemplo }))}
        onSalvar={salvar}
        salvando={salvando}
        carregando={carregando}
        ajuda="As variáveis são preenchidas com os dados do próprio evento do calendário."
        rotuloSalvar="Salvar mensagens de lembrete"
        linhas={8}
      />
    </div>
  );
}
