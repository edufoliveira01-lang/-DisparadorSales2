import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/db';
import { deleteSetting, setSetting } from '../src/services/settingsService';
import { buildGoogleEvent, DEFAULT_GOOGLE_CALENDAR_CONFIG, findExistingEvent, saveGoogleCalendarConfig,
  syncAllGoogleCalendar, syncGoogleCalendarPericia, type GoogleCalendarDestinationConfig } from '../src/services/googleCalendarService';
import type { PericiaAgendada } from '../src/services/periciasAgendadasService';
const id = 999_981;
const p = { id, card_id:'manual:google-regression', tipo:'Perícia médica', origem:'medica', nome:'CLIENTE TESTE',
  telefone:'(13) 99999-1234', telefone_digits:'5513999991234', processo:'0000000-00.2099.0.00.0000',
  data:'02/12/2099',horario:'15:00',local:'Clínica',whatsapp:null,profissional_perito:null,
  data_hora_ms:Date.parse('2099-12-02T18:00:00Z'),status:'ativa',substituida_por_id:null,fonte:'whatsapp',
  ultimo_lembrete_em:null,ultimo_lembrete_log_id:null,lembrete_ack:null,created_at:new Date().toISOString() } as PericiaAgendada;
function insert(override: Partial<PericiaAgendada> = {}) {
  db.prepare(`INSERT INTO pericias_agendadas
    (id,card_id,tipo,tipo_chave,origem,nome,nome_chave,telefone,telefone_digits,processo,processo_chave,data,horario,local,data_hora_ms,status)
    VALUES (@id,@card_id,@tipo,'pericia medica',@origem,@nome,'cliente',@telefone,@telefone_digits,@processo,'processo',@data,@horario,@local,@data_hora_ms,@status)`).run({...p,...override});
}
function dest(overrides: Partial<GoogleCalendarDestinationConfig> = {}): GoogleCalendarDestinationConfig {
  return {...DEFAULT_GOOGLE_CALENDAR_CONFIG.destinations[0],enabled:true,calendarId:'agenda-periodo',calendarName:'PERÍCIA MÉDICA ADM E JUDICIAL',eventMode:'reuse_manual',...overrides};
}
function original(d = dest(), overrides = {}) {
  return {...buildGoogleEvent(p,d),id:'evento-original',extendedProperties:{private:{disparazapId:'999989',disparazapDestination:String(d.destination)}},...overrides};
}
function setup(destinations = [dest()]) { saveGoogleCalendarConfig({syncEnabled:true,destinations}); }
function generated(d = dest()) { return crypto.createHash('sha256').update(`${d.calendarId}:${id}:${d.destination}`).digest('hex').slice(0,48); }
function link(eventId: string, periciaId = id) { db.prepare('INSERT INTO google_calendar_event_links (pericia_id,destination,calendar_id,google_event_id) VALUES (?,?,?,?)').run(periciaId,1,dest().calendarId,eventId); }
function mockGoogle(events: Record<string, any[]>, failPatch = false) {
  const calls: Array<{method:string;calendar:string;eventId?:string}> = [];
  vi.stubGlobal('fetch',vi.fn(async (input: string,init:RequestInit = {})=>{
    const url = new URL(String(input));
    if(url.hostname==='oauth2.googleapis.com') return Response.json({access_token:'token-teste',expires_in:3600});
    const match = url.pathname.match(/\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/);
    if(!match) throw new Error('Requisição inesperada');
    const calendar=decodeURIComponent(match[1]), eventId=match[2], method=init.method || 'GET';
    calls.push({method,calendar,eventId});
    if(method==='GET') return Response.json(eventId ? (events[calendar] || []).find(e=>e.id===eventId) || {id:eventId} : {items:events[calendar] || []});
    if(method==='PATCH') return failPatch ? Response.json({error:{message:'Indisponível'}},{status:503}) : Response.json({...JSON.parse(String(init.body)),id:eventId});
    if(method==='DELETE') return new Response(null,{status:204});
    throw new Error('Não deve criar evento');
  }));
  return calls;
}
beforeEach(()=>{
  db.prepare('DELETE FROM google_calendar_event_links').run();db.prepare('DELETE FROM pericias_agendadas').run();insert();
  vi.stubEnv('GOOGLE_CLIENT_ID','cliente-teste');vi.stubEnv('GOOGLE_CLIENT_SECRET','segredo-teste');vi.stubEnv('ENCRYPTION_KEY','chave-testes');
  setSetting('google_refresh_token','refresh-teste');
});
afterEach(()=>{deleteSetting('google_refresh_token');vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe('reconciliação de eventos existentes',()=>{
  it('reutiliza as duas agendas e atualiza os mesmos IDs na segunda sincronização',async()=>{
    const d1=dest(),d2=dest({destination:2,calendarId:'agenda-pericias',calendarName:'PERÍCIAS',timingMode:'fixed_time'});setup([d1,d2]);
    insert({id:999989,card_id:'manual:antigo',status:'substituida',data:'01/12/2099',data_hora_ms:p.data_hora_ms-86400000});
    const calls=mockGoogle({[d1.calendarId]:[original(d1)],[d2.calendarId]:[original(d2,{id:'evento-23h'})]});
    expect(await syncGoogleCalendarPericia(id)).toMatchObject({linked:2,created:0,conflicts:0,errors:0});
    expect(await syncGoogleCalendarPericia(id)).toMatchObject({updated:2,created:0,errors:0});
    expect(calls.filter(c=>c.method==='PATCH').map(c=>c.eventId)).toEqual(['evento-original','evento-23h','evento-original','evento-23h']);
    expect(calls.some(c=>c.method==='DELETE' || c.method==='POST')).toBe(false);
  });
  it.each(['automática','completa'])('repara cópia determinística na sincronização %s',async mode=>{
    const d=dest();setup();link(generated());
    const calls=mockGoogle({[d.calendarId]:[{...buildGoogleEvent(p,d),id:generated()},original()]});
    expect(await(mode==='automática'?syncGoogleCalendarPericia(id):syncAllGoogleCalendar())).toMatchObject({linked:1,created:0,errors:0});
    expect(calls.filter(c=>c.method!=='GET')).toEqual([{method:'PATCH',calendar:d.calendarId,eventId:'evento-original'},{method:'DELETE',calendar:d.calendarId,eventId:generated()}]);
    expect(db.prepare('SELECT google_event_id FROM google_calendar_event_links WHERE pericia_id = ?').get(id)).toEqual({google_event_id:'evento-original'});
  });
  it('sinaliza dois originais possíveis sem criar ou excluir',async()=>{
    setup();const calls=mockGoogle({[dest().calendarId]:[original(),original(dest(),{id:'outro-original'})]});
    expect(await syncGoogleCalendarPericia(id)).toMatchObject({conflicts:1,created:0,linked:0});expect(calls.every(c=>c.method==='GET')).toBe(true);
  });
  it('não toma metadados de outro compromisso ativo',()=>{
    insert({id:999989,card_id:'manual:outro-ativo',data:'01/12/2099',data_hora_ms:p.data_hora_ms-86400000});expect(findExistingEvent(p,dest(),[original()],new Set()).event).toBeNull();
  });
  it('protege vínculo ativo mesmo sem metadados remotos',()=>{
    insert({id:999989,card_id:'manual:outro-ativo',data:'01/12/2099',data_hora_ms:p.data_hora_ms-86400000});link('evento-original',999989);
    expect(findExistingEvent(p,dest(),[original(dest(),{extendedProperties:undefined})],new Set()).event).toBeNull();
  });
  it('recupera o mesmo compromisso após reconfiguração do destino',()=>{
    const d=dest({destination:3}),event=original(d,{extendedProperties:{private:{disparazapId:String(id),disparazapDestination:'1'}}});
    expect(findExistingEvent(p,d,[event],new Set()).event).toEqual(event);
  });
  it('exige tipo e data para recuperar metadados antigos',()=>{
    const event=original(dest(),{summary:'Audiência - CLIENTE TESTE - 0000000-00.2099.0.00.0000',description:'',start:{date:'2099-11-28'},end:{date:'2099-11-29'}});
    expect(findExistingEvent(p,dest(),[event],new Set()).event).toBeNull();
  });
  it('mantém a cópia quando a atualização do original falha',async()=>{
    setup();link(generated());const calls=mockGoogle({[dest().calendarId]:[original()]},true);
    expect(await syncGoogleCalendarPericia(id)).toMatchObject({errors:1,created:0});expect(calls.some(c=>c.method==='DELETE')).toBe(false);
  });
});
