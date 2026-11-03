import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/db";
import { detectarArea, ramoDaJustica } from "../src/services/djen/area";
import { identificarOrdensProcessuais } from "../src/services/djen/proceduralOrders";
import { identificarObrigacoesExternas } from "../src/services/djen/obligations";
import { classificarPublicacaoParaQuadro } from "../src/services/djen/kanbanClassifier";
import { classificarComplementar } from "../src/services/djen/classificacaoComplementar";
import { listarKanban, alterarAreaProcesso } from "../src/services/djen/kanban";

const pub = (classe: string, orgao: string, texto: string, tribunal = "TJSP") => ({ classe, orgao, texto, tribunal });

describe("detecção da área do processo", () => {
  it("Justiça do Trabalho pelo número CNJ, classe ou órgão", () => {
    expect(ramoDaJustica("00012345620255020001")).toBe("5");
    expect(detectarArea({ chave: "00012345620255020001", publicacoes: [] }).area).toBe("trabalhista");
    expect(detectarArea({ chave: "x", publicacoes: [pub("Reclamação Trabalhista", "5ª Vara do Trabalho de São Paulo", "Vistos.", "TRT2")] }).area).toBe("trabalhista");
    expect(detectarArea({ chave: "x", publicacoes: [pub("Procedimento", "Vara", "Intime-se a reclamada para juntar documentos.")] }).area).toBe("trabalhista");
  });
  it("Vara de Acidentes do Trabalho e INSS são previdenciário, não trabalhista", () => {
    expect(detectarArea({ chave: "11415572220258260053", publicacoes: [pub("Procedimento", "Foro Central - 4ª Vara de Acidentes do Trabalho", "Vistos.")] }).area).toBe("previdenciario");
    expect(detectarArea({ chave: "x", publicacoes: [pub("Procedimento", "Vara", "O INSS apresentou proposta de acordo para restabelecer o auxílio-doença.")] }).area).toBe("previdenciario");
  });
  it("bancário por classe ou texto; cível sem sinais", () => {
    expect(detectarArea({ chave: "x", publicacoes: [pub("Busca e Apreensão em Alienação Fiduciária", "Vara Cível", "Vistos.")] }).area).toBe("bancario");
    expect(detectarArea({ chave: "x", publicacoes: [pub("Procedimento Comum", "Vara Cível", "Cite-se o Banco X S.A. para contestar a revisão de juros abusivos.")] }).area).toBe("bancario");
    expect(detectarArea({ chave: "x", publicacoes: [pub("Procedimento Comum", "Vara Cível", "Vistos. Aguarde-se.")] }).area).toBe("civel");
  });
});

describe("vocabulário trabalhista e bancário", () => {
  it("reconhece reclamante/reclamada/banco e seus verbos", () => {
    const ordens = (t: string) => identificarOrdensProcessuais(t).map((o) => `${o.responsavel}/${o.acao}/${o.dias ?? "-"}`);
    expect(ordens("Intime-se o reclamante para apresentar réplica à defesa no prazo de 10 dias.")).toEqual(["escritorio/manifestacao/10"]);
    expect(ordens("Intime-se a reclamada para juntar os documentos solicitados no prazo de 15 dias.")).toEqual(["parte_contraria/manifestacao/15"]);
    expect(ordens("Intime-se o autor para especificar as provas que pretende produzir em 5 dias.")).toEqual(["escritorio/manifestacao/5"]);
    expect(ordens("Intime-se o banco réu para contestar em 15 dias.")[0]).toMatch(/^parte_contraria/);
    expect(identificarObrigacoesExternas("Intime-se a reclamada para juntar os documentos solicitados no prazo de 15 dias.").map((o) => o.tipo)).toEqual(["parte_contraria"]);
    expect(identificarObrigacoesExternas("Intime-se a reclamada para juntar os documentos solicitados no prazo de 15 dias.")[0].responsavel).toBe("Parte contrária (reclamada)");
  });
  it("audiência una e execução (penhora, alvará) viram etapa; hipótese não", () => {
    expect(classificarComplementar("Designada audiência UNA para 10/12/2026, às 09h.").categorias).toContain("audiencia");
    expect(classificarPublicacaoParaQuadro("Realizado bloqueio via Sisbajud em contas da executada.")?.codigo).toBe("penhora_bloqueio");
    expect(classificarPublicacaoParaQuadro("Expeça-se alvará em favor do reclamante.")?.codigo).toBe("pagamento_alvara");
    expect(classificarPublicacaoParaQuadro("Intime-se a executada para pagar em 48 horas, sob pena de penhora.")).toBeNull();
    expect(classificarPublicacaoParaQuadro("Após o pagamento será expedido alvará.")).toBeNull();
  });
});

