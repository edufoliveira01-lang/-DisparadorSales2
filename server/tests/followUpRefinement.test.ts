import { describe, expect, it, vi } from 'vitest';
import { faseDaInstrucao, instrucaoSuperada, laudoEfetivamenteJuntado } from '../src/services/djen/followUpPolicy';
import { identificarObrigacoesExternas, cumprimentoIdentificado } from '../src/services/djen/obligations';
vi.mock('../src/db', () => ({ db: { prepare: vi.fn() } }));
import { medirInatividade } from '../src/services/djen/activity';

const extincao = 'Assim, HOMOLOGO O PEDIDO DE DESISTÊNCIA DA AÇÃO E JULGO EXTINTO O PROCESSO SEM RESOLUÇÃO DE MÉRITO, com fundamento no artigo 485, inciso VIII, do Código de Processo Civil.';
describe('histórico literal de instrução e laudo', () => {
  it('suprime alerta obsoleto no caso 5000707-50.2026.4.03.6304 sem inventar laudo', () => {
    expect(instrucaoSuperada([extincao])).toBe(true);
    expect(laudoEfetivamenteJuntado(extincao)).toBe(false);
  });
  it.each(['Julgo improcedente o pedido.', 'Julgo a ação parcialmente procedente.', 'Declaro a extinção do feito.', 'Homologo o acordo.'])('reconhece ato atual: %s', texto => expect(faseDaInstrucao(texto)).toBe('encerrada'));
  it.each(['Caso haja desistência, julgo extinto o processo.', 'Conforme precedente: “julgo improcedente o pedido”.', 'A autora requereu: julgo extinto o processo.', 'Não julgo extinto o processo.', 'Na sentença anterior, julgo improcedente o pedido.'])('não encerra por hipótese, citação, pedido ou negação: %s', texto => expect(faseDaInstrucao(texto)).toBe(null));
  it('ato novo de reabertura prevalece sobre sentença antiga', () => {
    expect(instrucaoSuperada(['Anulo a sentença. Reabro a instrução.', extincao])).toBe(false);
    expect(instrucaoSuperada([extincao, 'Anulo a sentença.'])).toBe(true);
  });
  it.each(['Laudo pericial juntado aos autos.', 'O perito apresentou o laudo.', 'Intimem-se as partes para manifestação sobre o laudo já juntado.'])('exige prova de juntada: %s', texto => expect(laudoEfetivamenteJuntado(texto)).toBe(true));
  it.each(['Intime-se o perito para apresentação do laudo em 15 dias.', 'O laudo não foi juntado.', 'Sem laudo juntado.', 'Após a juntada do laudo, intimem-se.', 'Caso o laudo seja juntado, dê-se vista.', 'Conforme precedente: “laudo juntado”.'])('não inventa juntada: %s', texto => expect(laudoEfetivamenteJuntado(texto)).toBe(false));
});
describe('ordens e cumprimento', () => {
  it('contrarrazões condicionadas a recurso futuro não são obrigação atual', () => {
    expect(identificarObrigacoesExternas('Interposto recurso, intime-se a parte contrária para contrarrazões no prazo legal.')).toEqual([]);
  });
  it('preserva prazo explícito inferior a 30 dias e sua unidade', () => {
    const ordem = identificarObrigacoesExternas('Intime-se o perito para apresentar o laudo no prazo de 5 dias úteis.')[0];
    expect(ordem).toMatchObject({ tipo: 'perito_laudo', prazo_citado_dias: 5, unidade: 'uteis' });
  });
  it('contrarrazões efetivamente apresentadas encerram sua ordem, mas mera publicação não', () => {
    expect(cumprimentoIdentificado('parte_contraria','Contrarrazões apresentadas pela parte ré.', 'Apresentar contrarrazões')).toBe(true);
    expect(cumprimentoIdentificado('parte_contraria','Intime-se a parte ré para apresentar contrarrazões.', 'Apresentar contrarrazões')).toBe(false);
  });
});
describe('dias sem providência', () => {
  it.each([[14,'verde'],[15,'amarelo'],[29,'amarelo'],[30,'vermelho'],[31,'vermelho']])('limite %s: %s', (dias, nivel) => {
    const agora = new Date(Date.UTC(2026, 9, 1 + Number(dias), 15));
    expect(medirInatividade('2026-10-01 15:00:00',null,agora)).toMatchObject({ dias, nivel });
  });
  it('providência mais recente reinicia; ação anterior à criação não envelhece o card', () => {
    expect(medirInatividade('2026-10-01 15:00:00','2026-10-30 15:00:00',new Date('2026-10-31T15:00:00Z'))?.dias).toBe(1);
    expect(medirInatividade('2026-10-30 15:00:00','2026-10-01 15:00:00',new Date('2026-10-31T15:00:00Z'))?.dias).toBe(1);
  });
  it('conta datas de São Paulo, não horas nem UTC', () => {
    expect(medirInatividade('2026-10-31 01:00:00',null,new Date('2026-10-31T03:05:00Z'))?.dias).toBe(1);
  });
});
