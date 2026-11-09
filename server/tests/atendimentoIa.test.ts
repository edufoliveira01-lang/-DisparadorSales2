import { describe, expect, it } from "vitest";
import { lerAtendimentoIa, montarPromptDoAgente, pendenciasDoAtendimentoIa, salvarAtendimentoIa, AREAS_PRONTAS } from "../src/services/gestao/atendimentoIa";
import { lerEscritorio, salvarEscritorio } from "../src/services/gestao/escritorio";

describe("Atendimento com IA — cadastro e prompt do agente", () => {
  it("começa com as áreas prontas desligadas e mostra o que falta", () => {
    const c = lerAtendimentoIa();
    expect(c.areas.map((a) => a.id)).toEqual(AREAS_PRONTAS.map((a) => a.id));
    expect(c.areas.every((a) => !a.ativa)).toBe(true);
    expect(pendenciasDoAtendimentoIa(c, { nome: "", razao_social: "", telefones: [], advogados: [] } as never).join(" ")).toContain("área");
  });

  it("gera o prompt com os dados do escritório, o nome do agente, as áreas e a triagem; áreas próprias entram", () => {
    salvarEscritorio({ nome: "Sales & Associados", cidade: "Santos", uf: "sp", endereco: "Rua A, 10", telefones: ["(13) 3333-4444"], email: "contato@x.com", advogados: [{ tratamento: "Dr.", nome: "Pedro Sales", oab: "OAB/SP 1" }] });
    const salvo = salvarAtendimentoIa({
      nome_agente: "Sofia", horario: "segunda a sexta, das 9h às 18h", urgencia: "(13) 99999-0000",
      honorarios_politica: "Trabalhamos com êxito; o atendente apresenta as condições.",
      areas: [
        { id: "previdenciario", ativa: true }, { id: "trabalhista", ativa: false },
        { nome: "Consumidor", ativa: true, triagem: "O que foi cobrado?\nDesde quando?", documentos: ["Fatura", "Protocolo"] },
      ],
    });
    expect(salvo.areas.find((a) => a.id === "previdenciario")).toMatchObject({ ativa: true });
    expect(salvo.areas.find((a) => a.id === "previdenciario")!.triagem.length).toBeGreaterThan(2); // a área pronta já vem preenchida
    expect(salvo.areas.find((a) => a.nome === "Consumidor")).toMatchObject({ propria: true, ativa: true, triagem: ["O que foi cobrado?", "Desde quando?"] });

    const p = montarPromptDoAgente();
    expect(p).toContain("**Sofia**, assistente virtual do **Sales & Associados**");
    expect(p).toContain("Rua A, 10, Santos/SP");
    expect(p).toContain("(13) 3333-4444");
    expect(p).toContain("Dr. Pedro Sales");
    expect(p).toContain("previdenciário, consumidor"); // só as áreas ligadas
    expect(p).not.toContain("**Trabalhista**");
    expect(p).toContain("O que foi cobrado?");
    expect(p).toContain("Trabalhamos com êxito");
    expect(p).toContain("segunda a sexta, das 9h às 18h");
    expect(p).toContain("(13) 99999-0000");
    expect(p).not.toMatch(/\{\{|\}\}/);
    for (const f of ["consultar_cliente", "andamento_do_processo", "proximos_compromissos", "documentos_do_cliente", "financeiro_do_cliente"]) expect(p).toContain(f);
    expect(p).toContain("Só responda com o que a ferramenta devolveu");
    expect(p).toContain("a rogo");
    expect(p).toContain("crm_enviar_contrato");
    expect(p).toContain("Nunca use a ferramenta de contrato na mesma vez");
    expect(p).toContain("não mande outra igual");
    expect(p).toContain("Espere a resposta dela");
    expect(p).toContain("Você quer seguir com a gente?");
    expect(p).toContain("A triagem tem fim");
    expect(p).toContain("Não presuma o enquadramento pelo que a pessoa diz no começo");
    expect(p).toContain("sem sugerir ação contra a empresa ou o aplicativo");
    expect(p).toContain("Não cite resultados que o escritório não atende");
    expect(p).toContain("a idade basta");
    expect(p).toContain("faça a conta da renda por pessoa");
    expect(p).toContain("CadÚnico");
    expect(p).toContain("Acidente de trabalho (CAT)");
    expect(p).toContain("Responda como especialista, sem prometer ganho");
    expect(p).toContain("Pensão por morte:");
    expect(p).toContain("cpf_para_confirmar");
    expect(p).toContain("Nunca marque o atendimento como \"ganho\"");
    expect(p).toContain("Não fale de porcentagem antes do resumo do caso");
    expect(p).toContain("Inclua no resumo as ressalvas que apareceram");
    expect(p).toContain("Faça a pergunta de decisão uma única vez");
    expect(p).toContain("nunca escreva o CPF inteiro na conversa");
    expect(p).toContain("data de nascimento e nome da mãe");
    expect(p).toContain("Nunca** envie listas numeradas de perguntas");
    expect(p).toContain("Irritação não é motivo para passar a conversa à equipe");
    expect(p).toContain("Peça os dados em blocos curtos");
    expect(p).toContain("endereço completo numa pergunta só");
    expect(p).toContain("grave agora o que está na conversa");
    expect(p).toContain("um item curto por área");
    expect(p).toContain("Nunca condicione o resumo do caso nem o contrato a documentos");
    expect(p).toContain("avance o funil para \"proposta aceita\"");
    expect(p).toContain("avance o funil para \"proposta enviada\"");
    expect(p).toContain("crm_registrar_dados_do_cliente");
    expect(p).toContain("nunca pergunte de novo o que já está lá");
    expect(p).toContain("O primeiro nome basta");
    expect(p).toContain("Não presuma o nome a partir do perfil do WhatsApp");
    expect(p).toContain("Com quem eu falo");
    expect(p).toContain("obrigatório só aqui, na hora do contrato");
    expect(p).toContain("Depois da assinatura a conversa continua, com você");
    expect(p).toContain("proposta aceita");
    expect(p).toContain("Nunca marque o negócio como ganho por conta própria");
    expect(p).toContain("Identifique todas as áreas do escritório que o caso toca");
    expect(p).toContain("pistas de outra área");
    expect(p).toContain("etapa obrigatória, antes de qualquer dado do contrato");
    expect(p).toContain("não envie o link de novo");
    expect(p).toContain("Documento nunca trava o atendimento nem o contrato");
    expect(p).toContain("nunca repita pergunta");
    expect(p).toContain("Uma pergunta por mensagem");
    // querer contratar não pode estar na lista de motivos para passar a conversa a um humano
    const secao8 = p.slice(p.indexOf("### 8."), p.indexOf("### 9."));
    expect(secao8).not.toMatch(/pronta para \*\*contratar/);
  });
  it("sem política de honorários o agente não informa valores; área ligada exige triagem; chaves {{ }} são removidas", () => {
    salvarAtendimentoIa({ areas: [{ id: "previdenciario", ativa: true }] });
    expect(montarPromptDoAgente()).toContain("não informa valores nem percentuais");
    expect(() => salvarAtendimentoIa({ areas: [{ nome: "Criminal", ativa: true, triagem: "" }] })).toThrow(/triagem/);
    expect(salvarAtendimentoIa({ observacoes: "Use {{isto}}" }).observacoes).toBe("Use isto");
    // volta ao estado inicial para os outros testes
    salvarAtendimentoIa({});
  });
  it("honorários longos não são cortados e, sem nome do escritório, o texto não sai 'do o escritório'", () => {
    const longo = "Linha de honorários. ".repeat(100) + "FIM";
    const salvo = salvarAtendimentoIa({ areas: [{ id: "previdenciario", ativa: true }], honorarios_politica: longo });
    expect(salvo.honorarios_politica.endsWith("FIM")).toBe(true);
    const p = montarPromptDoAgente(salvo, { ...lerEscritorio(), nome: "", razao_social: "" });
    expect(p).not.toContain("do o escritório");
    expect(p).toContain("FIM");
    salvarAtendimentoIa({});
  });
  it("exigir documentos é opção do escritório: desligado, o documento não trava; ligado, o contrato espera os essenciais", () => {
    salvarAtendimentoIa({ areas: [{ id: "previdenciario", ativa: true }] });
    expect(montarPromptDoAgente()).toContain("Documento nunca trava o atendimento nem o contrato");
    const ligado = salvarAtendimentoIa({ areas: [{ id: "previdenciario", ativa: true }], exigir_documentos: true });
    expect(ligado.exigir_documentos).toBe(true);
    const p = montarPromptDoAgente();
    expect(p).toContain("exige os documentos essenciais antes do contrato");
    expect(p).not.toContain("Documento nunca trava");
    salvarAtendimentoIa({});
    expect(lerAtendimentoIa().exigir_documentos).toBe(false);
  });
  it("revisão humana é opção do escritório: desligada, o agente envia o contrato; ligada, reúne os dados e passa à equipe", () => {
    salvarAtendimentoIa({ areas: [{ id: "previdenciario", ativa: true }] });
    expect(montarPromptDoAgente()).toContain("você mesma envia o contrato para assinatura");
    const ligado = salvarAtendimentoIa({ areas: [{ id: "previdenciario", ativa: true }], revisao_humana: true });
    expect(ligado.revisao_humana).toBe(true);
    const p = montarPromptDoAgente();
    expect(p).toContain("Contrato (com revisão da equipe)");
    expect(p).toContain("NÃO use crm_enviar_contrato");
    expect(p).not.toContain("você mesma envia o contrato para assinatura");
    salvarAtendimentoIa({});
    expect(lerAtendimentoIa().revisao_humana).toBe(false);
  });
  it("a triagem previdenciária nova (carta do INSS, vínculo e contribuições, BO) chega a quem nunca editou a antiga, e quem editou mantém a sua", () => {
    const antiga = ["Qual benefício ou problema (aposentadoria, auxílio por incapacidade, BPC, pensão, revisão, benefício negado ou cortado)?", "Já pediu ao INSS? Qual foi a resposta?", "Qual a idade e se está trabalhando ou contribuindo.", "Se for doença ou acidente: qual a condição e desde quando está afastado do trabalho.", "Se existem laudos ou atestados."];
    const sem = salvarAtendimentoIa({ areas: [{ id: "previdenciario", ativa: true, triagem: antiga }] });
    const t = sem.areas.find((a) => a.id === "previdenciario")!.triagem.join(" | ");
    expect(t).toMatch(/número do requerimento/);
    expect(t).toMatch(/autônomo ou MEI/);
    expect(t).toMatch(/boletim de ocorrência/);
    expect(sem.areas.find((a) => a.id === "previdenciario")!.triagem.length).toBeLessThanOrEqual(6);
    const editada = salvarAtendimentoIa({ areas: [{ id: "previdenciario", ativa: true, triagem: ["Só esta pergunta."] }] });
    expect(editada.areas.find((a) => a.id === "previdenciario")!.triagem).toEqual(["Só esta pergunta."]);
    salvarAtendimentoIa({});
  });
});
