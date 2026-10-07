import { json } from './published.js';
import { config } from './config.js';
import { aggregateParties, chartValue } from './party-overview.js';
import { TABLES, alphabetic } from './data.js';
import { layoutPie, slicePath } from './pie-chart.js';
import { accountGroups, recordGroups, latestRecords, zoomFrame } from './pie-navigation.js';
import { layoutTreemap } from './treemap.js';

const $ = (id) => document.getElementById(id);
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const percent = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 2 });
const shareLabel = (share) => share > 0 && share < .0001 ? '< 0,01%' : percent.format(share);
const number = (value) => value.toLocaleString('pt-BR');
const money = (cents) => cents === null ? 'Sem lançamentos' : brl.format(cents / 100);
const timestamp = (value) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(value)) + ' (Brasília)';
let data, result, accountIndexPromise;
const series = Object.entries(TABLES).map(([kind, definition]) => ({ kind, label: kind === 'receipts' ? 'Receitas declaradas' : definition.label }));
const chartStates = new Map();
const mosaicStates = new Map();
let activeView = 'pies', mosaicMetric = 'receipts';
const partyColors = new Map();
const zoomCache = new WeakMap();
const canZoom = (entry) => entry.level !== 'leaf' && entry.hasZoom !== false && entry.cents > 0;
const node = (tag, text, className) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
function svgNode(tag, attributes = {}, text) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, value);
  if (text !== undefined) el.textContent = text;
  return el;
}
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
    chartStates.clear();
    mosaicStates.clear();
    $('publication-date').textContent = `Dados obtidos do TSE em ${timestamp(data.updatedAt)}`;
    render();
  } catch (error) {
    $('load-error').replaceChildren(node('p', `${error.message} Use “Atualizar” para tentar novamente.`)); $('load-error').hidden = false;
    $('publication-date').textContent = data ? `A atualização falhou. Continua visível a publicação de ${timestamp(data.updatedAt)}.` : 'Não foi possível carregar os dados.';
    if (!data) { $('party-chart').replaceChildren(node('p', 'Gráficos indisponíveis até o carregamento da fonte.', 'chart-placeholder')); $('mosaic-content').replaceChildren(node('p', 'Mosaico indisponível até o carregamento da fonte.', 'chart-placeholder')); }
  } finally { $('reload').disabled = false; }
}
function render() {
  if (!data) return;
  result = aggregateParties(data);
  result.parties.forEach((party, index) => partyColors.set(party.party, `hsl(${(index * 137.508 + 164) % 360} 48% ${index % 2 ? 43 : 36}%)`));
  renderCharts();
  renderMosaic();
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
function setView(view) {
  activeView = view;
  for (const [name, id] of [['pies', 'view-pies'], ['mosaic', 'view-mosaic']]) {
    $(id).setAttribute('aria-selected', String(name === view)); $(id).tabIndex = name === view ? 0 : -1;
  }
  $('pie-view').hidden = view !== 'pies'; $('mosaic-view').hidden = view !== 'mosaic';
  $('view-hint').textContent = view === 'pies' ? 'Clique em uma fatia para explorar. Use a pizza ao fundo ou o caminho acima dela para voltar.' : 'A área representa o valor declarado. Clique em um bloco para explorar; use o caminho acima para voltar.';
  $('legend-hint').textContent = view === 'pies' ? 'Cores iguais nos três gráficos. Clique na sigla para explorar o partido nos três.' : 'As cores identificam os partidos. A legenda também permite acessar blocos pequenos e itens sem área.';
  for (const button of $('party-legend').querySelectorAll('button')) button.setAttribute('aria-label', `Explorar ${button.dataset.party}${view === 'pies' ? ' nos três gráficos' : ' no mosaico'}`);
  if (view === 'mosaic') renderMosaic();
}
function renderMosaic(focus = false) {
  if (!data || activeView !== 'mosaic') return;
  const item = series.find((entry) => entry.kind === mosaicMetric);
  let state = mosaicStates.get(item.kind);
  if (!state) { state = { frames: [rootFrame(item)], request: 0, loading: false, error: '' }; mosaicStates.set(item.kind, state); }
  const container = $('mosaic-content'); container.replaceChildren(); container.setAttribute('aria-busy', String(state.loading));
  const frame = state.frames.at(-1);
  const trail = node('nav', undefined, 'pie-trail mosaic-trail'); trail.setAttribute('aria-label', 'Caminho do mosaico');
  state.frames.forEach((ancestor, index) => {
    if (index) trail.append(node('span', '›', 'trail-separator'));
    if (index === state.frames.length - 1) { const current = node('span', ancestor.title); current.setAttribute('aria-current', 'location'); trail.append(current); }
    else {
      const back = node('button', ancestor.title); back.type = 'button';
      back.addEventListener('click', () => { state.request++; state.loading = false; state.error = ''; state.frames.splice(index + 1); renderMosaic(true); }); trail.append(back);
    }
  }); container.append(trail);
  const heading = node('div', undefined, 'mosaic-heading');
  const title = node('h2', item.label); title.tabIndex = -1;
  const dimension = node('span', frame.dimension, 'mosaic-dimension'); heading.append(title, dimension); container.append(heading);
  const map = node('div', undefined, 'mosaic-map'); map.setAttribute('role', 'group'); map.setAttribute('aria-label', `${item.label}: ${frame.dimension}, ${frame.title}`); container.append(map);
  const layout = layoutTreemap(frame.nodes, map.clientWidth || 900, map.clientHeight || 520);
  heading.append(node('strong', !data.tables[item.kind] ? 'Não disponível' : frame.nodes.some((entry) => entry.cents !== null) ? money(layout.total) : 'Sem lançamentos', 'mosaic-total'));
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
  if (excluded || missing) container.append(node('p', [excluded ? `${number(excluded)} item(ns) sem área: valor zero ou sem lançamentos.` : '', missing ? `Soma parcial: ${number(missing)} registro(s) sem valor.` : ''].filter(Boolean).join(' '), 'pie-note'));
  if (state.frames.length > 1) {
    const legend = node('div', undefined, 'mosaic-legend'); legend.setAttribute('role', 'group'); legend.setAttribute('aria-label', `${frame.dimension}: valores e detalhes`);
    for (const entry of frame.nodes) {
      const button = node('button', undefined, 'pie-key'); button.type = 'button'; button.dataset.tileId = entry.id;
      const swatch = node('span', undefined, 'pie-swatch'); swatch.style.backgroundColor = entry.color; swatch.setAttribute('aria-hidden', 'true'); button.append(swatch, node('span', entry.label, 'pie-key-name'));
      button.setAttribute('aria-label', `${entry.label}: ${exact(entry)}${canZoom(entry) ? '. Abrir detalhes' : ''}`);
      button.addEventListener('pointerenter', () => show(entry)); button.addEventListener('focus', () => show(entry)); button.addEventListener('click', () => advance(entry)); legend.append(button);
    } container.append(legend);
  }
  if (focus) title.focus({ preventScroll: true });
}
function renderCharts() {
  $('party-chart').replaceChildren();
  for (const item of series) {
    const root = rootFrame(item);
    const state = { frames: [root], request: 0, loading: false };
    chartStates.set(item.kind, state);
    const card = node('section', undefined, 'pie-card'); card.dataset.kind = item.kind;
    card.setAttribute('aria-label', item.label); $('party-chart').append(card);
    renderPie(card, item, state);
  }
  const legend = $('party-legend'); legend.replaceChildren();
  for (const party of result.parties) {
    const button = node('button', undefined, 'pie-key'); button.type = 'button';
    const swatch = node('span', undefined, 'pie-swatch'); swatch.style.backgroundColor = partyColors.get(party.party); swatch.setAttribute('aria-hidden', 'true');
    button.append(swatch, node('span', party.party)); button.dataset.party = party.party;
    button.setAttribute('aria-label', `Explorar ${party.party}${activeView === 'pies' ? ' nos três gráficos' : ' no mosaico'}`);
    const show = () => {
      $('chart-detail').textContent = `${party.party} · ${series.map((item) => `${item.label}: ${exact(chartValue(party, item))}`).join(' · ')}`;
      if (activeView === 'mosaic') { const state = mosaicStates.get(mosaicMetric); if (state?.frames.length === 1) state.show(state.frames[0].nodes.find((entry) => entry.id === party.party)); return; }
      for (const item of series) { const state = chartStates.get(item.kind); if (state.frames.length === 1) state.show(state.frames[0].nodes.find((entry) => entry.id === party.party)); }
    };
    button.addEventListener('pointerenter', show); button.addEventListener('focus', show);
    button.addEventListener('click', () => {
      if (activeView === 'mosaic') {
        const state = mosaicStates.get(mosaicMetric); if (!state) return;
        state.request++; state.loading = false; state.error = ''; state.frames.splice(1); renderMosaic();
        state.advance(state.frames[0].nodes.find((entry) => entry.id === party.party)); return;
      }
      for (const item of series) {
        const state = chartStates.get(item.kind); state.request++; state.loading = false; state.frames.splice(1);
        const card = $('party-chart').querySelector(`[data-kind="${item.kind}"]`); renderPie(card, item, state);
        state.advance(state.frames[0].nodes.find((entry) => entry.id === party.party));
      }
    }); legend.append(button);
  }
}
function renderPie(card, item, state, focus = false) {
  card.replaceChildren(); card.setAttribute('aria-busy', String(state.loading));
  const frame = state.frames.at(-1), layout = layoutPie(frame.nodes);
  const title = node('h2', item.label); card.append(title);
  const trail = node('nav', undefined, 'pie-trail'); trail.setAttribute('aria-label', `Caminho de ${item.label}`);
  state.frames.forEach((ancestor, index) => {
    if (index) trail.append(node('span', '›', 'trail-separator'));
    if (index === state.frames.length - 1) { const current = node('span', ancestor.title); current.setAttribute('aria-current', 'location'); trail.append(current); }
    else {
      const back = node('button', ancestor.title); back.type = 'button';
      back.addEventListener('click', () => { state.request++; state.loading = false; state.frames.splice(index + 1); renderPie(card, item, state, true); }); trail.append(back);
    }
  }); card.append(trail);
  const dimension = node('p', frame.dimension, 'pie-dimension'); dimension.tabIndex = -1;
  const total = node('strong', !data.tables[item.kind] ? 'Não disponível' : frame.nodes.some((entry) => entry.cents !== null) ? money(layout.total) : 'Sem lançamentos', 'pie-total');
  card.append(dimension, total);
  const stage = node('div', undefined, 'pie-stage');
  if (state.frames.length > 1) {
    const previous = state.frames.at(-2), previousLayout = layoutPie(previous.nodes);
    const back = node('button', undefined, 'pie-background'); back.type = 'button'; back.setAttribute('aria-label', `Voltar para ${previous.title}`);
    back.append(drawPie(previousLayout, previous, item, null));
    back.addEventListener('click', () => { state.request++; state.loading = false; state.frames.pop(); renderPie(card, item, state, true); }); stage.append(back);
  }
  const detail = node('p', 'Passe o mouse ou toque em uma fatia.', 'pie-detail'); detail.setAttribute('role', 'status'); detail.setAttribute('aria-live', 'polite');
  const error = node('p', undefined, 'error pie-error'); error.hidden = true; error.setAttribute('role', 'alert');
  const show = (entry) => {
    const percentage = layout.status === 'ready' && entry.cents > 0 ? ` · ${shareLabel(entry.cents / layout.total)}` : '';
    detail.replaceChildren(node('strong', entry.label), node('span', `${exact(entry)}${percentage}`));
    if (entry.accounts) detail.append(node('span', `${number(entry.accounts.length)} conta(s) de órgãos`));
    card.querySelectorAll('[data-slice-id]').forEach((element) => element.classList.toggle('is-active', element.dataset.sliceId === entry.id));
  };
  const advance = async (entry) => {
    const source = frame.nodes.find((part) => part.id === entry.id) || entry;
    if (state.loading || !canZoom(source)) { show(entry); return; }
    show(entry); error.hidden = true; state.loading = true; card.setAttribute('aria-busy', 'true');
    const request = ++state.request;
    try {
      const next = await nextZoomFrame(source, item);
      if (request !== state.request || chartStates.get(item.kind) !== state) return;
      if (next) { state.frames.push(next); renderPie(card, item, state, true); }
      else markTerminal(card, 'data-slice-id', source);
    } catch (failure) {
      if (request === state.request && chartStates.get(item.kind) === state) { error.textContent = `${failure.message} Clique novamente na fatia para tentar outra vez.`; error.hidden = false; }
    } finally {
      if (request === state.request) { state.loading = false; card.setAttribute('aria-busy', 'false'); }
    }
  };
  state.show = show; state.advance = advance;
  if (layout.status === 'ready') stage.append(drawPie(layout, frame, item, { show, advance }));
  else stage.append(node('p', !data.tables[item.kind] ? 'Tabela não disponível na fonte.' : layout.status === 'negative' ? 'Há totais negativos neste nível. Selecione um item da legenda para consultar o valor.' : 'Nenhum valor positivo disponível para desenhar esta pizza.', 'pie-empty'));
  card.append(stage, detail, error);
  const excluded = frame.nodes.filter((entry) => entry.cents === null || entry.cents === 0).length;
  const missing = frame.nodes.reduce((sum, entry) => sum + entry.missing, 0);
  if (excluded || missing) card.append(node('p', [excluded ? `${number(excluded)} item(ns) sem fatia: valor zero ou sem lançamentos.` : '', missing ? `Soma parcial: ${number(missing)} registro(s) sem valor.` : ''].filter(Boolean).join(' '), 'pie-note'));
  const legend = node('div', undefined, 'pie-legend'); legend.setAttribute('role', 'group'); legend.setAttribute('aria-label', `${frame.dimension}: valores e detalhes`);
  for (const entry of frame.nodes) {
    const button = node('button', undefined, 'pie-key'); button.type = 'button'; button.dataset.sliceId = entry.id;
    const swatch = node('span', undefined, 'pie-swatch'); swatch.style.backgroundColor = entry.color; swatch.setAttribute('aria-hidden', 'true');
    button.append(swatch, node('span', entry.label, 'pie-key-name'));
    button.setAttribute('aria-label', `${entry.label}: ${exact(entry)}${canZoom(entry) ? '. Abrir detalhes' : ''}`);
    button.title = `${entry.label}: ${exact(entry)}`;
    button.addEventListener('pointerenter', () => show(entry)); button.addEventListener('focus', () => show(entry)); button.addEventListener('click', () => advance(entry)); legend.append(button);
  }
  if (state.frames.length > 1) card.append(legend);
  if (focus) dimension.focus({ preventScroll: true });
  $('chart-detail').textContent = 'Clique nas fatias para aprofundar. Use o caminho acima da pizza ou a pizza ao fundo para voltar.';
}
function drawPie(layout, frame, item, actions) {
  const svg = svgNode('svg', { viewBox: '0 0 320 320', class: actions ? 'pie-chart' : 'pie-thumbnail', role: actions ? 'group' : 'img', 'aria-label': `${item.label}: ${frame.dimension}, ${frame.title}` });
  if (!actions) svg.setAttribute('aria-hidden', 'true');
  for (const slice of layout.slices) {
    const attributes = { d: slicePath(slice.start, slice.end), fill: slice.color, class: 'pie-slice' };
    if (actions) Object.assign(attributes, { class: `pie-slice${canZoom(slice) ? '' : ' is-terminal'}`, tabindex: 0, role: 'button', 'data-slice-id': slice.id, 'aria-label': `${slice.label}: ${exact(slice)} · ${shareLabel(slice.share)}${canZoom(slice) ? '. Abrir detalhes' : ''}` });
    const path = svgNode('path', attributes); path.append(svgNode('title', {}, `${slice.label}: ${exact(slice)} · ${shareLabel(slice.share)}`));
    if (actions) {
      path.addEventListener('pointerenter', () => actions.show(slice)); path.addEventListener('focus', () => actions.show(slice)); path.addEventListener('click', () => actions.advance(slice));
      path.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); actions.advance(slice); } });
    }
    svg.append(path);
    if (actions && slice.share >= .065) {
      const middle = (slice.start + slice.end) * Math.PI, distance = slice.share === 1 ? 0 : 85;
      const x = 160 + distance * Math.sin(middle), y = 160 - distance * Math.cos(middle);
      if (slice.label.length <= 8) svg.append(svgNode('text', { x, y: y - 5, class: 'pie-label', 'text-anchor': 'middle', 'aria-hidden': 'true' }, slice.label));
      svg.append(svgNode('text', { x, y: y + 11, class: 'pie-label pie-percent', 'text-anchor': 'middle', 'aria-hidden': 'true' }, shareLabel(slice.share)));
    }
  }
  return svg;
}
$('reload').addEventListener('click', load);
for (const [id, view] of [['view-pies', 'pies'], ['view-mosaic', 'mosaic']]) {
  $(id).addEventListener('click', () => setView(view));
  $(id).addEventListener('keydown', (event) => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); const next = event.key === 'Home' ? 'pies' : event.key === 'End' ? 'mosaic' : activeView === 'pies' ? 'mosaic' : 'pies'; setView(next); $(`view-${next}`).focus();
    }
  });
}
for (const button of $('mosaic-view').querySelectorAll('[data-metric]')) button.addEventListener('click', () => {
  mosaicMetric = button.dataset.metric;
  for (const control of $('mosaic-view').querySelectorAll('[data-metric]')) control.setAttribute('aria-pressed', String(control.dataset.metric === mosaicMetric));
  renderMosaic();
});
let mosaicResizeTimer;
window.addEventListener('resize', () => { clearTimeout(mosaicResizeTimer); mosaicResizeTimer = setTimeout(() => renderMosaic(), 100); });
load();
