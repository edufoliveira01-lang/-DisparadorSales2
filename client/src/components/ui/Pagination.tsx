import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface PaginationProps {
  page: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ page, totalItems, pageSize, onPageChange }: PaginationProps) {
  const totalPaginas = Math.max(1, Math.ceil(totalItems / pageSize));
  if (totalPaginas <= 1) return null;

  return (
    <div className="flex items-center justify-between px-1 py-2">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Página {page + 1} de {totalPaginas} · {totalItems} registro(s)
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => onPageChange(page - 1)} disabled={page === 0}>
          <ChevronLeft className="h-3.5 w-3.5" /> Anterior
        </Button>
        <Button variant="outline" size="sm" onClick={() => onPageChange(page + 1)} disabled={page >= totalPaginas - 1}>
          Próximo <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
