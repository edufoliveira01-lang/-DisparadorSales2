import { useEffect, useState } from "react";
import { Timer } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { Settings } from "@/lib/types";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Callout, SettingsBlock, SettingsFooter, SettingsPanel, SettingRow } from "@/components/ui/Settings";

export function IntervaloSection() {
  const { show } = useToast();
  const [intervalMin, setIntervalMin] = useState("5");
  const [intervalMax, setIntervalMax] = useState("15");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    api.get<Settings>("/settings")
      .then((data) => {
        setIntervalMin(data.send_interval_min ?? "5");
        setIntervalMax(data.send_interval_max ?? "15");
      })
      .catch(() => undefined);
  }, []);

  async function handleSalvar() {
    setSalvando(true);
    try {
      await api.put("/settings", { send_interval_min: intervalMin, send_interval_max: intervalMax });
      show("Intervalo de envio salvo.", "success");
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao salvar intervalo.", "error");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <SettingsPanel icon={<Timer />} title="Intervalo entre envios" description="Pausa entre uma mensagem e outra nos envios em lote.">
      <SettingsBlock>
        <Callout tone="info">
          O sistema espera um tempo aleatório entre o mínimo e o máximo antes de cada mensagem. Isso reduz o risco de bloqueio da conta.
        </Callout>
        <SettingRow label="Mínimo" hint="Segundos." htmlFor="cfg-int-min">
          <Input id="cfg-int-min" type="number" min={1} className="sm:max-w-[10rem]" value={intervalMin} onChange={(e) => setIntervalMin(e.target.value)} />
        </SettingRow>
        <SettingRow label="Máximo" hint="Segundos." htmlFor="cfg-int-max">
          <Input id="cfg-int-max" type="number" min={1} className="sm:max-w-[10rem]" value={intervalMax} onChange={(e) => setIntervalMax(e.target.value)} />
        </SettingRow>
      </SettingsBlock>
      <SettingsFooter left={`Cada envio aguarda entre ${intervalMin || "?"} e ${intervalMax || "?"} segundos.`}>
        <Button onClick={handleSalvar} loading={salvando}>Salvar intervalo</Button>
      </SettingsFooter>
    </SettingsPanel>
  );
}
