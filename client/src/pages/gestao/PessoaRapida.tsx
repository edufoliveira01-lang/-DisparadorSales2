import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { Campo, mascaraCpfCnpj, type PessoaResumo } from "./comum";

/** Cadastro rápido (nome, telefone, CPF): o resto se completa depois na ficha do cliente. */
export function PessoaRapida({ aoFechar, aoCriar }: { aoFechar: () => void; aoCriar: (p: PessoaResumo) => void }) {
  const { show } = useToast();
  const [f, setF] = useState({ nome: "", telefone: "", documento: "", email: "" });
  const [salvando, setSalvando] = useState(false);
  const salvar = async (e: React.FormEvent) => {
    e.preventDefault(); e.stopPropagation(); setSalvando(true);
    try { const p = await api.post<PessoaResumo>("/gestao/pessoas", { ...f, tipo: "cliente" }); show("Cliente cadastrado.", "success"); aoCriar(p); }
    catch (err) { show(err instanceof ApiError ? err.message : "Não foi possível cadastrar.", "error"); }
    finally { setSalvando(false); }
  };
  return (
    <Modal open onClose={aoFechar} title="Cadastrar cliente" description="Só o essencial agora; complete a ficha depois." maxWidth="max-w-md"
      footer={<div className="flex w-full justify-end gap-2"><Button type="button" variant="outline" onClick={aoFechar}>Cancelar</Button><Button type="submit" form="form-pessoa-rapida" loading={salvando}>Cadastrar</Button></div>}>
      <form id="form-pessoa-rapida" onSubmit={salvar} className="space-y-3">
        <Campo rotulo="Nome completo *"><Input required autoFocus value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} className="mt-1.5" /></Campo>
        <Campo rotulo="Telefone / WhatsApp"><Input type="tel" value={f.telefone} onChange={(e) => setF({ ...f, telefone: e.target.value })} className="mt-1.5" /></Campo>
        <Campo rotulo="CPF ou CNPJ"><Input inputMode="numeric" value={f.documento} onChange={(e) => setF({ ...f, documento: mascaraCpfCnpj(e.target.value) })} className="mt-1.5" /></Campo>
        <Campo rotulo="E-mail"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} className="mt-1.5" /></Campo>
      </form>
    </Modal>
  );
}