describe("quadro por área", () => {
  let serial = 0;
  const publicar = (processo: string, texto: string, classe = "Procedimento", orgao = "Vara", tribunal = "TJSP") => {
    db.prepare("INSERT OR IGNORE INTO djen_processos(chave,numero) VALUES (?,?)").run(processo, processo);
    db.prepare(`INSERT INTO djen_publicacoes(comunicacao_id,processo_chave,tribunal,orgao,classe,tipo_documento,tipo_comunicacao,data_disponibilizacao,texto)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(`ar-${++serial}`, processo, tribunal, orgao, classe, "Despacho", "Intimação", new Date().toISOString().slice(0, 10), texto);
  };
  const codigoDe = (processo: string) => { const q = listarKanban(); const c = q.cartoes.find((x) => x.processo_chave === processo)!; return { codigo: q.listas.find((l) => l.id === c.lista_id)!.codigo, area: c.area, manual: c.area_manual }; };
  beforeEach(() => db.exec("DELETE FROM djen_kanban_movimentos;DELETE FROM djen_kanban_cartoes;DELETE FROM djen_prazos;DELETE FROM djen_publicacoes;DELETE FROM djen_processos;"));

  it("trabalhista com bloqueio vai para Penhora / bloqueio; previdenciário não usa essa lista", () => {
    publicar("00012345620255020001", "Realizado bloqueio via Sisbajud em contas da reclamada.", "Execução Trabalhista", "5ª Vara do Trabalho", "TRT2");
    expect(codigoDe("00012345620255020001")).toMatchObject({ codigo: "penhora_bloqueio", area: "trabalhista" });
    publicar("prev-1", "O INSS foi intimado. Realizado bloqueio de valores do benefício.");
    expect(codigoDe("prev-1").area).toBe("previdenciario");
    expect(codigoDe("prev-1").codigo).not.toBe("penhora_bloqueio");
  });
  it("etapas do INSS não se aplicam a processo trabalhista", () => {
    publicar("00012345620255020002", "Intime-se o INSS para implantar o benefício em 30 dias. Julgo procedente o pedido.", "Reclamação Trabalhista", "Vara do Trabalho", "TRT2");
    const r = codigoDe("00012345620255020002");
    expect(r.area).toBe("trabalhista");
    expect(r.codigo).not.toBe("aguarda_implantacao");
  });
  it("a área escolhida pelo usuário vale e pode voltar ao automático", () => {
    publicar("area-1", "Vistos. Aguarde-se.", "Procedimento Comum", "Vara Cível");
    expect(codigoDe("area-1").area).toBe("civel");
    alterarAreaProcesso("area-1", "bancario");
    expect(codigoDe("area-1")).toMatchObject({ area: "bancario", manual: 1 });
    db.prepare("UPDATE djen_kanban_cartoes SET revisar_etapa=1").run();
    expect(codigoDe("area-1").area).toBe("bancario");
    alterarAreaProcesso("area-1", null);
    expect(codigoDe("area-1")).toMatchObject({ area: "civel", manual: 0 });
    expect(() => alterarAreaProcesso("area-1", "xyz")).toThrow(/área/);
  });
  it("as listas novas de execução existem e servem só às áreas indicadas", () => {
    const q = listarKanban();
    expect(q.listas.find((l) => l.codigo === "penhora_bloqueio")!.area).toBe("trabalhista,bancario,civel");
    expect(q.listas.find((l) => l.codigo === "aguarda_implantacao")!.area).toBe("previdenciario,civel");
    expect(q.listas.find((l) => l.codigo === "rpv_expedida")!.area).toBeNull();
  });
});
