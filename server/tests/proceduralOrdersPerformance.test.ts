import assert from "node:assert/strict";
import { it } from "vitest";
import { identificarOrdensProcessuais } from "../src/services/djen/proceduralOrders";

// Resultados de referência capturados antes da otimização: destinatários, prazos e trechos.
const casos = [
  {
    "text": "Intime-se o INSS para implantar o benefício no prazo de 30 dias.",
    "orders": [
      {
        "responsavel": "parte_contraria",
        "destinatario": "INSS / autarquia",
        "acao": "implantacao",
        "descricao": "Implantação / restabelecimento do benefício",
        "tipo": "prazo_explicito",
        "trecho": "Intime-se o INSS para implantar o benefício no prazo de 30 dias",
        "dias": 30,
        "unidade": "uteis",
        "prazo_texto": "30 dias",
        "alerta": null
      }
    ]
  },
  {
    "text": "Intime-se a parte autora para apresentar documentos em 5 dias úteis.",
    "orders": [
      {
        "responsavel": "escritorio",
        "destinatario": "Escritório / parte representada",
        "acao": "manifestacao",
        "descricao": "Manifestação / providência processual",
        "tipo": "prazo_explicito",
        "trecho": "Intime-se a parte autora para apresentar documentos em 5 dias úteis",
        "dias": 5,
        "unidade": "uteis",
        "prazo_texto": "5 dias úteis",
        "alerta": null
      }
    ]
  },
  {
    "text": "Intime-se o perito para apresentar o laudo em 15 dias.",
    "orders": [
      {
        "responsavel": "perito",
        "destinatario": "Perito",
        "acao": "laudo",
        "descricao": "Apresentação do laudo",
        "tipo": "prazo_explicito",
        "trecho": "Intime-se o perito para apresentar o laudo em 15 dias",
        "dias": 15,
        "unidade": "uteis",
        "prazo_texto": "15 dias",
        "alerta": null
      }
    ]
  },
  {
    "text": "Intime-se o perito para prestar esclarecimentos no prazo de dez dias.",
    "orders": [
      {
        "responsavel": "perito",
        "destinatario": "Perito",
        "acao": "esclarecimentos",
        "descricao": "Esclarecimentos / complementação pericial",
        "tipo": "prazo_explicito",
        "trecho": "Intime-se o perito para prestar esclarecimentos no prazo de dez dias",
        "dias": 10,
        "unidade": "uteis",
        "prazo_texto": "dez dias",
        "alerta": null
      }
    ]
  },
  {
    "text": "Intime-se a contadoria para apresentar cálculos em trinta dias.",
    "orders": [
      {
        "responsavel": "contadoria",
        "destinatario": "Perito de cálculos / contadoria",
        "acao": "calculos",
        "descricao": "Apresentação / manifestação sobre cálculos",
        "tipo": "prazo_explicito",
        "trecho": "Intime-se a contadoria para apresentar cálculos em trinta dias",
        "dias": 30,
        "unidade": "uteis",
        "prazo_texto": "trinta dias",
        "alerta": null
      }
    ]
  },
  {
    "text": "Intimem-se ambas as partes para manifestação no prazo comum de 15 dias.",
    "orders": [
      {
        "responsavel": "ambas_partes",
        "destinatario": "Ambas as partes",
        "acao": "manifestacao",
        "descricao": "Manifestação / providência processual",
        "tipo": "prazo_explicito",
        "trecho": "Intimem-se ambas as partes para manifestação no prazo comum de 15 dias",
        "dias": 15,
        "unidade": "uteis",
        "prazo_texto": "15 dias",
        "alerta": null
      }
    ]
  },
  {
    "text": "Quando necessário, intime-se o INSS para implantar o benefício em 30 dias.",
    "orders": []
  },
  {
    "text": "Intime-se a parte autora para ciência.",
    "orders": [
      {
        "responsavel": "escritorio",
        "destinatario": "Escritório / parte representada",
        "acao": "ciencia",
        "descricao": "Ciência / comunicação",
        "tipo": "ciencia",
        "trecho": "Intime-se a parte autora para ciência",
        "dias": null,
        "unidade": null,
        "prazo_texto": null,
        "alerta": null
      }
    ]
  },
  {
    "text": "Intime-se a parte autora para apresentar documentos em 5 (quinze) dias.",
    "orders": [
      {
        "responsavel": "escritorio",
        "destinatario": "Escritório / parte representada",
        "acao": "manifestacao",
        "descricao": "Manifestação / providência processual",
        "tipo": "prazo_explicito",
        "trecho": "Intime-se a parte autora para apresentar documentos em 5 (quinze) dias",
        "dias": null,
        "unidade": "uteis",
        "prazo_texto": "5 (quinze) dias",
        "alerta": "Divergência entre número e extenso: confira o período no documento."
      }
    ]
  },
  {
    "text": "Intime-se a parte autora para apresentar documentos no prazo de 48 horas.",
    "orders": [
      {
        "responsavel": "escritorio",
        "destinatario": "Escritório / parte representada",
        "acao": "manifestacao",
        "descricao": "Manifestação / providência processual",
        "tipo": "prazo_explicito",
        "trecho": "Intime-se a parte autora para apresentar documentos no prazo de 48 horas",
        "dias": null,
        "unidade": "horas",
        "prazo_texto": "48 horas",
        "alerta": "Unidade não calculada automaticamente. Confira o marco e registre a data manualmente."
      }
    ]
  },
  {
    "text": "Intime-se a parte autora para apresentar documentos no prazo de 5 dias após a juntada do laudo.",
    "orders": [
      {
        "responsavel": "escritorio",
        "destinatario": "Escritório / parte representada",
        "acao": "laudo",
        "descricao": "Apresentação do laudo",
        "tipo": "prazo_explicito",
        "trecho": "Intime-se a parte autora para apresentar documentos no prazo de 5 dias após a juntada do laudo",
        "dias": null,
        "unidade": "uteis",
        "prazo_texto": "5 dias",
        "alerta": "Marco inicial específico no texto. Confira o evento que inicia a contagem antes de calcular; não use a disponibilização automaticamente."
      }
    ]
  },
  {
    "text": "Intime-se a parte autora para apresentar documentos até 10/12/2026.",
    "orders": [
      {
        "responsavel": "escritorio",
        "destinatario": "Escritório / parte representada",
        "acao": "manifestacao",
        "descricao": "Manifestação / providência processual",
        "tipo": "prazo_explicito",
        "trecho": "Intime-se a parte autora para apresentar documentos até 10/12/2026",
        "dias": null,
        "unidade": "data_expressa",
        "prazo_texto": "até 10/12/2026",
        "alerta": "Data limite expressa: confira e registre a data informada, sem converter em quantidade de dias."
      }
    ]
  },
  {
    "text": "Intime-se o INSS para apresentar manifestação em 10 dias. Intime-se o perito para apresentar o laudo em 20 dias.",
    "orders": [
      {
        "responsavel": "parte_contraria",
        "destinatario": "INSS / autarquia",
        "acao": "manifestacao",
        "descricao": "Manifestação / providência processual",
        "tipo": "prazo_explicito",
        "trecho": "Intime-se o INSS para apresentar manifestação em 10 dias",
        "dias": 10,
        "unidade": "uteis",
        "prazo_texto": "10 dias",
        "alerta": null
      },
      {
        "responsavel": "perito",
        "destinatario": "Perito",
        "acao": "laudo",
        "descricao": "Apresentação do laudo",
        "tipo": "prazo_explicito",
        "trecho": "Intime-se o perito para apresentar o laudo em 20 dias",
        "dias": 20,
        "unidade": "uteis",
        "prazo_texto": "20 dias",
        "alerta": null
      }
    ]
  },
  {
    "text": "Intime-se o Sr. perito para apresentar o laudo em 15 dias.",
    "orders": [
      {
        "responsavel": "perito",
        "destinatario": "Perito",
        "acao": "laudo",
        "descricao": "Apresentação do laudo",
        "tipo": "prazo_explicito",
        "trecho": "Intime-se o Sr. perito para apresentar o laudo em 15 dias",
        "dias": 15,
        "unidade": "uteis",
        "prazo_texto": "15 dias",
        "alerta": null
      }
    ]
  },
  {
    "text": "Intime-se a parte autora para apresentar os docu-\nmentos no prazo de 5 dias.",
    "orders": [
      {
        "responsavel": "escritorio",
        "destinatario": "Escritório / parte representada",
        "acao": "manifestacao",
        "descricao": "Manifestação / providência processual",
        "tipo": "prazo_explicito",
        "trecho": "Intime-se a parte autora para apresentar os docu-\nmentos no prazo de 5 dias",
        "dias": 5,
        "unidade": "uteis",
        "prazo_texto": "5 dias",
        "alerta": null
      }
    ]
  },
  {
    "text": "INTIME-SE A PARTE AUTORA\tPARA APRESENTAR MANIFESTAÇÃO EM CINCO DIAS ÚTEIS.",
    "orders": [
      {
        "responsavel": "escritorio",
        "destinatario": "Escritório / parte representada",
        "acao": "manifestacao",
        "descricao": "Manifestação / providência processual",
        "tipo": "prazo_explicito",
        "trecho": "INTIME-SE A PARTE AUTORA\tPARA APRESENTAR MANIFESTAÇÃO EM CINCO DIAS ÚTEIS",
        "dias": 5,
        "unidade": "uteis",
        "prazo_texto": "CINCO DIAS ÚTEIS",
        "alerta": null
      }
    ]
  },
  {
    "text": "Intime-se a parte autora para manifesta­ção em cinco dias.",
    "orders": [
      {
        "responsavel": "escritorio",
        "destinatario": "Escritório / parte representada",
        "acao": "manifestacao",
        "descricao": "Manifestação / providência processual",
        "tipo": "prazo_explicito",
        "trecho": "Intime-se a parte autora para manifesta­ção em cinco dias",
        "dias": 5,
        "unidade": "uteis",
        "prazo_texto": "cinco dias",
        "alerta": null
      }
    ]
  },
  {
    "text": "Intime-se o INSS para ciência e manifestação sobre proposta de acordo em 15 dias.",
    "orders": [
      {
        "responsavel": "parte_contraria",
        "destinatario": "INSS / autarquia",
        "acao": "manifestacao",
        "descricao": "Manifestação sobre proposta de acordo",
        "tipo": "prazo_explicito",
        "trecho": "Intime-se o INSS para ciência e manifestação sobre proposta de acordo em 15 dias",
        "dias": 15,
        "unidade": "uteis",
        "prazo_texto": "15 dias",
        "alerta": null
      }
    ]
  },
  {
    "text": "Intime-se o INSS para implantar o benefício em 30 dias. Intime-se a parte autora para apresentar documentos em 5 dias.",
    "orders": [
      {
        "responsavel": "parte_contraria",
        "destinatario": "INSS / autarquia",
        "acao": "implantacao",
        "descricao": "Implantação / restabelecimento do benefício",
        "tipo": "prazo_explicito",
        "trecho": "Intime-se o INSS para implantar o benefício em 30 dias",
        "dias": 30,
        "unidade": "uteis",
        "prazo_texto": "30 dias",
        "alerta": null
      },
      {
        "responsavel": "escritorio",
        "destinatario": "Escritório / parte representada",
        "acao": "manifestacao",
        "descricao": "Manifestação / providência processual",
        "tipo": "prazo_explicito",
        "trecho": "Intime-se a parte autora para apresentar documentos em 5 dias",
        "dias": 5,
        "unidade": "uteis",
        "prazo_texto": "5 dias",
        "alerta": null
      }
    ]
  },
  {
    "text": "Intime-se a parte autora para ciência. 😃 İ ç ã é \ud800",
    "orders": [
      {
        "responsavel": "escritorio",
        "destinatario": "Escritório / parte representada",
        "acao": "ciencia",
        "descricao": "Ciência / comunicação",
        "tipo": "ciencia",
        "trecho": "Intime-se a parte autora para ciência",
        "dias": null,
        "unidade": null,
        "prazo_texto": null,
        "alerta": null
      }
    ]
  },
  {
    "text": "",
    "orders": []
  },
  {
    "text": "Publicação sem ordem processual, com menção ao art. 123 e n. 45.",
    "orders": []
  }
];

for (const [indice, caso] of casos.entries()) {
  it(`preserva ordens e trechos literais do cenário ${indice + 1}`, () => {
    assert.deepEqual(identificarOrdensProcessuais(caso.text), caso.orders);
    assert.deepEqual(identificarOrdensProcessuais(caso.text), caso.orders);
  });
}

it("não permite que um consumidor altere os resultados guardados", () => {
  const caso = casos[0];
  const resultado = identificarOrdensProcessuais(caso.text);
  resultado[0].dias = 999;
  resultado.length = 0;
  assert.deepEqual(identificarOrdensProcessuais(caso.text), caso.orders);
});

it("reanalisa o texto corrigido sem reutilizar os dias do texto anterior", () => {
  const texto = "Intime-se a parte autora para apresentar documentos em 5 dias.";
  assert.equal(identificarOrdensProcessuais(texto)[0].dias, 5);
  assert.equal(identificarOrdensProcessuais(texto.replace("5 dias", "10 dias"))[0].dias, 10);
});
