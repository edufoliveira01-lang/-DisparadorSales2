import { describe, expect, it } from 'vitest';
import { obrigacaoRevogada, periciaSuperada } from '../src/services/djen/followUpPolicy';
describe('cancelamento e substituição explícitos',()=>{
  it('revogação do prazo/laudo encerra a ordem específica',()=>{
    expect(obrigacaoRevogada('perito_laudo','Intime-se o perito para apresentar o laudo.', ['Torno sem efeito a intimação do perito para apresentação do laudo.'])).toBe(true);
    expect(obrigacaoRevogada('inss_implantacao','Intime-se o INSS para implantar o benefício.', ['Revogo a tutela que determinou a implantação do benefício.'])).toBe(true);
  });
  it('revogar multa, negar cancelamento e hipótese não cancelam a obrigação',()=>{
    expect(obrigacaoRevogada('perito_laudo','Apresentar laudo.', ['Revogo a multa aplicada ao perito e mantenho a intimação para apresentar laudo.'])).toBe(false);
    expect(obrigacaoRevogada('perito_laudo','Apresentar laudo.', ['Não cancelo a ordem de apresentação de laudo.'])).toBe(false);
    expect(obrigacaoRevogada('perito_laudo','Apresentar laudo.', ['Caso necessário, cancelo a ordem de apresentação do laudo.'])).toBe(false);
  });
  it('não transfere a revogação de documentos à contestação',()=>{
    expect(obrigacaoRevogada('parte_contraria','Parte contrária deve apresentar contestação.', ['Cancelo a intimação do INSS para juntar documentos.'])).toBe(false);
  });
  it('cancelamento da perícia antiga não é falta de laudo',()=>{
    expect(periciaSuperada(['Cancelo a perícia agendada para 01/09/2026.'],'2026-09-01','medica',1)).toBe(true);
    expect(periciaSuperada(['A perícia foi cancelada.'],'2026-09-01','medica',1)).toBe(true);
  });
  it('redesignação explícita substitui a data antiga, mas mero pedido não',()=>{
    expect(periciaSuperada(['Redesigno a perícia para 10/12/2026.'],'2026-09-01','medica',1)).toBe(true);
    expect(periciaSuperada(['A autora requereu a redesignação da perícia.'],'2026-09-01','medica',1)).toBe(false);
  });
  it('não encerra outra data ou outra espécie de perícia',()=>{
    expect(periciaSuperada(['Cancelo a perícia marcada para 02/09/2026.'],'2026-09-01','medica',1)).toBe(false);
    expect(periciaSuperada(['Cancelo a perícia social.'],'2026-09-01','medica',1)).toBe(false);
    expect(periciaSuperada(['Cancelo a perícia social e mantenho a perícia médica.'],'2026-09-01','medica',1)).toBe(false);
    expect(periciaSuperada(['A perícia foi cancelada.'],'2026-09-01','medica',2)).toBe(false);
    expect(periciaSuperada(['Cancelo a perícia marcada para 01/09/2026.'],'2026-09-01','medica',2)).toBe(true);
  });
});
