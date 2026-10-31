import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/db';
import { coberturaHistorico, invalidarHistorico, solicitarHistorico } from '../src/services/djen/historyCoverage';
import { atualizarHistoricoProcesso, pararMonitorHistoricos } from '../src/services/djen/processHistory';
import { importarPublicacoes, salvarAdvogado } from '../src/services/djen/store';
import { normalizarPublicacao, hojeDjen, somarDias, type ContextoConsulta } from '../src/services/djen/api';
import { listarObrigacoesExternas, atualizarObrigacaoExterna } from '../src/services/djen/externalFollowUp';
import { periodosAutomaticos } from '../src/services/djen/captureWindows';
const processo='50007075020264036304', outro='50009722520264036313';
const antiga=()=>somarDias(hojeDjen(),-45);
let serial=0;
const raw=(id:string, texto='Intime-se o perito para apresentar o laudo em 5 dias.', data=antiga(), numero=processo, oab='123456')=>({id,numero_processo:numero,data_disponibilizacao:data,siglaTribunal:'TRF3',nomeOrgao:'Jundiai',nomeClasse:'Procedimento comum',tipoDocumento:'Despacho',tipoComunicacao:'Intimação',texto,hash:'hash-'+id,destinatarios:[],destinatarioadvogados:[{advogado:{nome:'Advogado teste',numero_oab:oab,uf_oab:'SP'}}]});
const response=(items:unknown[],count=items.length,status=200)=>new Response(JSON.stringify({count,items}),{status,headers:{'Content-Type':'application/json'}});
const ctx=():ContextoConsulta=>({requests:0,pause:async()=>{}});
function seed() {
  const advogado=salvarAdvogado({nome:'ADVOGADO TESTE',numero_oab:'123456',uf_oab:'SP',modo_busca:'ambos'});
  const id='history-'+(++serial);
  const original=raw(id);
  importarPublicacoes([normalizarPublicacao(original)],advogado,'oab');
  const p=db.prepare('SELECT id,captured_at FROM djen_publicacoes WHERE comunicacao_id=?').get(id) as {id:number;captured_at:string};
  return {advogado,id,original,p};
}
beforeEach(()=>{
  db.exec('DELETE FROM djen_historico_consultas; DELETE FROM djen_publicacao_advogados; DELETE FROM djen_publicacoes; DELETE FROM djen_processos; DELETE FROM djen_advogados; DELETE FROM pericias_agendadas; UPDATE djen_config SET aguardo_dias=30,ia_ativa=0');
});
afterEach(()=>{vi.unstubAllGlobals();pararMonitorHistoricos()});
describe('captura recente antes da recuperação antiga',()=>{
  it('consulta primeiro os últimos dias mesmo com cursor antigo e preserva o lote histórico',()=>{
    expect(periodosAutomaticos('2026-01-01','2026-01-31','2026-10-31',7)).toEqual([{inicio:'2026-10-25',fim:'2026-10-31'},{inicio:'2026-01-01',fim:'2026-01-31'}]);
  });
  it('não duplica intervalos quando o cursor já está atualizado',()=>{
    expect(periodosAutomaticos('2026-10-28','2026-10-31','2026-10-31',7)).toEqual([{inicio:'2026-10-25',fim:'2026-10-31'}]);
  });
  it('recupera a lacuna anterior sem repetir os dias recentes',()=>{
    expect(periodosAutomaticos('2026-10-15','2026-10-31','2026-10-31',7)).toEqual([{inicio:'2026-10-25',fim:'2026-10-31'},{inicio:'2026-10-15',fim:'2026-10-24'}]);
  });
});
describe('histórico posterior por processo',()=>{
  it('não confunde captura de hoje com disponibilização antiga',()=>{
    const {p}=seed();
    expect(coberturaHistorico(processo).status).toBe('pendente');
    const publicada=db.prepare('SELECT data_disponibilizacao,captured_at FROM djen_publicacoes WHERE id=?').get(p.id) as {data_disponibilizacao:string;captured_at:string};
    expect(publicada.data_disponibilizacao).toBe(antiga()); expect(publicada.captured_at).toBe(p.captured_at);
  });
  it('busca até hoje sem filtro de advogado e usa cumprimento dirigido a outro destinatário',async()=>{
    const {original,p}=seed();
    const f=vi.fn().mockResolvedValue(response([original,raw('later','Laudo pericial juntado aos autos.',somarDias(hojeDjen(),-5),processo,'888888')]));
    vi.stubGlobal('fetch',f);
    await atualizarHistoricoProcesso(processo,ctx());
    const u=new URL(f.mock.calls[0][0]);
    expect(u.searchParams.get('numeroProcesso')).toBe(processo);expect(u.searchParams.has('numeroOab')).toBe(false);expect(u.searchParams.has('nomeAdvogado')).toBe(false);
    expect(u.searchParams.get('dataDisponibilizacaoFim')).toBe(hojeDjen());
    expect(coberturaHistorico(processo)).toMatchObject({status:'atualizado',inicio:antiga(),fim:hojeDjen()});
    expect(listarObrigacoesExternas()).toHaveLength(0);
    expect(db.prepare('SELECT captured_at FROM djen_publicacoes WHERE id=?').get(p.id)).toMatchObject({captured_at:p.captured_at});
  });
  it('sentença posterior encerra instrução antiga sem inventar juntada de laudo',async()=>{
    const {original}=seed();vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response([original,raw('sentenca','Homologo o pedido de desistência e julgo extinto o processo sem resolução de mérito.',somarDias(hojeDjen(),-4))])));
    await atualizarHistoricoProcesso(processo,ctx());
    expect(listarObrigacoesExternas()).toHaveLength(0);expect(coberturaHistorico(processo).status).toBe('atualizado');
  });
  it('recusa resultado de outro processo, inclusive HTTP 200',async()=>{
    seed();vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response([raw('wrong','Laudo juntado.',antiga(),outro)])));
    await expect(atualizarHistoricoProcesso(processo,ctx())).rejects.toThrow('fora dos filtros');
    expect(coberturaHistorico(processo).status).toBe('falha');expect(db.prepare("SELECT id FROM djen_publicacoes WHERE comunicacao_id='wrong'").get()).toBeUndefined();
  });
  it('resultado vazio não confirma histórico de publicação já conhecida',async()=>{
    seed();vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response([])));
    await expect(atualizarHistoricoProcesso(processo,ctx())).rejects.toThrow('não reencontrou');expect(coberturaHistorico(processo).status).toBe('falha');
  });
  it('não libera alerta atual se a paginação ficar incompleta, preservando dados recebidos',async()=>{
    const {original}=seed();vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(response([original],2)).mockResolvedValueOnce(response([],2)));
    await expect(atualizarHistoricoProcesso(processo,ctx())).rejects.toThrow();expect(coberturaHistorico(processo).status).toBe('falha');
    expect(db.prepare('SELECT COUNT(*) AS n FROM djen_publicacoes').get()).toMatchObject({n:1});
  });
  it('falha HTTP não é registrada como sucesso',async()=>{
    seed();vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response([],0,403)));
    await expect(atualizarHistoricoProcesso(processo,ctx())).rejects.toThrow();expect(coberturaHistorico(processo).status).toBe('falha');
  });
  it('uma captura concorrente invalida o resultado em execução',async()=>{
    const {original}=seed();vi.stubGlobal('fetch',vi.fn().mockImplementation(async()=>{invalidarHistorico(processo);return response([original])}));
    await atualizarHistoricoProcesso(processo,ctx());expect(coberturaHistorico(processo).status).toBe('pendente');
  });
  it('recaptura idêntica preserva consulta; cobertura expirada exige atualização',async()=>{
    const {original,advogado}=seed();vi.stubGlobal('fetch',vi.fn().mockImplementation(async()=>response([original])));
    await atualizarHistoricoProcesso(processo,ctx());importarPublicacoes([normalizarPublicacao(original)],advogado,'oab');
    expect(coberturaHistorico(processo).status).toBe('atualizado');
    db.prepare("UPDATE djen_historico_consultas SET consultado_em=datetime('now','-7 hours')").run();expect(coberturaHistorico(processo).status).toBe('pendente');
  });
  it('nova publicação ou correção exige nova conferência',async()=>{
    const {original,advogado}=seed();vi.stubGlobal('fetch',vi.fn().mockImplementation(async()=>response([original])));await atualizarHistoricoProcesso(processo,ctx());
    importarPublicacoes([normalizarPublicacao({...original,texto:'Intime-se o perito para apresentar o laudo em 10 dias.'})],advogado,'oab');expect(coberturaHistorico(processo).status).toBe('pendente');
  });
  it('cumprimento manual tem data e observação e não reaparece na recaptura',async()=>{
    const {original,p}=seed();vi.stubGlobal('fetch',vi.fn().mockImplementation(async()=>response([original])));await atualizarHistoricoProcesso(processo,ctx());
    atualizarObrigacaoExterna(p.id,'perito_laudo','resolvido',{cumprido_em:hojeDjen(),observacoes:'Laudo conferido no evento 45 dos autos.'});
    const h=db.prepare("SELECT dados_json FROM djen_historico WHERE publicacao_id=? AND tipo='providencia' ORDER BY id DESC LIMIT 1").get(p.id) as {dados_json:string};
    expect(JSON.parse(h.dados_json)).toMatchObject({cumprido_em:hojeDjen(),observacoes:'Laudo conferido no evento 45 dos autos.'});
    await atualizarHistoricoProcesso(processo,ctx());expect(listarObrigacoesExternas()).toHaveLength(0);
  });
  it('não reabre repetição histórica já cumprida, mas mantém ordem posterior ao cumprimento',async()=>{
    const {original,p}=seed();
    atualizarObrigacaoExterna(p.id,'perito_laudo','resolvido',{cumprido_em:somarDias(hojeDjen(),-10),observacoes:'Laudo conferido nos autos.'});
    const repetida=raw('repetida',original.texto,somarDias(hojeDjen(),-20));
    vi.stubGlobal('fetch',vi.fn().mockImplementation(async()=>response([original,repetida])));
    await atualizarHistoricoProcesso(processo,ctx());expect(listarObrigacoesExternas()).toHaveLength(0);
    const nova=raw('nova-ordem',original.texto,somarDias(hojeDjen(),-5));
    vi.stubGlobal('fetch',vi.fn().mockImplementation(async()=>response([original,repetida,nova])));
    await atualizarHistoricoProcesso(processo,ctx());expect(listarObrigacoesExternas()).toHaveLength(1);
  });
  it('data futura ou nota vazia não encerram a obrigação',()=>{
    const {p}=seed();expect(()=>atualizarObrigacaoExterna(p.id,'perito_laudo','resolvido',{cumprido_em:somarDias(hojeDjen(),1),observacoes:'Conferido'})).toThrow();
    expect(()=>atualizarObrigacaoExterna(p.id,'perito_laudo','resolvido',{cumprido_em:hojeDjen(),observacoes:''})).toThrow();
    expect(db.prepare('SELECT status FROM djen_acompanhamentos_obrigacoes WHERE publicacao_id=?').get(p.id)).toBeUndefined();
  });
  it('valida número de processo antes de enfileirar uma consulta',()=>{expect(()=>solicitarHistorico('processo-invalido')).toThrow()});
});
