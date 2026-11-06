import { db } from "../../db";

/** DDD + últimos 8 dígitos: igual para "(13) 97404-5973", "5513974045973" e o número antigo de 8 dígitos. null = telefone curto demais. */
export function chaveDoTelefone(bruto: unknown): string | null {
  let d = String(bruto ?? "").replace(/\D/g, "");
  if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);
  return d.length >= 10 ? d.slice(0, 2) + d.slice(-8) : null;
}

export interface ClienteAchado { id: number; nome: string; tipo: string; cidade: string; uf: string; criado_em: string }
export type BuscaDeCliente = { achou: "um"; cliente: ClienteAchado } | { achou: "nenhum" } | { achou: "varios"; quantos: number };

/** O cadastro do escritório pelo telefone da conversa. Mais de um cadastro com o mesmo telefone (família) NÃO escolhe: a equipe decide. */
export function clientePeloTelefone(telefone: unknown): BuscaDeCliente {
  const chave = chaveDoTelefone(telefone);
  if (!chave) return { achou: "nenhum" };
  const todos = db.prepare("SELECT id,nome,tipo,cidade,uf,criado_em,telefone,telefone2 FROM gestao_pessoas WHERE ativo=1 AND tipo='cliente' AND (telefone<>'' OR telefone2<>'')").all() as (ClienteAchado & { telefone: string; telefone2: string })[];
  const achados = todos.filter((p) => chaveDoTelefone(p.telefone) === chave || chaveDoTelefone(p.telefone2) === chave);
  if (achados.length === 0) return { achou: "nenhum" };
  if (achados.length > 1) return { achou: "varios", quantos: achados.length };
  const { telefone: _t, telefone2: _t2, ...cliente } = achados[0]!;
  return { achou: "um", cliente };
}
