import { config } from './config.js';
import { AccountStore, TABLES, parseCsvStream, selectTables } from './data.js';
import { ZipSource } from './zip.js';
import { loadPublished } from './published.js';

let store;
let active;
const progress = (text) => self.postMessage({ type: 'progress', text });

function officialArchive(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'cdn.tse.jus.br' || !url.pathname.endsWith('.zip')) throw new Error('O portal retornou uma URL de arquivo não reconhecida.');
  return url.href;
}
async function discover(scope, signal) {
  const base = config.relayUrl.replace(/\/$/, '');
  const url = base ? `${base}/resources` : `${config.api}?id=${config.dataset}`;
  let response;
  try { response = await fetch(url, { signal, cache: 'no-store', credentials: 'omit' }); }
  catch (error) {
    if (signal.aborted) throw error;
    throw new Error('Não foi possível consultar o portal do TSE. A conexão pode estar indisponível ou o navegador pode ter bloqueado o acesso entre sites. Você pode abrir o ZIP oficial baixado no portal. Para acesso automático quando há bloqueio, o responsável pelo site precisa configurar o relay descrito na documentação.');
  }
  if (!response.ok) throw new Error(`Portal de dados indisponível (HTTP ${response.status}). Tente novamente mais tarde.`);
  const json = await response.json();
  if (base) {
    const resource = json[scope];
    if (!resource?.url) throw new Error('O relay não encontrou o recurso solicitado.');
    return { source: officialArchive(resource.url), url: `${base}/archive?scope=${scope}` };
  }
  if (!json.success || !Array.isArray(json.result?.resources)) throw new Error('A resposta do portal de dados não foi reconhecida.');
  const resource = json.result.resources.find((r) => r.id === config.resourceIds[scope]);
  if (!resource?.url) throw new Error('O recurso selecionado não foi encontrado no catálogo oficial.');
  const source = officialArchive(resource.url);
  return { source, url: source };
}
async function load(message) {
  if (active) active.abort();
  const controller = new AbortController();
  active = controller;
  if (!message.file && config.mode === 'published') {
    try {
      progress('Carregando o índice da publicação atual…');
      const next = await loadPublished(message.scope, config.year, controller.signal);
      store = next;
      self.postMessage({ type: 'loaded', scope: message.scope, accounts: next.accounts.size, tables: next.metadata(), options: next.options(), loadedAt: next.loadedAt, publishedAt: next.publishedAt, source: next.source });
    } catch (error) { if (!controller.signal.aborted) self.postMessage({ type: 'error', message: error.message }); }
    finally { if (active === controller) active = undefined; }
    return;
  }
  const next = new AccountStore(message.scope, config.year);
  try {
    let zip;
    if (message.file) {
      next.source = `Arquivo local: ${message.file.name}`;
      progress('Lendo o diretório do ZIP selecionado…');
      zip = new ZipSource({ blob: message.file, signal: controller.signal, onProgress: progress });
    } else {
      progress('Consultando o catálogo oficial do TSE…');
      const resource = await discover(message.scope, controller.signal);
      next.source = resource.source;
      progress('Lendo o diretório do arquivo oficial…');
      zip = new ZipSource({ url: resource.url, signal: controller.signal, onProgress: progress });
    }
    const entries = selectTables(await zip.directory(), message.scope, config.year);
    for (const [kind, entry] of Object.entries(entries)) {
      if (controller.signal.aborted) throw new Error('Carregamento cancelado.');
      progress(`Lendo ${TABLES[kind].label.toLocaleLowerCase('pt-BR')}…`);
      await parseCsvStream(await zip.stream(entry), next.reader(kind, entry.name), (_bytes, rows) => {
        progress(`Lendo ${TABLES[kind].label.toLocaleLowerCase('pt-BR')}: ${rows.toLocaleString('pt-BR')} lançamentos processados.`);
      });
    }
    next.loadedAt = new Date().toISOString();
    store = next;
    self.postMessage({ type: 'loaded', scope: message.scope, accounts: next.accounts.size, tables: next.metadata(), options: next.options(), loadedAt: next.loadedAt, source: next.source });
  } catch (error) {
    if (!controller.signal.aborted) self.postMessage({ type: 'error', message: error.message || 'Não foi possível carregar a base.' });
  } finally { if (active === controller) active = undefined; }
}
self.addEventListener('message', async ({ data }) => {
  if (data.type === 'load') { await load(data); return; }
  if (data.type === 'cancel') { active?.abort(); self.postMessage({ type: 'cancelled' }); return; }
  try {
    if (!store) throw new Error('Carregue uma base antes de consultar.');
    let result;
    if (data.type === 'list') {
      const accounts = store.list(data.filters);
      result = { accounts: accounts.slice(data.page * 25, (data.page + 1) * 25), count: accounts.length };
    } else if (data.type === 'summary') result = await store.summary(data.id, data.statementId);
    else if (data.type === 'benchmark') result = await store.benchmark(data.id, data.statementId);
    else if (data.type === 'counterparties') result = await store.counterparties(data.id, data.statementId, data.filters, data.page);
    else if (data.type === 'transactions') result = await store.transactions(data.id, data.statementId, data.kind, data.page, 20, data.order);
    else throw new Error('Consulta não reconhecida.');
    self.postMessage({ type: 'response', requestId: data.requestId, result });
  } catch (error) { self.postMessage({ type: 'response', requestId: data.requestId, error: error.message }); }
});
