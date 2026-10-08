import { json } from './published.js';
import { config } from './config.js';
import { aggregateParties, chartValue } from './party-overview.js';
import { TABLES, alphabetic } from './data.js';
import { accountGroups, recordGroups, latestRecords, zoomFrame } from './chart-navigation.js';
import { layoutTreemap } from './treemap.js';
import { FlowView } from './flow-view.js';

const $ = (id) => document.getElementById(id);
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const percent = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 2 });
const shareLabel = (share) => share > 0 && share < .0001 ? '< 0,01%' : percent.format(share);
const number = (value) => value.toLocaleString('pt-BR');
const money = (cents) => cents === null ? 'Sem lançamentos' : brl.format(cents / 100);
const timestamp = (value) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(value)) + ' (Brasília)';
let data, result, accountIndexPromise;
const series = Object.entries(TABLES).map(([kind, definition]) => ({ kind, label: kind === 'receipts' ? 'Receitas declaradas' : definition.label }));
const mosaicStates = new Map();
let mosaicMetric = 'receipts', activeView = 'mosaic';
const partyColors = new Map();
const flowView = new FlowView($('flow-content'), partyColors);
const zoomCache = new WeakMap();
const canZoom = (entry) => entry.level !== 'leaf' && entry.hasZoom !== false && entry.cents > 0;
const node = (tag, text, className) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
function exact(value) {
  if (value.cents === null) return value.missing ? 'Não disponível: valores incompletos' : 'Sem lançamentos';
  return money(value.cents) + (value.missing ? ` · parcial (${number(value.missing)} registro(s) sem valor)` : '');
}
async function load() {
  $('reload').disabled = true; $('load-error').hidden = true;
  $('publication-date').textContent = 'Consultando a publicação atual…';
  try {
    const root = new URL('./data/', import.meta.url);
    const manifest = await json(new URL('manifest.json', root));
    if (manifest.version !== 1 || manifest.year !== config.year || !manifest.scopes?.parties) throw new Error('Publicação incompatível com esta página.');
    const next = await json(new URL('parties/overview.json.gz', root));
    if (next.version !== 1 || next.scope !== 'parties' || next.year !== config.year || !Array.isArray(next.accounts) || next.updatedAt !== manifest.scopes.parties.updatedAt) throw new Error('A publicação mudou durante a leitura. Recarregue para consultar uma versão completa.');
    data = next;
    accountIndexPromise = undefined;
    mosaicStates.clear();
    flowView.setData(data);
    $('publication-date').textContent = `Dados obtidos do TSE em ${timestamp(data.updatedAt)}`;
    render();
  } catch (error) {
    $('load-error').replaceChildren(node('p', `${error.message} Use “Atualizar” para tentar novamente.`)); $('load-error').hidden = false;
    $('publication-date').textContent = data ? `A atualização falhou. Continua visível a publicação de ${timestamp(data.updatedAt)}.` : 'Não foi possível carregar os dados.';
    if (!data) for (const id of ['mosaic-content', 'flow-content']) $(id).replaceChildren(node('p', 'Gráfico indisponível até o carregamento da fonte.', 'chart-placeholder'));
  } finally { $('reload').disabled = false; }
}
function render() {
  if (!data) return;
  result = aggregateParties(data);
  result.parties.forEach((party, index) => partyColors.set(party.party, `hsl(${(index * 137.508 + 164) % 360} 48% ${index % 2 ? 43 : 36}%)`));
  renderPartyLegend();
  if (activeView === 'mosaic') renderMosaic(); else flowView.render();
}
function colorAt(index) { return `hsl(${(index * 137.508 + 164) % 360} 48% ${index % 2 ? 43 : 36}%)`; }
function decorate(nodes, level) { return nodes.map((entry, index) => ({ ...entry, level, color: colorAt(index) })); }
async function accountIndex() {
  if (!accountIndexPromise) {
    accountIndexPromise = json(new URL('./data/parties/index.json', import.meta.url)).then((index) => {
      if (index.version !== 1 || index.scope !== 'parties' || index.year !== config.year || index.updatedAt !== data.updatedAt) throw new Error('A publicação mudou. Recarregue os dados antes de aprofundar a consulta.');
      return new Map(index.accounts.map((account) => [account.id, account]));
    }).catch((error) => { accountIndexPromise = undefined; throw error; });
  }
  return accountIndexPromise;
}
async function nextFrame(entry, item) {
  const title = entry.label;
  if (entry.level === 'party') return { title, dimension: 'Órgãos por esfera', nodes: decorate(accountGroups(entry.accounts, item.kind, 'sphere'), 'sphere') };
  if (entry.level === 'sphere') return { title, dimension: 'Órgãos por estado', nodes: decorate(accountGroups(entry.accounts, item.kind, 'uf'), 'uf') };
  if (entry.level === 'uf') {
    const index = await accountIndex();
    const nodes = accountGroups(entry.accounts, item.kind, 'id').map((group) => {
      const account = index.get(group.id);
      return { ...group, label: account ? `${account.locality || account.uf} · ${account.name} · ${account.prestador}` : group.id };
    }).sort((a, b) => alphabetic(a.label, b.label));
    return { title, dimension: 'Contas dos órgãos', nodes: decorate(nodes, 'account') };
  }
  if (entry.level === 'account') {
    const index = await accountIndex(); const account = index.get(entry.id);
    if (!account || !/^[A-Za-z0-9_-]+\.json\.gz$/.test(account.filename)) throw new Error('Conta indisponível na publicação.');
    const document = await json(new URL(`./data/parties/${account.filename}`, import.meta.url));
    if (document.version !== 1 || document.accountId !== entry.id || document.updatedAt !== data.updatedAt) throw new Error('A publicação mudou. Recarregue os dados antes de consultar esta conta.');
    const records = latestRecords(document, entry.accounts[0].statements[0], item.kind);
    const cents = records.reduce((sum, record) => sum + (record.cents ?? 0), 0);
    if (cents !== (entry.cents ?? 0) || records.length !== entry.count) throw new Error('Os lançamentos não correspondem ao resumo publicado. Recarregue os dados.');
    const receipts = item.kind === 'receipts';
    return { title, dimension: receipts ? 'Fontes dos recursos' : 'Categorias das despesas', nodes: decorate(recordGroups(records, receipts ? 'source' : 'origin'), receipts ? 'source' : 'origin') };
  }
  if (entry.level === 'source') return { title, dimension: 'Origens da verba', nodes: decorate(recordGroups(entry.records, 'origin'), 'origin') };
  if (entry.level === 'origin') return { title, dimension: item.kind === 'receipts' ? 'Remetentes declarados' : 'Fornecedores declarados', nodes: decorate(recordGroups(entry.records, 'counterparty'), 'leaf') };
  return null;
}
async function nextZoomFrame(entry, item) {
  if (!zoomCache.has(entry)) {
    zoomCache.set(entry, zoomFrame(entry, (part) => nextFrame(part, item)).catch((error) => { zoomCache.delete(entry); throw error; }));
  }
  const next = await zoomCache.get(entry);
  entry.hasZoom = Boolean(next);
  return next;
}
function markTerminal(container, attribute, entry) {
  container.querySelectorAll(`[${attribute}]`).forEach((control) => {
    if (control.getAttribute(attribute) !== entry.id) return;
    control.classList.add('is-terminal');
    const label = control.getAttribute('aria-label')?.replace('. Abrir detalhes', '');
    if (label) { control.setAttribute('aria-label', label); if (control.title) control.title = label; }
  });
}
function rootFrame(item) {
  return { title: 'Todos os partidos', dimension: 'Participação por partido', nodes: result.parties.map((party) => ({ id: party.party, label: party.party, level: 'party', accounts: data.accounts.filter((account) => account.party === party.party), color: partyColors.get(party.party), ...chartValue(party, item) })) };
}
function renderMosaic(focus = false) {
  if (!data || activeView !== 'mosaic') return;
  const item = series.find((entry) => entry.kind === mosaicMetric);
  let state = mosaicStates.get(item.kind);
  if (!state) { state = { frames: [rootFrame(item)], request: 0, loading: false, error: '' }; mosaicStates.set(item.kind, state); }
  const container = $('mosaic-content'); container.replaceChildren(); container.setAttribute('aria-busy', String(state.loading));
  const frame = state.frames.at(-1);
  const toolbar = node('div', undefined, 'mosaic-toolbar');
  const goBack = (index) => {
    state.request++; state.loading = false; state.error = ''; state.frames.splice(index + 1); renderMosaic(true);
  };
  const back = node('button', '←', 'mosaic-back'); back.type = 'button'; back.id = 'mosaic-back';
  back.disabled = state.frames.length === 1;
  const backLabel = state.frames.length > 1 ? `Voltar para ${state.frames.at(-2).title}` : 'Voltar um nível';
  back.setAttribute('aria-label', backLabel); back.title = backLabel;
  back.addEventListener('click', () => goBack(state.frames.length - 2)); toolbar.append(back);
  const trail = node('nav', undefined, 'mosaic-trail'); trail.setAttribute('aria-label', 'Caminho do mosaico');
  state.frames.forEach((ancestor, index) => {
    if (index) trail.append(node('span', '›', 'trail-separator'));
    if (index === state.frames.length - 1) { const current = node('span', ancestor.title); current.setAttribute('aria-current', 'location'); trail.append(current); }
    else {
      const back = node('button', ancestor.title); back.type = 'button';
      back.addEventListener('click', () => goBack(index)); trail.append(back);
    }
  }); toolbar.append(trail); container.append(toolbar);
  const map = node('div', undefined, 'mosaic-map'); map.tabIndex = -1; map.setAttribute('role', 'group'); map.setAttribute('aria-label', `${item.label}: ${frame.dimension}, ${frame.title}`); container.append(map);
  const layout = layoutTreemap(frame.nodes, map.clientWidth || 900, map.clientHeight || 520);
  const total = node('strong', !data.tables[item.kind] ? 'Não disponível' : frame.nodes.some((entry) => entry.cents !== null) ? money(layout.total) : 'Sem lançamentos', 'mosaic-total');
  total.setAttribute('aria-label', `Total de ${item.label}: ${total.textContent}`); toolbar.append(total);
  const detail = node('p', 'Passe o mouse ou toque em um bloco para consultar o valor.', 'mosaic-detail'); detail.setAttribute('role', 'status'); detail.setAttribute('aria-live', 'polite');
  const error = node('p', state.error, 'error'); error.hidden = !state.error; error.setAttribute('role', 'alert');
  const show = (entry) => {
    detail.replaceChildren(node('strong', entry.label), document.createTextNode(` · ${exact(entry)}${layout.status === 'ready' && entry.cents > 0 ? ` · ${shareLabel(entry.cents / layout.total)}` : ''}`));
    if (entry.accounts) detail.append(document.createTextNode(` · ${number(entry.accounts.length)} conta(s) de órgãos`));
    map.querySelectorAll('[data-tile-id]').forEach((tile) => tile.classList.toggle('is-active', tile.dataset.tileId === entry.id));
  };
  const advance = async (entry) => {
    const source = frame.nodes.find((part) => part.id === entry.id) || entry;
    if (state.loading || !canZoom(source)) { show(entry); return; }
    show(entry); state.error = ''; error.hidden = true; state.loading = true; container.setAttribute('aria-busy', 'true');
    const request = ++state.request;
    try {
      const next = await nextZoomFrame(source, item);
      if (request !== state.request || mosaicStates.get(item.kind) !== state) return;
      if (next) { state.frames.push(next); if (activeView === 'mosaic' && mosaicMetric === item.kind) renderMosaic(true); }
      else markTerminal(container, 'data-tile-id', source);
    } catch (failure) {
      if (request === state.request && mosaicStates.get(item.kind) === state) {
        state.error = `${failure.message} Clique novamente no bloco para tentar outra vez.`;
        if (activeView === 'mosaic' && mosaicMetric === item.kind) renderMosaic();
      }
    } finally {
      if (request === state.request) { state.loading = false; if (activeView === 'mosaic' && mosaicMetric === item.kind) container.setAttribute('aria-busy', 'false'); }
    }
  };
  state.show = show; state.advance = advance;
  if (layout.status === 'ready') for (const tile of layout.tiles) {
    const button = node('button', undefined, 'mosaic-tile'); button.type = 'button'; button.dataset.tileId = tile.id;
    Object.assign(button.style, { left: `${tile.x}px`, top: `${tile.y}px`, width: `${tile.width}px`, height: `${tile.height}px`, backgroundColor: tile.color });
    if (!canZoom(tile)) button.classList.add('is-terminal');
    const label = `${tile.label}: ${exact(tile)} · ${shareLabel(tile.share)}${canZoom(tile) ? '. Abrir detalhes' : ''}`;
    button.setAttribute('aria-label', label); button.title = label;
    const fitsName = tile.width >= 50 && tile.height >= 26;
    if (fitsName) {
      const name = node('strong', tile.label, 'mosaic-tile-name'); name.style.fontSize = `${Math.max(10, Math.min(36, Math.sqrt(tile.width * tile.height) / 8, tile.width / Math.max(3, tile.label.length) * 1.3))}px`;
      button.append(name);
      if (tile.width >= 120 && tile.height >= 75) button.append(node('span', money(tile.cents), 'mosaic-tile-value'));
      if (tile.width >= 65 && tile.height >= 100) button.append(node('span', shareLabel(tile.share), 'mosaic-tile-share'));
    }
    button.addEventListener('pointerenter', () => show(tile)); button.addEventListener('focus', () => show(tile)); button.addEventListener('click', () => advance(tile)); map.append(button);
  }
  else map.append(node('p', !data.tables[item.kind] ? 'Tabela não disponível na fonte.' : layout.status === 'negative' ? 'Há totais negativos neste nível. Selecione um item da legenda para consultar o valor.' : 'Nenhum valor positivo disponível para desenhar o mosaico.', 'mosaic-empty'));
  container.append(detail, error);
  const excluded = frame.nodes.filter((entry) => entry.cents === null || entry.cents === 0).length, missing = frame.nodes.reduce((sum, entry) => sum + entry.missing, 0);
  if (excluded || missing) container.append(node('p', [excluded ? `${number(excluded)} item(ns) sem área: valor zero ou sem lançamentos.` : '', missing ? `Soma parcial: ${number(missing)} registro(s) sem valor.` : ''].filter(Boolean).join(' '), 'mosaic-note'));
  if (state.frames.length > 1) {
    const legend = node('div', undefined, 'mosaic-legend'); legend.setAttribute('role', 'group'); legend.setAttribute('aria-label', `${frame.dimension}: valores e detalhes`);
    for (const entry of frame.nodes) {
      const button = node('button', undefined, 'chart-key'); button.type = 'button'; button.dataset.tileId = entry.id;
      const swatch = node('span', undefined, 'chart-swatch'); swatch.style.backgroundColor = entry.color; swatch.setAttribute('aria-hidden', 'true'); button.append(swatch, node('span', entry.label, 'chart-key-name'));
      button.setAttribute('aria-label', `${entry.label}: ${exact(entry)}${canZoom(entry) ? '. Abrir detalhes' : ''}`);
      button.addEventListener('pointerenter', () => show(entry)); button.addEventListener('focus', () => show(entry)); button.addEventListener('click', () => advance(entry)); legend.append(button);
    } container.append(legend);
  }
  if (focus) map.focus({ preventScroll: true });
}
function renderPartyLegend() {
  const legend = $('party-legend'); legend.replaceChildren();
  for (const party of result.parties) {
    const button = node('button', undefined, 'chart-key'); button.type = 'button';
    const swatch = node('span', undefined, 'chart-swatch'); swatch.style.backgroundColor = partyColors.get(party.party); swatch.setAttribute('aria-hidden', 'true');
    button.append(swatch, node('span', party.party)); button.dataset.party = party.party;
    button.setAttribute('aria-label', `Explorar ${party.party} no ${activeView === 'mosaic' ? 'mosaico' : 'fluxo'}`);
    const show = () => {
      $('chart-detail').textContent = `${party.party} · ${series.map((item) => `${item.label}: ${exact(chartValue(party, item))}`).join(' · ')}`;
      if (activeView === 'flow') { flowView.highlightParty?.(party.party); return; }
      const state = mosaicStates.get(mosaicMetric);
      if (state?.frames.length === 1) state.show(state.frames[0].nodes.find((entry) => entry.id === party.party));
    };
    button.addEventListener('pointerenter', show); button.addEventListener('focus', show);
    button.addEventListener('click', () => {
      if (activeView === 'flow') { flowView.selectParty(party.party); return; }
      const state = mosaicStates.get(mosaicMetric); if (!state) return;
      state.request++; state.loading = false; state.error = ''; state.frames.splice(1); renderMosaic();
      state.advance(state.frames[0].nodes.find((entry) => entry.id === party.party));
    }); legend.append(button);
  }
}
function setView(view) {
  activeView = view;
  for (const name of ['mosaic', 'flow']) {
    const button = $(`view-${name}`); button.setAttribute('aria-selected', String(name === view)); button.tabIndex = name === view ? 0 : -1;
    $(`${name}-view`).hidden = name !== view;
  }
  $('legend-hint').textContent = view === 'mosaic' ? 'Clique na sigla para explorar o partido, inclusive blocos pequenos e itens sem área.' : 'Clique na sigla para ver as origens e as despesas do partido.';
  $('party-legend').setAttribute('aria-label', `Partidos: explorar no ${view === 'mosaic' ? 'mosaico' : 'fluxo'}`);
  if (result) renderPartyLegend();
  if (view === 'mosaic') renderMosaic(); else flowView.render();
}
for (const view of ['mosaic', 'flow']) {
  $(`view-${view}`).addEventListener('click', () => setView(view));
  $(`view-${view}`).addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const next = event.key === 'Home' ? 'mosaic' : event.key === 'End' ? 'flow' : activeView === 'mosaic' ? 'flow' : 'mosaic'; setView(next); $(`view-${next}`).focus();
  });
}
for (const field of ['incoming', 'outgoing']) for (const button of $('flow-view').querySelectorAll(`[data-${field}]`)) button.addEventListener('click', () => {
  flowView[field] = button.dataset[field];
  for (const control of $('flow-view').querySelectorAll(`[data-${field}]`)) control.setAttribute('aria-pressed', String(control.dataset[field] === flowView[field]));
  flowView.render();
});
$('reload').addEventListener('click', load);
for (const button of $('mosaic-view').querySelectorAll('[data-metric]')) button.addEventListener('click', () => {
  mosaicMetric = button.dataset.metric;
  for (const control of $('mosaic-view').querySelectorAll('[data-metric]')) control.setAttribute('aria-pressed', String(control.dataset.metric === mosaicMetric));
  renderMosaic();
});
let mosaicResizeTimer;
window.addEventListener('resize', () => { clearTimeout(mosaicResizeTimer); mosaicResizeTimer = setTimeout(() => activeView === 'mosaic' ? renderMosaic() : flowView.render(), 100); });
load();
