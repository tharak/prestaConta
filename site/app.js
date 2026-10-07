import { TABLES } from './data.js';
import { CATEGORIES } from './analytics.js';

const $ = (id) => document.getElementById(id);
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const amount = (cents) => cents === null ? 'Não disponível' : brl.format(cents / 100);
const timestamp = (iso) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(iso)) + ' (Brasília)';
const state = { dataWorker: null, loadWorker: null, scope: '', loaded: null, page: 0, account: null, statementId: '', summary: null, kind: 'receipts', transactionPage: 0, totalTransactions: 0, listVersion: 0, detailVersion: 0, transactionVersion: 0, contributorVersion: 0, contributorPage: 0, totalContributors: 0 };
let requestId = 0;
const pending = new Map();
const bases = new Map();
const baseRequests = new Map();
let loadVersion = 0;

function element(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}
function createWorker() {
  const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.addEventListener('message', ({ data }) => {
    if (data.type !== 'response') return;
    const request = pending.get(data.requestId);
    if (!request) return;
    pending.delete(data.requestId);
    if (data.error) request.reject(new Error(data.error));
    else request.resolve(data.result);
  });
  worker.addEventListener('error', () => {
    for (const [id, request] of pending) {
      if (request.worker === worker) { request.reject(new Error('O processamento da base foi interrompido. Recarregue os dados.')); pending.delete(id); }
    }
    if (state.loadWorker === worker) finishLoading('O processamento foi interrompido. Tente novamente ou use um computador com mais memória para esta base.');
  });
  return worker;
}
function query(type, params = {}) {
  if (!state.dataWorker) return Promise.reject(new Error('Carregue uma base antes de consultar.'));
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, worker: state.dataWorker });
    state.dataWorker.postMessage({ type, requestId: id, ...params });
  });
}
function setStatus(text, mode = '') {
  $('status-text').textContent = text;
  $('status').className = `status ${mode}`;
}
function selectedScope() { return document.querySelector('input[name=scope]:checked').value; }
function setBusy(busy) {
  $('load').disabled = busy;
  $('cancel').hidden = !busy;
  $('progress').hidden = !busy;
  $('file').disabled = busy;
  document.querySelectorAll('input[name=scope]').forEach((input) => { input.disabled = busy; });
  $('consulta').setAttribute('aria-busy', String(busy));
}
function showError(message) {
  const box = $('load-error');
  box.replaceChildren(element('p', message));
  box.hidden = false;
}
function finishLoading(error) {
  loadVersion++;
  state.loadWorker = null;
  setBusy(false);
  if (error) {
    showError(error);
    setStatus(state.loaded ? 'A atualização falhou. A base anterior continua disponível.' : 'Não foi possível carregar a base. Tente novamente.');
  }
}
async function activateBase(worker, data) {
  for (const [id, request] of pending) { request.reject(new Error('A base foi atualizada.')); pending.delete(id); }

  const previousWorker = state.dataWorker;
  if (previousWorker && previousWorker !== worker && ![...bases.values()].some((entry) => entry.worker === previousWorker)) previousWorker.terminate();
  state.dataWorker = worker;
  state.loadWorker = null;
  state.loaded = data;
  state.scope = data.scope;
  state.account = null;
  $('account-list').replaceChildren(element('p', 'Carregando lista de contas…', 'empty-list'));
  state.summary = null;
  state.page = 0;
  state.detailVersion++;
  state.transactionVersion++;
  state.contributorVersion++;
  setBusy(false);
  $('account-detail').hidden = true;
  $('welcome').hidden = false;
  const icon = element('span', '↻'); icon.setAttribute('aria-hidden', 'true');
  $('load').replaceChildren(icon, document.createTextNode(data.publishedAt ? ' Recarregar publicação' : ' Atualizar dados do TSE'));
  const local = data.source.startsWith('Arquivo local:');
  const rows = Object.values(data.tables).reduce((n, table) => n + table.rows, 0);
  const updated = data.publishedAt ? `Dados obtidos do TSE em ${timestamp(data.publishedAt)}. Publicação consultada` : local ? 'Arquivo local processado' : 'Fonte consultada';
  setStatus(`${updated} em ${timestamp(data.loadedAt)}. ${data.accounts.toLocaleString('pt-BR')} contas e ${rows.toLocaleString('pt-BR')} lançamentos disponíveis.`, 'loaded');
  $('search').disabled = false;
  $('search').value = '';
  $('search').placeholder = data.scope === 'candidates' ? 'Buscar candidatura…' : 'Buscar órgão partidário…';
  for (const field of ['uf', 'party', 'office']) {
    const label = field === 'office' ? (data.scope === 'candidates' ? 'Todos os cargos' : 'Todas as esferas') : 'Todos';
    const select = $(field);
    select.replaceChildren(new Option(label, ''));
    data.options[field].forEach((value) => select.add(new Option(value, value)));
    select.disabled = false;
  }
  $('office-label').textContent = data.scope === 'candidates' ? 'Cargo' : 'Esfera';
  await renderList();
}
function requestBase(scope, file, refresh = false) {
  if (!file && !refresh && bases.has(scope)) return Promise.resolve(bases.get(scope));
  if (!file && baseRequests.has(scope)) return baseRequests.get(scope);
  const worker = createWorker();
  const promise = new Promise((resolve, reject) => {
    worker.addEventListener('message', ({ data }) => {
      if (data.type === 'progress' && state.loadWorker === worker) setStatus(data.text, 'busy');
      if (data.type === 'error') { worker.terminate(); reject(new Error(data.message)); }
      if (data.type === 'loaded') {
        const entry = { worker, data };
        if (!file) {
          const previous = bases.get(scope);
          if (previous && previous.worker !== state.dataWorker) previous.worker.terminate();
          bases.set(scope, entry);
        }
        resolve(entry);
      }
    });
    worker.addEventListener('error', () => { worker.terminate(); reject(new Error('O processamento da base foi interrompido. Tente carregar novamente.')); });
  });
  if (!file) baseRequests.set(scope, promise);
  promise.finally(() => { if (baseRequests.get(scope) === promise) baseRequests.delete(scope); }).catch(() => {});
  if (selectedScope() === scope) state.loadWorker = worker;
  worker.postMessage({ type: 'load', scope, file });
  return promise;
}
async function load(file, refresh = false) {
  if (!('Worker' in window) || !('DecompressionStream' in window)) {
    showError('Este navegador não suporta a leitura dos arquivos do TSE. Use uma versão atual de Chrome, Firefox, Edge ou Safari.');
    return;
  }
  const version = ++loadVersion;
  $('load-error').hidden = true;
  setBusy(true);
  // Permite trocar de base mesmo durante o carregamento automático.
  document.querySelectorAll('input[name=scope]').forEach((input) => { input.disabled = false; });
  setStatus('Carregando a base selecionada…', 'busy');
  try {
    const entry = await requestBase(selectedScope(), file, refresh);
    if (version !== loadVersion) return;
    await activateBase(entry.worker, entry.data);
  } catch (error) { if (version === loadVersion) finishLoading(error.message); }
}
function filters() { return { query: $('search').value, uf: $('uf').value, party: $('party').value, office: $('office').value }; }
function context(account) {
  return [account.party, state.scope === 'candidates' ? account.office : account.sphere, account.uf, state.scope === 'parties' ? account.locality : '', account.number ? `Nº ${account.number}` : ''].filter(Boolean).join(' · ');
}
async function renderList() {
  if (!state.dataWorker) return;
  const version = ++state.listVersion;
  const activeFilters = filters();
  $('clear-filters').hidden = !Object.values(activeFilters).some(Boolean);
  try {
    const result = await query('list', { filters: activeFilters, page: state.page });
    if (version !== state.listVersion) return;
    $('result-count').textContent = `${result.count.toLocaleString('pt-BR')} ${result.count === 1 ? 'conta encontrada' : 'contas encontradas'}`;
    const list = $('account-list');
    list.replaceChildren();
    if (!result.accounts.length) list.append(element('p', 'Nenhuma conta encontrada. Tente outro nome ou remova os filtros.', 'empty-list'));
    for (const account of result.accounts) {
      const button = element('button', undefined, 'account-option');
      button.type = 'button';
      button.dataset.id = account.id;
      button.setAttribute('aria-pressed', String(account.id === state.account?.id));
      button.append(element('strong', account.name), element('span', context(account) || `Prestador ${account.prestador}`));
      button.addEventListener('click', () => selectAccount(account));
      list.append(button);
    }
    list.scrollTop = 0;
    const pages = Math.ceil(result.count / 25);
    $('list-pagination').hidden = pages <= 1;
    $('list-page').textContent = `${state.page + 1} / ${pages}`;
    $('list-prev').disabled = !state.page;
    $('list-next').disabled = state.page + 1 >= pages;
  } catch (error) { if (version === state.listVersion) showError(error.message); }
}
async function selectAccount(account) {
  state.account = account;
  state.statementId = account.statements[0]?.id || '';
  state.kind = 'receipts';
  state.transactionPage = 0;
  $('transaction-sort').value = 'original';
  $('statement').replaceChildren();
  for (const statement of account.statements) {
    const label = [statement.type, statement.date || 'Data não informada', statement.turn ? `${statement.turn}º turno` : ''].filter(Boolean).join(' · ');
    $('statement').add(new Option(label, statement.id));
  }
  document.querySelectorAll('.account-option').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.id === account.id)));
  await renderDetail();
}
function metricLabel(total) {
  if (!total.available) return 'Não disponível';
  if (!total.count) return 'Sem lançamentos';
  if (total.missing) return 'Valor incompleto';
  return amount(total.cents);
}
function renderGroups(target, groups) {
  const container = $(target);
  container.replaceChildren();
  if (!groups.length) container.append(element('p', 'Sem lançamentos de receita nesta prestação.', 'empty-value'));
  for (const group of groups) {
    const row = element('div', undefined, 'breakdown-row');
    row.append(element('span', group.name), element('strong', group.missing ? 'Valor incompleto' : amount(group.cents)));
    container.append(row);
  }
}
function comparisonRow(name, cents, sample) {
  const row = element('tr');
  const mean = sample?.count >= 2 ? sample.meanCents : null;
  let difference = 'Não calculada';
  if (cents !== null && mean !== null) {
    if (mean === 0) difference = cents === 0 ? 'Mesmo valor (média zero)' : 'Média zero; percentual indefinido';
    else if (mean < 0) difference = `Diferença: ${amount(cents - mean)}`;
    else difference = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero' }).format((cents - mean) / mean);
  }
  const denominator = element('td', `${sample?.count || 0} contas`);
  denominator.append(element('small', `${sample?.excluded || 0} excluídas`));
  row.append(element('td', name), element('td', amount(cents), 'numeric'), element('td', amount(mean), 'numeric'), element('td', difference, 'numeric'), denominator);
  return row;
}
function comparisonTable(label, rows, collapse = false) {
  const section = element(collapse ? 'details' : 'div', undefined, 'benchmark-group');
  if (collapse) section.append(element('summary', label));
  else section.append(element('h4', label));
  const table = element('table');
  const caption = element('caption', label, 'sr-only');
  const head = element('thead'); const header = element('tr');
  for (const name of ['Categoria', 'Candidatura', 'Média', 'Diferença (%)', 'Base do cálculo']) { const cell = element('th', name); cell.scope = 'col'; header.append(cell); }
  head.append(header); const body = element('tbody'); body.append(...rows);
  table.append(caption, head, body); const wrap = element('div', undefined, 'table-wrap'); wrap.append(table); section.append(wrap);
  return section;
}
async function renderBenchmark(version) {
  if (state.scope !== 'candidates') return;
  try {
    const cohort = await query('benchmark', { id: state.account.id, statementId: state.statementId });
    if (version !== state.detailVersion) return;
    if (!cohort) {
      $('benchmark-context').textContent = 'Médias indisponíveis: consulte a prestação mais recente deste tipo e turno. O cálculo também exige eleição, cargo, UF, turno e data informados, além de uma publicação com médias.';
      return;
    }
    const summary = state.summary;
    $('benchmark-context').textContent = `${cohort.office} · ${cohort.uf} · ${cohort.type} · ${cohort.turn}º turno. ${cohort.accounts.toLocaleString('pt-BR')} contas do grupo, com prestações em datas possivelmente diferentes. A média exige pelo menos duas contas válidas por tabela.`;
    const results = $('benchmark-results');
    results.replaceChildren(comparisonTable('Totais da conta', Object.entries(TABLES).map(([kind, definition]) => comparisonRow(definition.label, summary.totals[kind].cents, cohort.totals[kind]))));
    for (const [field, definition] of Object.entries(CATEGORIES)) {
      const declared = new Map((summary[field] || []).map((group) => [group.name, group]));
      const baseline = new Map(cohort.categories[field].map((group) => [group.name, group]));
      const names = [...new Set([...baseline.keys(), ...declared.keys()])].sort((a, b) => a.localeCompare(b, 'pt-BR'));
      const rows = names.map((name) => {
        const group = declared.get(name);
        const cents = summary.totals[definition.kind].cents === null ? null : group ? (group.missing ? null : group.cents) : 0;
        return comparisonRow(name, cents, baseline.get(name) || { ...cohort.totals[definition.kind], meanCents: 0 });
      });
      if (rows.length) results.append(comparisonTable(definition.label, rows, true));
    }
  } catch (error) { if (version === state.detailVersion) $('benchmark-context').textContent = error.message; }
}
async function renderContributors() {
  if (!state.account) return;
  const version = ++state.contributorVersion;
  $('contributors').replaceChildren(element('p', 'Carregando repasses…', 'empty-value'));
  $('contributor-prev').disabled = true; $('contributor-next').disabled = true;
  try {
    const result = await query('counterparties', { id: state.account.id, statementId: state.statementId,
      filters: { query: $('contributor-search').value, origin: $('contributor-origin').value }, page: state.contributorPage });
    if (version !== state.contributorVersion) return;
    state.totalContributors = result.count;
    const container = $('contributors'); container.replaceChildren();
    for (const group of result.rows) {
      const row = element('article', undefined, 'contributor-row');
      row.append(element('strong', group.name), element('p', group.missing ? `Valor incompleto · ${group.missing} lançamento(s) sem valor` : amount(group.cents), 'contribution-amount'),
        element('p', [group.origin || 'Origem não informada', group.source || 'Fonte não informada', group.nature || 'Natureza não informada'].join(' · ')), element('p', `${group.count.toLocaleString('pt-BR')} lançamento(s)`));
      container.append(row);
    }
    if (!result.rows.length) container.append(element('p', 'Nenhum repasse encontrado para esta prestação e estes filtros.', 'empty-value'));
    $('contributor-count').textContent = `${result.count.toLocaleString('pt-BR')} agrupamento(s) de repasses`;
    const pages = Math.max(1, Math.ceil(result.count / 20));
    $('contributor-page').textContent = `${state.contributorPage + 1} / ${pages}`;
    $('contributor-prev').disabled = state.contributorPage === 0;
    $('contributor-next').disabled = state.contributorPage + 1 >= pages;
  } catch (error) { if (version === state.contributorVersion) $('contributors').replaceChildren(element('p', error.message, 'empty-value')); }
}
async function renderDetail() {
  if (!state.account) return;
  const version = ++state.detailVersion;
  $('account-detail').setAttribute('aria-busy', 'true');
  $('account-detail').hidden = true;
  $('welcome').hidden = false;
  try {
    const summary = await query('summary', { id: state.account.id, statementId: state.statementId });
    if (version !== state.detailVersion) return;
    state.summary = summary;
    $('account-name').textContent = summary.account.name;
    $('account-kind').textContent = state.scope === 'candidates' ? 'CANDIDATURA / CONTA DECLARADA' : 'ÓRGÃO PARTIDÁRIO / CONTA DECLARADA';
    $('account-context').textContent = context(summary.account);
    $('received').textContent = metricLabel(summary.totals.receipts);
    $('contracted').textContent = metricLabel(summary.totals.contracted);
    $('paid').textContent = metricLabel(summary.totals.paid);
    $('received-note').textContent = summary.natures.length ? summary.natures.map((n) => n.name).join(' · ') : 'Natureza não disponível';
    const warnings = [];
    for (const [kind, total] of Object.entries(summary.totals)) {
      if (!total.available) warnings.push(`${TABLES[kind].label}: tabela não disponível neste arquivo.`);
      else if (!total.count) warnings.push(`${TABLES[kind].label}: nenhum lançamento encontrado para esta prestação; isso não comprova ausência de movimentação.`);
      else if (total.missing) warnings.push(`${TABLES[kind].label}: ${total.missing} lançamento(s) sem valor informado. O total não é exibido como completo.`);
    }
    if (!summary.statement.date) warnings.push('Data da prestação não informada no arquivo.');
    $('data-warning').textContent = warnings.join(' ');
    $('data-warning').hidden = !warnings.length;
    renderGroups('funding-sources', summary.sources);
    renderGroups('funding-origins', summary.origins);
    $('contributor-search').value = '';
    $('contributor-origin').replaceChildren(new Option('Todas as origens', ''));
    for (const group of summary.origins) if (group.name !== 'Não informado') $('contributor-origin').add(new Option(group.name, group.name));
    state.contributorPage = 0;
    $('benchmark-section').hidden = state.scope !== 'candidates';
    $('benchmark-context').textContent = 'Calculando as médias do grupo…';
    $('benchmark-results').replaceChildren();
    const provenance = $('provenance');
    provenance.replaceChildren();
    const rows = [
      ['Conta no TSE', summary.account.prestador],
      ['Carregamento', timestamp(summary.loadedAt)],
      ['Modo de leitura', summary.sourceMode === 'published' ? 'Publicação atualizada por GitHub Actions; conta carregada sob demanda' : summary.source.startsWith('Arquivo local:') ? summary.source : 'Consulta sob demanda ao arquivo oficial'],
    ];
    if (summary.publishedAt) rows.push(['Dados obtidos do TSE', timestamp(summary.publishedAt)]);
    for (const [kind, table] of Object.entries(summary.tables)) {
      rows.push([`Geração · ${TABLES[kind].label.toLocaleLowerCase('pt-BR')}`, table.generations.length ? table.generations.join(' / ') : 'Não informada']);
      rows.push([`Arquivo · ${TABLES[kind].label.toLocaleLowerCase('pt-BR')}`, table.filename]);
    }
    for (const [label, value] of rows) {
      const row = element('div', undefined, 'provenance-row');
      row.append(element('span', label), element('strong', value));
      provenance.append(row);
    }
    $('welcome').hidden = true;
    $('account-detail').hidden = false;
    $('account-detail').setAttribute('aria-busy', 'false');
    await Promise.all([renderTransactions(), renderContributors(), renderBenchmark(version)]);
  } catch (error) { if (version === state.detailVersion) { $('account-detail').setAttribute('aria-busy', 'false'); showError(error.message); } }
}
async function renderTransactions() {
  if (!state.account) return;
  const version = ++state.transactionVersion;
  const kind = state.kind;
  document.querySelectorAll('[role=tab]').forEach((tab) => {
    const active = tab.dataset.kind === kind;
    tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
  });
  $('transaction-panel').setAttribute('aria-labelledby', `tab-${kind}`);
  $('transaction-panel').setAttribute('aria-busy', 'true');
  const loadingRow = element('tr'); const loadingCell = element('td', 'Carregando lançamentos…'); loadingCell.colSpan = 4; loadingRow.append(loadingCell); $('transaction-rows').replaceChildren(loadingRow);
  $('transaction-prev').disabled = true; $('transaction-next').disabled = true;
  $('counterparty-label').textContent = kind === 'receipts' ? 'Doador' : kind === 'contracted' ? 'Fornecedor' : 'Favorecido / fornecedor';
  $('transaction-caption').textContent = `${TABLES[kind].label} de ${state.account.name}, na prestação selecionada. ${$('transaction-sort').selectedOptions[0].textContent}.`;
  try {
    const result = await query('transactions', { id: state.account.id, statementId: state.statementId, kind, page: state.transactionPage, order: $('transaction-sort').value });
    if (version !== state.transactionVersion) return;
    state.totalTransactions = result.count;
    const body = $('transaction-rows');
    body.replaceChildren();
    for (const record of result.rows) {
      const row = element('tr');
      const detail = element('td', record.description || 'Não informada');
      const contextText = [record.source, record.origin, record.nature].filter(Boolean).join(' · ');
      if (contextText) detail.append(element('small', contextText));
      detail.append(element('small', `Registro ${record.row} · ${result.filename.split('/').pop()}`));
      row.append(element('td', record.date || 'Não informada'), element('td', record.counterparty || 'Não informado'), detail, element('td', amount(record.cents), 'numeric'));
      body.append(row);
    }
    if (!result.rows.length) {
      const cell = element('td', state.summary?.tables[kind] ? 'Nenhum lançamento encontrado nesta prestação.' : 'Esta tabela não está disponível no arquivo carregado.');
      cell.colSpan = 4; const row = element('tr'); row.append(cell); body.append(row);
    }
    $('transaction-count').textContent = `${result.count.toLocaleString('pt-BR')} ${result.count === 1 ? 'lançamento' : 'lançamentos'}`;
    const pages = Math.max(1, Math.ceil(result.count / 20));
    $('transaction-page').textContent = `${state.transactionPage + 1} / ${pages}`;
    $('transaction-prev').disabled = state.transactionPage === 0;
    $('transaction-next').disabled = state.transactionPage + 1 >= pages;
    $('transaction-panel').setAttribute('aria-busy', 'false');
  } catch (error) { if (version === state.transactionVersion) { $('transaction-panel').setAttribute('aria-busy', 'false'); showError(error.message); } }
}
$('load').addEventListener('click', () => { $('methodology-dialog').close(); load(undefined, true); });
$('cancel').addEventListener('click', () => { finishLoading(); setStatus(state.loaded ? `Carregamento cancelado. Continua visível a base carregada em ${timestamp(state.loaded.loadedAt)}.` : 'Carregamento cancelado. Nenhum dado foi carregado.'); });
$('file').addEventListener('change', () => {
  const file = $('file').files[0];
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.zip')) { showError('Selecione o arquivo ZIP original do TSE.'); return; }
  $('file-name').textContent = file.name;
  $('methodology-dialog').close();
  load(file);
  $('file').value = '';
});
document.querySelectorAll('input[name=scope]').forEach((radio) => radio.addEventListener('change', () => {
  $('file-name').textContent = 'Nenhum arquivo selecionado.';
  load();
}));
let searchTimer;
$('search').addEventListener('input', () => { clearTimeout(searchTimer); state.page = 0; searchTimer = setTimeout(renderList, 150); });
for (const field of ['uf', 'party', 'office']) $(field).addEventListener('change', () => { state.page = 0; renderList(); });
$('clear-filters').addEventListener('click', () => { for (const field of ['search', 'uf', 'party', 'office']) $(field).value = ''; state.page = 0; renderList(); });
$('list-prev').addEventListener('click', () => { if (state.page) state.page--; renderList(); });
$('list-next').addEventListener('click', () => { state.page++; renderList(); });
$('statement').addEventListener('change', () => { state.statementId = $('statement').value; state.transactionPage = 0; renderDetail(); });
const tabs = [...document.querySelectorAll('[role=tab]')];
for (const tab of tabs) {
  tab.addEventListener('click', () => { state.kind = tab.dataset.kind; state.transactionPage = 0; renderTransactions(); });
  tab.addEventListener('keydown', (event) => {
    const index = tabs.indexOf(tab);
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next === undefined) return;
    event.preventDefault(); tabs[next].focus(); tabs[next].click();
  });
}
$('transaction-prev').addEventListener('click', () => { if (state.transactionPage) state.transactionPage--; renderTransactions(); });
$('transaction-next').addEventListener('click', () => { if ((state.transactionPage + 1) * 20 < state.totalTransactions) state.transactionPage++; renderTransactions(); });
$('transaction-sort').addEventListener('change', () => { state.transactionPage = 0; renderTransactions(); });
let contributorTimer;
$('contributor-search').addEventListener('input', () => { clearTimeout(contributorTimer); state.contributorPage = 0; contributorTimer = setTimeout(renderContributors, 150); });
$('contributor-origin').addEventListener('change', () => { state.contributorPage = 0; renderContributors(); });
$('contributor-prev').addEventListener('click', () => { if (state.contributorPage) state.contributorPage--; renderContributors(); });
$('contributor-next').addEventListener('click', () => { if ((state.contributorPage + 1) * 20 < state.totalContributors) state.contributorPage++; renderContributors(); });
$('open-methodology').addEventListener('click', () => $('methodology-dialog').showModal());
$('close-methodology').addEventListener('click', () => $('methodology-dialog').close());
$('methodology-dialog').addEventListener('click', (event) => {
  const rect = $('methodology-dialog').getBoundingClientRect();
  if (event.target === $('methodology-dialog') && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) $('methodology-dialog').close();
});

