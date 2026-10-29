import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { DeadlineSettings } from "@/components/djen/DeadlineSettings";
import { AutomaticCalendars } from "@/components/djen/AutomaticCalendars";
import { PageHeader } from "@/components/ui/PageHeader";
import { useAuth } from "@/context/AuthContext";

export function CalendariosPrazos() {
  const { can } = useAuth();
  const [manualAberto, setManualAberto] = useState(false);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Calendários de prazos"
        description="Acompanhe a importação de feriados e suspensões por tribunal e unidade. Confira a cobertura antes de calcular prazos."
        actions={can("deadlines.manage") ? <Button variant="outline" onClick={() => setManualAberto(true)}>Calendário manual</Button> : undefined}
      />
      <section className="surface-panel p-5">
        <AutomaticCalendars />
      </section>
      <Modal open={manualAberto} onClose={() => setManualAberto(false)} title="Calendário manual" maxWidth="max-w-3xl"><DeadlineSettings manualOnly /></Modal>
    </div>
  );
}

