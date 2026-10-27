/* Read-only probe of the Chromium already owned by this server.
 * Never print DevTools endpoints, QR contents, account data, storage or messages. */
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const app = process.argv[2] || path.resolve(__dirname, '../..');
const localRequire = createRequire(path.join(app, 'server/package.json'));
const puppeteer = localRequire('puppeteer');
const { Client, LocalAuth } = localRequire('whatsapp-web.js');
console.log('[WhatsApp:diagnostic] ' + JSON.stringify({ library: {
  boundedAuthWait: Client.prototype.inject.toString().includes('needAuthHandle'),
  cancelsOldInjection: Client.prototype.inject.toString().includes('_injectAbort'),
  currentMessageIds: Client.prototype.attachEventListeners.toString().includes('sender.$1'),
} }));
const deadline = (promise, ms) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('diagnostic_timeout')), ms);
  })]).finally(() => clearTimeout(timer));
};
async function inspectPage(page) {
  return deadline(page.evaluate(() => {
      const getModule = name => { try { return typeof window.require === 'function' ? window.require(name) : null; } catch { return null; } };
      const socket = getModule('WAWebSocketModel')?.Socket;
      const knownStates = ['CONNECTED', 'OPENING', 'UNLAUNCHED', 'PAIRING', 'UNPAIRED', 'UNPAIRED_IDLE', 'CONFLICT', 'TIMEOUT', 'DEPRECATED_VERSION', 'TOS_BLOCK', 'PROXYBLOCK'];
      return {
        readyState: document.readyState,
        unsupportedBrowser: /WhatsApp works with|WhatsApp funciona com|update.*Chrome|atualize.*Chrome/i.test(document.body?.innerText || ''),
        debugAvailable: typeof window.Debug !== 'undefined',
        version: typeof window.Debug?.VERSION === 'string' ? window.Debug.VERSION.replace(/[^0-9.]/g, '').slice(0,50) : null,
        requireAvailable: typeof window.require === 'function',
        socketState: knownStates.includes(socket?.state) ? socket.state : null,
        hasSynced: socket?.hasSynced === true,
        qrElementPresent: !!document.querySelector('[data-ref]'),
        qrCallbackPresent: typeof window.onQRChangedEvent === 'function',
        syncCallbackPresent: typeof window.onAppStateHasSyncedEvent === 'function',
        bridgePresent: typeof window.WWebJS !== 'undefined',
        signalModule: !!getModule('WAWebSignalStoreApi'),
        noiseModule: !!getModule('WAWebUserPrefsInfoStore'),
        connectionModule: !!getModule('WAWebConnModel'),
      };
    }), 8000);
}
async function probe() {
  const portFile = path.join(app, 'server/data/wwebjs_auth/session/DevToolsActivePort');
  if (!fs.existsSync(portFile)) {
    console.log('[WhatsApp:diagnostic] ' + JSON.stringify({ browser: 'not_running' }));
    return;
  }
  const port = Number(fs.readFileSync(portFile, 'utf8').split('\n')[0]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid_debug_port');
  const browser = await deadline(puppeteer.connect({ browserURL: `http://127.0.0.1:${port}`, protocolTimeout: 8000 }), 10000);
  try {
    const pages = await deadline(browser.pages(), 8000);
    const page = pages.find(p => { try { return new URL(p.url()).hostname === 'web.whatsapp.com'; } catch { return false; } });
    if (!page) { console.log('[WhatsApp:diagnostic] ' + JSON.stringify({ browser: 'no_whatsapp_page' })); return; }
    const state = await inspectPage(page);
    console.log('[WhatsApp:diagnostic] ' + JSON.stringify(state));
  } finally {
    // disconnect detaches this diagnostic client; never close the managed Chromium.
    browser.disconnect();
  }
}
function reportError(error) {
  const message = String(error?.message || error);
  const code = /timeout|timed out/i.test(message) ? 'timeout' : /ECONNREFUSED/.test(message) ? 'browser_not_listening' : 'unavailable';
  console.log('[WhatsApp:diagnostic] ' + JSON.stringify({ error: code, type: error?.name || 'Error', cause: /^[A-Z_]+$/.test(error?.cause?.code || '') ? error.cause.code : null }));
}
async function freshProbe() {
  const os = require('node:os');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'disparazap-qr-check-'));
  const auth = new LocalAuth({ dataPath: directory });
  const client = new Client({ authStrategy: auth, webVersionCache: { type: 'none' }, authTimeoutMs: 40000,
    puppeteer: { headless: true, protocolTimeout: 45000, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] } });
  auth.afterBrowserInitialized = async () => {
    const page = client.pupPage;
    const goto = page.goto.bind(page);
    page.goto = (url, options) => goto(url, { ...options, waitUntil: 'domcontentloaded', timeout: 35000 });
  };
  let finish;
  const outcome = new Promise(resolve => { finish = resolve; });
  client.on('qr', () => finish('qr_generated'));
  client.on('auth_failure', () => finish('auth_failure'));
  void client.initialize().catch(() => finish('initialization_error'));
  try {
    console.log('[WhatsApp:diagnostic] ' + JSON.stringify({ freshProfile: await deadline(outcome, 55000) }));
  } catch (error) {
    reportError(error);
    try { console.log('[WhatsApp:diagnostic] ' + JSON.stringify({ freshState: await inspectPage(client.pupPage) })); } catch {}
  }
  finally {
    try { await deadline(client.destroy(), 5000); }
    catch { try { client.pupBrowser?.process()?.kill('SIGKILL'); } catch {} }
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
probe().catch(reportError).then(() => process.argv.includes('--fresh') ? freshProbe() : undefined).catch(reportError);