// A mesma navegação da interface, quando o navegador oferece WebMCP.
if (document.modelContext?.registerTool) {
  const lifecycle = new AbortController();
  window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
  try {
    Promise.resolve(document.modelContext.registerTool({
      name: 'open_declared_account', title: 'Abrir uma conta declarada',
      description: 'Abre uma conta individual da base já carregada. Não inicia downloads nem altera os dados do TSE.',
      inputSchema: { type: 'object', properties: { accountId: { type: 'string', minLength: 1 } }, required: ['accountId'], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async execute(input) {
        if (!input || typeof input.accountId !== 'string' || !input.accountId || Object.keys(input).some((key) => key !== 'accountId')) throw new Error('Informe somente accountId como texto.');
        if (!state.dataWorker) throw new Error('Carregue uma base na interface antes de abrir uma conta.');
        const result = await query('list', { filters: { query: input.accountId.split(':').pop() }, page: 0 });
        const account = result.accounts.find((item) => item.id === input.accountId);
        if (!account) throw new Error('Conta não encontrada na base carregada.');
        await selectAccount(account);
        return { accountId: account.id, name: account.name, source: state.summary.source, statement: state.summary.statement };
      },
    }, { signal: lifecycle.signal })).catch(() => {});
  } catch { /* O recurso é opcional e não afeta a consulta por pessoas. */ }
}

// Os dois índices oficiais publicados são preparados na abertura.
load();
requestBase('parties').catch(() => {});
