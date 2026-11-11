import { useState } from "react";

const CORES = ["bg-accent-100 text-accent-800", "bg-emerald-100 text-emerald-800", "bg-amber-100 text-amber-800", "bg-rose-100 text-rose-800", "bg-sky-100 text-sky-800", "bg-fuchsia-100 text-fuchsia-800"];
const iniciais = (nome: string) => { const p = nome.trim().split(/\s+/).filter(Boolean); return ((p[0]?.[0] ?? "?") + (p.length > 1 ? p[p.length - 1]![0]! : "")).toUpperCase(); };

/** A foto do cadastro (quando existe) ou as iniciais num círculo colorido (a cor sai do id, então é sempre a mesma por pessoa). */
export function AvatarPessoa({ id, nome, temFoto, tamanho = 40 }: { id: number; nome: string; temFoto?: boolean; tamanho?: number }) {
  const [falhou, setFalhou] = useState(false);
  const estilo = { width: tamanho, height: tamanho, fontSize: Math.round(tamanho * 0.38) };
  if (temFoto && !falhou) return <img src={`/api/gestao/pessoas/${id}/foto`} alt="" onError={() => setFalhou(true)} style={estilo} className="shrink-0 rounded-full border border-zinc-200 object-cover dark:border-white/10" />;
  return <span aria-hidden style={estilo} className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${CORES[id % CORES.length]} dark:bg-white/10 dark:text-zinc-100`}>{iniciais(nome)}</span>;
}

/** Link para abrir a conversa no WhatsApp (só com o telefone com DDD). */
export const linkWhatsApp = (tel: string): string | null => { const d = tel.replace(/\D/g, ""); return d.length >= 10 ? `https://wa.me/${d.startsWith("55") ? d : `55${d}`}` : null; };
