import { ErroItemNaoEncontrado, type PastaExistente } from "../../src/armazenamento/pastas";
import type { Drive } from "../../src/armazenamento/servico";

export /** Um drive em memória: pastas por caminho, com identificador estável (que sobrevive a renomear). */
function driveFalso(iniciais: string[] = []) {
  let seq = 0;
  const pastas = new Map<string, { id: string; caminho: string }>(); // chave = id
  const arquivos: Array<{ caminho: string; bytes: number }> = [];
  const criarSilencioso = (caminho: string) => { const id = `id:${++seq}`; pastas.set(id, { id, caminho }); return id; };
  iniciais.forEach(criarSilencioso);
  const porCaminho = (c: string) => [...pastas.values()].find((p) => p.caminho.toLowerCase() === c.toLowerCase());
  const nome = (c: string) => c.split("/").pop()!;
  const drive: Drive = {
    async listarPastas(caminho) {
      if (!porCaminho(caminho)) throw new ErroItemNaoEncontrado();
      const filhos = [...pastas.values()].filter((p) => p.caminho.toLowerCase().startsWith(`${caminho.toLowerCase()}/`) && p.caminho.split("/").length === caminho.split("/").length + 1);
      return filhos.map<PastaExistente>((p) => ({ id: p.id, nome: nome(p.caminho), caminho: p.caminho }));
    },
    async criarPasta(caminho) {
      const ja = porCaminho(caminho);
      const id = ja ? ja.id : criarSilencioso(caminho);
      return { id, nome: nome(caminho), caminho };
    },
    async metadados(ref) {
      const p = ref.startsWith("id:") ? pastas.get(ref) : porCaminho(ref);
      if (!p) throw new ErroItemNaoEncontrado();
      return { id: p.id, nome: nome(p.caminho), caminho: p.caminho, tipo: "folder" };
    },
    async enviar(caminho, conteudo) { arquivos.push({ caminho, bytes: conteudo.length }); return { id: `id:f${arquivos.length}`, caminho }; },
  };
  return { drive, pastas, arquivos, renomear: (id: string, novo: string) => { pastas.get(id)!.caminho = novo; }, apagar: (id: string) => pastas.delete(id) };
}
