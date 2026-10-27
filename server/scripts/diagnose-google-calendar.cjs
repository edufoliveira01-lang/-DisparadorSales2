// Sonda somente leitura: não altera SQLite nem eventos e não registra dados pessoais/tokens.
const path = require('node:path');
const crypto = require('node:crypto');
const app = path.resolve(process.argv[2] || path.join(__dirname, '../..'));
const fromServer = (name) => require(require.resolve(name, { paths: [path.join(app, 'server')] }));
const fs = require('node:fs');
const envFile = [path.join(app, '.env'), path.join(app, 'server/.env')].find(f => fs.existsSync(f));
if (envFile) fromServer('dotenv').config({ path: envFile, quiet: true });
const Database = fromServer('better-sqlite3');
let runtime = {};
try {
  const { execFileSync } = require('node:child_process');
  runtime = JSON.parse(execFileSync('pm2', ['jlist'], { encoding:'utf8', stdio:['ignore','pipe','ignore'], timeout:10000 }))
    .find(p => p.name === 'disparador-backend')?.pm2_env || {};
} catch { /* A sonda também pode ser executada fora do PM2. */ }
const cwd = runtime.pm_cwd || path.join(app, 'server');
const configuredData = runtime.DATA_DIR || process.env.DATA_DIR;
const dataDirectory = configuredData ? path.resolve(cwd, configuredData) : path.join(app, 'server/data');
let db;
const setting = (key) => db.prepare('SELECT valor FROM settings WHERE chave = ?').get(key)?.valor;
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function decrypt(value, secret) {
  const raw = Buffer.from(value, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', crypto.createHash('sha256').update(secret).digest(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}
async function main() {
  db = new Database(path.join(dataDirectory, 'disparador.sqlite3'), { readonly: true, fileMustExist: true });
  const config = JSON.parse(setting('google_calendar_config') || '{}');
  const encrypted = setting('google_refresh_token');
  if (!encrypted) return console.log('[Google diagnóstico] conta não conectada');
  const legacy = 'chave-padrao-nao-segura-troque-no-env';
  let refresh;
  try { refresh = decrypt(encrypted, process.env.ENCRYPTION_KEY || legacy); }
  catch { refresh = decrypt(encrypted, legacy); }
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', signal: AbortSignal.timeout(15000),
    body: new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,refresh_token:refresh,grant_type:'refresh_token'})
  });
  if (!tokenResponse.ok) throw new Error('oauth_http_' + tokenResponse.status);
  const { access_token: token } = await tokenResponse.json();
  const today = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const rows = db.prepare("SELECT * FROM pericias_agendadas WHERE status = 'ativa'").all().filter(p => p.data.split('/').reverse().join('-') >= today);
  const start = new Date(today + 'T00:00:00Z'); start.setUTCDate(start.getUTCDate() - 7);
  for (const d of config.destinations || []) {
    if (!d.enabled || !d.calendarId) continue;
    const events = []; let pageToken = '';
    do {
      const params = new URLSearchParams({singleEvents:'true',showDeleted:'false',maxResults:'2500',timeMin:start.toISOString()});
      if (pageToken) params.set('pageToken', pageToken);
      const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(d.calendarId) + '/events?' + params, {headers:{Authorization:'Bearer ' + token}, signal:AbortSignal.timeout(20000)});
      if (!response.ok) throw new Error('calendar_http_' + response.status);
      const data = await response.json(); events.push(...(data.items || [])); pageToken = data.nextPageToken || '';
    } while (pageToken);
    const stats = {destination:d.destination,timing:d.timingMode,eventMode:d.eventMode,appointments:rows.length,events:events.length,exactTitles:0,manual:0,sameId:0,staleId:0,otherActiveId:0,wrongDestination:0,outsideWindow:0,duplicateTitles:0};
    const samples = [];
    for (const p of rows) {
      const values = {tipo:p.tipo,data:p.data,horario:p.horario,nome:p.nome,telefone:(p.telefone || '').replace(/\s*-\s*(?=\d{4}\s*$)/,' - '),processo:p.processo,local:p.local,whatsapp:p.whatsapp,profissional:p.profissional_perito};
      const title = norm((d.titleTemplate || '{tipo} - {data} - {horario} - {nome} - {telefone} - {processo}').replace(/\{(\w+)\}/g,(_,key)=>values[key] || ''));
      const matches = events.filter(e => norm(e.summary) === title);
      if (matches.length > 1) stats.duplicateTitles++;
      for (const e of matches) {
        stats.exactTitles++;
        const props = e.extendedProperties?.private || {};
        let category = 'manual';
        if (props.disparazapId) category = props.disparazapId === String(p.id) ? 'sameId' : db.prepare("SELECT 1 FROM pericias_agendadas WHERE id = ? AND status = 'ativa'").get(props.disparazapId) ? 'otherActiveId' : 'staleId';
        stats[category]++;
        const wrongDestination = !!props.disparazapDestination && props.disparazapDestination !== String(d.destination);
        if (wrongDestination) stats.wrongDestination++;
        const date = p.data.split('/').reverse().join('-');
        const eventStart = e.start?.date || e.start?.dateTime?.slice(0,10);
        const eventEnd = e.end?.date || e.end?.dateTime?.slice(0,10) || eventStart;
        const distance = (new Date(eventStart + 'T00:00:00Z') - new Date(date + 'T00:00:00Z')) / 86400000;
        const endDistance = (new Date(eventEnd + 'T00:00:00Z') - new Date(date + 'T00:00:00Z')) / 86400000;
        const outsideWindow = distance > 7 || endDistance < -7;
        if (outsideWindow) stats.outsideWindow++;
        if (samples.length < 12) samples.push({category,wrongDestination,allDay:!!e.start?.date,startDaysFromAppointment:distance,endDaysFromAppointment:endDistance});
      }
    }
    console.log('[Google diagnóstico]', JSON.stringify({stats,samples}));
  }
}
main().catch(e => { console.log('[Google diagnóstico] falhou', /^(oauth|calendar)_http_\d+$/.test(e.message) ? e.message : e.code || e.name); process.exitCode = 1; }).finally(()=>db?.close());
