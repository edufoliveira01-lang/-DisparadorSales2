import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/db";
import { identificarOrdensProcessuais } from "../src/services/djen/proceduralOrders";
import { identificarPrazos, sugestoesPrazos } from "../src/services/djen/deadlines";
import { identificarObrigacoesExternas } from "../src/services/djen/obligations";
import { ordemComPrazoDaParte, validarAnaliseCodex } from "../src/services/djen/classifier";
import { classificarPublicacaoParaQuadro } from "../src/services/djen/kanbanClassifier";
import { detalhesPublicacao, listarPublicacoes } from "../src/services/djen/store";
import { listarKanban } from "../src/services/djen/kanban";
import { EMENDA_ANDRADINA } from "./fixtures/djenEmenda";
let serial=0;
beforeEach(() => { db.exec("DELETE FROM djen_publicacoes; DELETE FROM djen_processos; UPDATE djen_config SET ia_ativa=0"); });
describe("extração unificada de providências", () => {
  it("reproduz a emenda em 15 dias sem confundir os 180 dias de idade do comprovante", () => {
    const ordens=identificarOrdensProcessuais(EMENDA_ANDRADINA);
    expect(ordens).toHaveLength(1);
    expect(ordens[0]).toMatchObject({responsavel:"escritorio",tipo:"prazo_explicito",acao:"emenda_inicial",dias:15});
    expect(EMENDA_ANDRADINA).toContain(ordens[0].trecho);
    expect(identificarPrazos(EMENDA_ANDRADINA).map(o=>o.dias)).toEqual([15]);
    expect(ordemComPrazoDaParte(ordens[0].trecho)).toBe(true);
    expect(classificarPublicacaoParaQuadro(EMENDA_ANDRADINA)?.codigo).toBe("emenda_inicial");
  });
  it.each([
    "Fica a parte autora regularmente intimada a promover emenda à inicial, no prazo improrrogável de 15 (quinze) dias.",
    "Intime-se a autora para EMENDA À INICIAL no prazo comum de quinze dias.",
    "Fica a parte autora regularmente\nintimada a pro-\nmover emenda à inicial no prazo de 15 dias.",
    "A autora deverá emendar a inicial dentro de quinze dias.",
  ])("reconhece variações de redação e quebra de linha: %s", texto => {
    expect(identificarPrazos(texto).map(o=>o.dias)).toEqual([15]);
    expect(classificarPublicacaoParaQuadro(texto)?.codigo).toBe("emenda_inicial");
  });
  it("separa ordens simultâneas, destinatários e unidades", () => {
    const texto="Intime-se a autora para emendar a inicial em 5 dias; intime-se o Sr. Perito para complementar o laudo em 15 dias; intime-se o INSS para implantar o benefício em 30 dias corridos.";
    expect(identificarPrazos(texto).map(o=>o.dias)).toEqual([5]);
    expect(identificarObrigacoesExternas(texto)).toMatchObject([{tipo:"perito_esclarecimentos",prazo_citado_dias:15},{tipo:"inss_implantacao",prazo_citado_dias:30}]);
    expect(identificarOrdensProcessuais(texto).map(o=>o.responsavel)).toEqual(["escritorio","perito","parte_contraria"]);
  });
  it.each([
    "Intime-se a autora para ciência da juntada do laudo pericial.",
    "Intime-se a autora para ciência do despacho e intime-se a secretaria para juntar documentos em 5 dias.",
    "Dê-se ciência à autora. O perito apresentará laudo em 20 dias.",
    "Caso não seja juntado o laudo, intime-se a autora para se manifestar em 5 dias.",
    "Após a juntada do laudo, intime-se a autora para manifestação em 15 dias.",
    "A autora requereu a intimação do INSS para implantar o benefício em 30 dias.",
    "Jurisprudência: intime-se a autora para emendar a inicial em 15 dias.",
    "Fica revogada a ordem: intime-se a autora para emendar a inicial em 15 dias.",
    "Não determino que a autora cumpra a emenda à inicial em 15 dias.",
    "O comprovante de endereço deve ter no máximo 180 dias anteriores ao ajuizamento.",
  ])("não cria prazo do escritório a partir de comunicação, hipótese ou referência: %s",texto=>expect(identificarPrazos(texto)).toEqual([]));
  it("identifica providência sem período, sem inventar dias",()=>{
    const ordens=identificarOrdensProcessuais("Intime-se a autora para juntar comprovante de endereço atualizado.");
    expect(ordens).toMatchObject([{tipo:"cumprimento",dias:null}]);
    expect(identificarPrazos(ordens[0].trecho)).toEqual([]);
  });
  it.each([
    ["Intime-se a autora para apresentar os documentos em 24 horas.","horas"],
    ["Intime-se a autora para comprovar o cumprimento em 2 meses.","meses"],
    ["Intime-se a autora para juntar documentos até 10/11/2026.","data_expressa"],
    ["Intime-se a autora para manifestar-se em 5 (quinze) dias.","uteis"],
    ["Intime-se a autora para se manifestar em 15 dias a contar da juntada do laudo.","uteis"],
    ["Intime-se a autora para se manifestar em 5 dias e juntar documentos em 10 dias.","uteis"],
  ])("expõe período que exige conferência sem converter nem ocultar: %s",(texto,unidade)=>{
    expect(identificarOrdensProcessuais(texto)).toMatchObject([{tipo:"prazo_explicito",dias:null,unidade,alerta:expect.any(String)}]);
    expect(identificarPrazos(texto)).toEqual([]);
  });
  it("não transforma previsão de emenda em etapa atual, nem perde sentença seguida de providência futura",()=>{
    expect(classificarPublicacaoParaQuadro("Caso necessário, intime-se a autora para emendar a inicial em 15 dias.")).toBeNull();
    expect(classificarPublicacaoParaQuadro("Julgo procedente o pedido. Após o trânsito em julgado, inicie-se o cumprimento de sentença.")?.codigo).toBe("sentenca");
  });
  it("alinha detalhe, lista, sugestões e Kanban mesmo com análise antiga marcada ciência",()=>{
    const chave=`9988${++serial}`;db.prepare("INSERT INTO djen_processos(chave,numero) VALUES (?,?)").run(chave,chave);
    const analise={categorias:["intimacao"],resultado:"nao_identificado",resumo:"Emenda à inicial determinada em 15 dias.",justificativa:"Ordem expressa.",agendamento:{data:null,horario:null,local:null},providencia:{tipo:"ciencia",responsavel:"escritorio",descricao:null,prazo_texto:null},alertas:[],evidencias:[]};
    const id=Number(db.prepare("INSERT INTO djen_publicacoes(comunicacao_id,processo_chave,tribunal,orgao,classe,tipo_documento,tipo_comunicacao,data_disponibilizacao,texto,ia_json,categorias_json) VALUES (?,?,'TRF3','JEF Andradina','JEF Cível','Ato ordinatório','Intimação','2026-10-30',?,?,?)").run(`order-${serial}`,chave,EMENDA_ANDRADINA,JSON.stringify(analise),'["intimacao"]').lastInsertRowid);
    expect(detalhesPublicacao(id).acao).toMatchObject({tipo:"prazo_explicito",descricao:"Emenda à inicial",fonte:"publicacao"});
    expect(listarPublicacoes({}).items[0].acao.tipo).toBe("prazo_explicito");
    expect(sugestoesPrazos({texto:EMENDA_ANDRADINA,tribunal:"TRF3",orgao:"JEF"}).candidatos).toMatchObject([{dias:15}]);
    const quadro=listarKanban();const cartao=quadro.cartoes.find(c=>c.processo_chave===chave)!;
    expect(quadro.listas.find(l=>l.id===cartao.lista_id)?.codigo).toBe("emenda_inicial");
    expect(JSON.parse((db.prepare("SELECT ia_json FROM djen_publicacoes WHERE id=?").get(id) as any).ia_json).providencia.tipo).toBe("ciencia");
    const nova=validarAnaliseCodex(analise,EMENDA_ANDRADINA);
    expect(nova.providencia).toMatchObject({tipo:"prazo_explicito",responsavel:"escritorio",descricao:"Emenda à inicial"});
  });
});
