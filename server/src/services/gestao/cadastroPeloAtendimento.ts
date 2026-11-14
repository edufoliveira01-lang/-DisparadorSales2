import { db } from "../../db";
import { anotarNaPessoa, autorDoAtendimento } from "./anotacoes";
import { ErroGestao } from "./erro";

/**
 * O atendimento (Deskcomm) corrige o cadastro do CLIENTE com o que ele próprio informou na conversa.
 *
 * Só os campos de contato e endereço mudam direto. Nome, CPF/documento, RG, telefone, data de nascimento e os demais NÃO mudam por aqui:
 * trocar a identidade por mensagem exige que a equipe confirme quem está pedindo. Esses chegam como anotação no cadastro (rota de anotações).
 *
 * Cada mudança deixa uma anotação no cadastro, com o valor de antes e o de depois, no nome do atendimento: quem abre a ficha vê o que mudou.
 */
export const CAMPOS_LIBERADOS = ["email", "cep", "logradouro", "numero", "complemento", "bairro", "cidade", "uf", "profissao", "estado_civil"] as const;
type Campo = (typeof CAMPOS_LIBERADOS)[number];

const ROTULOS: Record<Campo, string> = {
  email: "e-mail", cep: "CEP", logradouro: "rua", numero: "número", complemento: "complemento", bairro: "bairro", cidade: "cidade", uf: "UF", profissao: "profissão", estado_civil: "estado civil",
};

const limpa = (v: unknown, max = 160) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

function normalizar(campo: Campo, bruto: unknown): string | null {
  const v = limpa(bruto);
  if (!v) return null;
  switch (campo) {
    case "email": return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? v.toLowerCase() : null;
    case "cep": { const d = v.replace(/\D/g, ""); return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : null; }
    case "uf": return /^[a-zA-Z]{2}$/.test(v) ? v.toUpperCase() : null;
    case "numero": return v.slice(0, 20);
    default: return v;
  }
}

export interface ResultadoDoCadastro { ok: true; pessoa_id: number; alterados: Campo[]; iguais: Campo[]; ignorados: string[] }

export function atualizarCadastroPeloAtendimento(d: { pessoa_id?: unknown; campos?: unknown; autor_nome?: unknown; autor_email?: unknown }): ResultadoDoCadastro {
  const pessoaId = Number(d.pessoa_id);
  if (!Number.isSafeInteger(pessoaId) || pessoaId <= 0) throw new ErroGestao("Escolha o cliente.");
  const atual = db.prepare(`SELECT id, tipo, ativo, ${CAMPOS_LIBERADOS.join(", ")} FROM gestao_pessoas WHERE id=?`).get(pessoaId) as ({ id: number; tipo: string; ativo: number } & Record<Campo, string>) | undefined;
  if (!atual || !atual.ativo) throw new ErroGestao("Pessoa não encontrada.", 404);
  if (atual.tipo !== "cliente") throw new ErroGestao("O cadastro só é corrigido pelo atendimento para clientes.", 403);

  const pedidos = (d.campos && typeof d.campos === "object" ? d.campos : {}) as Record<string, unknown>;
  const alterados: Campo[] = [], iguais: Campo[] = [], ignorados: string[] = [];
  const novos: Partial<Record<Campo, string>> = {};
  const historico: string[] = [];

  for (const [chave, bruto] of Object.entries(pedidos)) {
    if (!(CAMPOS_LIBERADOS as readonly string[]).includes(chave)) { ignorados.push(chave); continue; }
    const campo = chave as Campo;
    const valor = normalizar(campo, bruto);
    if (valor === null) { ignorados.push(chave); continue; }
    if ((atual[campo] ?? "").trim() === valor) { iguais.push(campo); continue; }
    novos[campo] = valor;
    alterados.push(campo);
    historico.push(`${ROTULOS[campo]}: ${(atual[campo] ?? "").trim() || "(vazio)"} → ${valor}`);
  }

  if (alterados.length > 0) {
    // Os nomes das colunas vêm da lista fixa acima, nunca do pedido.
    const sets = alterados.map((c) => `${c}=?`).join(", ");
    db.prepare(`UPDATE gestao_pessoas SET ${sets}, atualizado_em=CURRENT_TIMESTAMP WHERE id=?`).run(...alterados.map((c) => novos[c]!), pessoaId);
    anotarNaPessoa(pessoaId, `Cadastro atualizado pelo atendimento virtual, a pedido do cliente. ${historico.join("; ")}`, autorDoAtendimento(d));
  }
  return { ok: true, pessoa_id: pessoaId, alterados, iguais, ignorados };
}
