import { TABLES, csvCell } from './data.js';

const $ = (id) => document.getElementById(id);
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const amount = (cents) => cents === null ? 'Não disponível' : brl.format(cents / 100);
const timestamp = (iso) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(iso)) + ' (Brasília)';
const state = { dataWorker: null, loadWorker: null, scope: '', loaded: null, page: 0, account: null, statementId: '', summary: null, kind: 'receipts', transactionPage: 0, totalTransactions: 0, listVersion: 0, detailVersion: 0, transactionVersion: 0 };
let requestId = 0;
const pending = new Map();

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
  state.loadWorker?.terminate();
  state.loadWorker = null;
  setBusy(false);
  if (error) {
    showError(error);
    setStatus(state.loaded ? `A atualização falhou. Continua visível a base carregada em ${timestamp(state.loaded.loadedAt)}.` : 'A base não foi carregada. Nenhum valor eleitoral está sendo exibido.');
  }
}
function load(file) {
  if (!('Worker' in window) || !('DecompressionStream' in window)) {
    showError('Este navegador não suporta a leitura dos arquivos do TSE. Use uma versão atual de Chrome, Firefox, Edge ou Safari.');
    return;
  }
  finishLoading();
  $('load-error').hidden = true;
  setBusy(true);
  setStatus('Iniciando leitura da fonte…', 'busy');
  const worker = createWorker();
  state.loadWorker = worker;
  worker.addEventListener('message', async ({ data }) => {
    if (worker !== state.loadWorker) return;
    if (data.type === 'progress') setStatus(data.text, 'busy');
    if (data.type === 'error') finishLoading(data.message);
    if (data.type === 'loaded') {
      for (const [id, request] of pending) { request.reject(new Error('A base foi atualizada.')); pending.delete(id); }
      state.dataWorker?.terminate();
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
  });
  worker.postMessage({ type: 'load', scope: selectedScope(), file });
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
async function renderDetail() {
  if (!state.account) return;
  const version = ++state.detailVersion;
  $('account-detail').setAttribute('aria-busy', 'true');
  $('account-detail').hidden = true;
  $('welcome').hidden = false;
  $('export').disabled = true;
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
    $('export').disabled = false;
    await renderTransactions();
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
  $('transaction-caption').textContent = `${TABLES[kind].label} de ${state.account.name}, na prestação selecionada. Ordem original do arquivo do TSE.`;
  try {
    const result = await query('transactions', { id: state.account.id, statementId: state.statementId, kind, page: state.transactionPage });
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
function exportSummary() {
  if (!state.summary) return;
  const summary = state.summary;
  const decimal = (cents) => cents === null ? '' : (cents / 100).toFixed(2).replace('.', ',');
  const rows = [['campo', 'valor'], ['conta', summary.account.name], ['identificador_tse', summary.account.prestador], ['partido', summary.account.party], ['uf', summary.account.uf], ['prestacao', summary.statement.type], ['data_prestacao', summary.statement.date], ['carregado_em', summary.loadedAt], ['fonte', summary.source]];
  if (summary.publishedAt) rows.push(['dados_obtidos_do_tse_em', summary.publishedAt]);
  for (const [kind, total] of Object.entries(summary.totals)) {
    rows.push([TABLES[kind].label, decimal(total.cents)], [`Situação · ${TABLES[kind].label}`, total.cents === null ? metricLabel(total) : 'Valor declarado'], [`Lançamentos · ${TABLES[kind].label}`, total.count]);
  }
  for (const group of summary.sources) rows.push([`Fonte do recurso · ${group.name}`, group.missing ? 'Valor incompleto' : decimal(group.cents)]);
  for (const group of summary.origins) rows.push([`Origem do repasse · ${group.name}`, group.missing ? 'Valor incompleto' : decimal(group.cents)]);
  for (const [kind, table] of Object.entries(summary.tables)) {
    rows.push([`Arquivo · ${TABLES[kind].label}`, table.filename], [`Gerado em · ${TABLES[kind].label}`, table.generations.join(' / ') || 'Não informado']);
  }
  const blob = new Blob(['\uFEFF', rows.map((row) => row.map(csvCell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = element('a'); link.href = url; link.download = `prestaconta-2026-${summary.account.prestador.replace(/[^0-9A-Za-z_-]/g, '')}.csv`;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('load').addEventListener('click', () => load());
$('cancel').addEventListener('click', () => { finishLoading(); setStatus(state.loaded ? `Carregamento cancelado. Continua visível a base carregada em ${timestamp(state.loaded.loadedAt)}.` : 'Carregamento cancelado. Nenhum dado foi carregado.'); });
$('file').addEventListener('change', () => {
  const file = $('file').files[0];
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.zip')) { showError('Selecione o arquivo ZIP original do TSE.'); return; }
  $('file-name').textContent = file.name;
  load(file);
  $('file').value = '';
});
document.querySelectorAll('input[name=scope]').forEach((radio) => radio.addEventListener('change', () => {
  $('file-name').textContent = 'Nenhum arquivo selecionado.';
  if (state.loaded && state.scope !== selectedScope()) setStatus('Outra base foi selecionada. Clique em carregar para consultá-la; as contas visíveis ainda pertencem à base anterior.');
  else if (state.loaded) setStatus(`Base carregada em ${timestamp(state.loaded.loadedAt)}.`, 'loaded');
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
$('export').addEventListener('click', exportSummary);

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
