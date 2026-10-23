import { Link } from "react-router-dom";
import { AutomaticCalendars } from "@/components/djen/AutomaticCalendars";
import { PageHeader } from "@/components/ui/PageHeader";

export function CalendariosPrazos() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Calendários de prazos"
        description="Acompanhe a importação de feriados e suspensões por tribunal e unidade. Confira a cobertura antes de calcular prazos."
        actions={<Link to="/configuracoes?prazos=1&manual=1#calendario-manual" className="inline-flex h-[42px] items-center rounded-lg border border-zinc-200 bg-white px-[14px] text-[13px] text-[#607c68] hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">Calendário manual</Link>}
      />
      <section className="surface-panel p-5">
        <AutomaticCalendars />
      </section>
    </div>
  );
}
