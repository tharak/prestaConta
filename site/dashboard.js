import { json } from './published.js';
import { config } from './config.js';
import { aggregateParties, chartValue } from './party-overview.js';
import { TABLES, moneyToCents } from './data.js';

const $ = (id) => document.getElementById(id);
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
const number = (value) => value.toLocaleString('pt-BR');
const money = (cents) => cents === null ? 'Sem lançamentos' : brl.format(cents / 100);
const timestamp = (value) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(value)) + ' (Brasília)';
const colors = ['#167866', '#3c71b1', '#cd7b32', '#8952a5', '#c54870', '#608b38', '#af9830', '#447f92', '#8a6451', '#5d64a6', '#bc5e44', '#597463', '#707981'];
let data, result, series = [];
let compositionField = 'origins';
const categoryColors = { origins: new Map(), sources: new Map() };
const hiddenSeries = new Set();
const node = (tag, text, className) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
function svgNode(tag, attributes = {}, text) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, value);
  if (text !== undefined) el.textContent = text;
  return el;
}
function exact(value) {
  if (value.cents === null) return value.missing ? 'Não disponível: receita incompleta' : 'Sem lançamentos';
  return money(value.cents) + (value.missing ? ` · parcial (${number(value.missing)} registro(s) sem valor)` : '');
}
function totalsNote(total) {
  if (!total.available) return 'Tabela não disponível na fonte';
  if (!total.count) return 'Nenhum lançamento neste recorte';
  return `${number(total.count)} lançamentos · ${number(total.accountsWithRecords)} órgãos com registros` +
    (total.missing ? ` · soma parcial: ${number(total.missing)} registro(s) sem valor` : '') +
    (total.accountsWithoutRecords ? ` · ${number(total.accountsWithoutRecords)} órgãos sem lançamentos nesta tabela` : '');
}
function fillSelect(id, values, initial, label) {
  const select = $(id); const previous = select.value || initial;
  select.replaceChildren(new Option(label, initial));
  for (const value of values) select.add(new Option(value || 'Não informado no arquivo', value));
  select.value = [...select.options].some((option) => option.value === previous) ? previous : initial;
  select.disabled = false;
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
    for (const field of ['origins', 'sources']) {
      const names = [...new Set(data.accounts.flatMap((account) => account.statements.flatMap((statement) => statement[field].map((group) => group.name))))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
      categoryColors[field] = new Map(names.map((name, i) => [name, colors[(i + 3) % colors.length]]));
    }
    fillSelect('uf', data.options.uf, '', 'Todo o Brasil');
    fillSelect('sphere', data.options.sphere, '', 'Todas as esferas');
    fillSelect('statement-type', data.options.type, 'latest', 'Última de cada órgão');
    for (const id of ['minimum-value', 'minimum-kind', 'clear-minimum']) $(id).disabled = false;
    const turns = data.options.turn;
    $('turn').replaceChildren(new Option('Todos os turnos declarados', '*'));
    for (const value of turns) $('turn').add(new Option(value ? `${value}º turno` : 'Não informado no arquivo', value));
    $('turn-control').hidden = turns.length === 1 && turns[0] === '';
    $('publication-date').textContent = `Dados obtidos do TSE em ${timestamp(data.updatedAt)}`;
    $('file-dates').replaceChildren();
    for (const [kind, table] of Object.entries(data.tables)) $('file-dates').append(node('p', `${TABLES[kind].label}: ${table.filename} · geração: ${table.generations.join(' / ') || 'Não informada'}`));
    render();
  } catch (error) {
    $('load-error').replaceChildren(node('p', `${error.message} Use “Como ler os dados” para tentar recarregar.`)); $('load-error').hidden = false;
    $('publication-date').textContent = data ? `A atualização falhou. Continua visível a publicação de ${timestamp(data.updatedAt)}.` : 'Não foi possível carregar os dados.';
    if (!data) { $('coverage').textContent = 'Nenhum total eleitoral foi carregado.'; $('party-chart').replaceChildren(node('p', 'Gráfico indisponível até o carregamento da fonte.', 'chart-placeholder')); $('resource-totals').replaceChildren(node('p', 'Totais por origem indisponíveis até o carregamento da fonte.', 'empty-value')); }
  } finally { $('reload').disabled = false; }
}
function render() {
  if (!data) return;
  let minimum;
  try {
    const value = $('minimum-value').value.trim();
    if (value.startsWith('-')) throw new Error('O valor mínimo deve ser zero ou positivo.');
    if (value && !/^-?[\d.,]+$/.test(value)) throw new Error('Informe um valor em reais, como 100.000,00.');
    minimum = moneyToCents(value) ?? 0;
    if (minimum < 0) throw new Error('O valor mínimo deve ser zero ou positivo.');
    $('minimum-value').setAttribute('aria-invalid', 'false'); $('minimum-error').hidden = true;
  } catch (error) {
    $('minimum-value').setAttribute('aria-invalid', 'true'); $('minimum-error').textContent = error.message; $('minimum-error').hidden = false; return;
  }
  const filters = { uf: $('uf').value, sphere: $('sphere').value, type: $('statement-type').value, minimumCents: minimum, minimumKind: $('minimum-kind').value };
  if ($('turn').value !== '*') filters.turn = $('turn').value;
  result = aggregateParties(data, filters);
  $('filter-context').textContent = [$('uf').selectedOptions[0].textContent, $('sphere').selectedOptions[0].textContent, $('statement-type').selectedOptions[0].textContent, ...($('turn-control').hidden ? [] : [$('turn').selectedOptions[0].textContent]), ...(minimum > 0 ? [`${$('minimum-kind').selectedOptions[0].textContent} ≥ ${money(minimum)}`] : [])].join(' · ');
  const types = Object.entries(result.types).map(([type, count]) => `${type}: ${number(count)}`).join(' · ');
  const dates = result.firstDate ? `Prestações de ${result.firstDate} a ${result.lastDate}.` : 'Datas de prestação não disponíveis.';
  $('coverage').textContent = `${number(result.parties.length)} partidos · ${number(result.accounts)} contas de órgãos. ${dates} ${types}` + (result.undated ? ` · ${number(result.undated)} sem data informada.` : '');
  for (const [kind, total] of Object.entries(result.totals)) {
    $(`total-${kind}`).textContent = total.available ? money(total.count ? total.knownCents : null) + (total.missing ? ' *' : '') : 'Não disponível';
    $(`note-${kind}`).textContent = totalsNote(total);
  }
  const field = compositionField;
  const totals = Object.entries(TABLES).map(([kind, definition], i) => ({ key: kind, kind, label: definition.label === 'Receitas' ? 'Receita declarada' : definition.label, color: colors[i] }));
  series = [...totals];
  series.push(...result.categories[field].map((name) => ({ key: `${field}:${name}`, field, name, label: name, color: categoryColors[field].get(name) })));
  $('chart-title').textContent = field === 'sources' ? 'Totais e fontes dos recursos, por partido' : 'Totais e origens da verba, por partido';
  $('chart-note').textContent = `Cada partido tem três colunas: receita declarada, despesas contratadas e despesas pagas. As faixas horizontais dentro da receita mostram sua composição por ${field === 'sources' ? 'fonte' : 'origem'}. Toque ou passe o mouse para ver o valor exato; clique na sigla para abrir o partido.`;
  renderResourceTotals(); renderLegend(); renderChart(); renderTable();
  $('bar-detail').textContent = 'Selecione uma coluna para consultar o valor declarado.';
}
function renderResourceTotals() {
  const field = compositionField;
  $('resource-title').textContent = field === 'sources' ? 'Composição por fonte dos recursos' : 'Composição por origem da verba';
  const container = $('resource-totals'); container.replaceChildren();
  container.hidden = hiddenSeries.has('receipts');
  $('resource-title').hidden = container.hidden;
  const groups = result[field];
  if (!groups.length) { container.append(node('p', result.totals.receipts.available ? 'Sem lançamentos de receita neste recorte.' : 'Tabela de receitas não disponível na fonte.', 'empty-value')); return; }
  const total = result.totals.receipts;
  if (!canStack(groups, total.knownCents)) { container.append(node('p', 'Consulte os valores por categoria na tabela.', 'empty-value')); return; }
  for (const group of groups.filter((group) => group.cents > 0)) {
    const segment = node('button', undefined, 'resource-segment'); segment.type = 'button';
    segment.style.width = `${group.cents / total.knownCents * 100}%`;
    segment.style.backgroundColor = hiddenSeries.has(`${field}:${group.name}`) ? '#dce5e8' : categoryColors[field].get(group.name);
    const label = `${group.name}: ${exact(group)}`; segment.title = label; segment.setAttribute('aria-label', label);
    const show = () => { $('bar-detail').textContent = `Todos os partidos · ${label}`; };
    segment.addEventListener('pointerenter', show); segment.addEventListener('focus', show); segment.addEventListener('click', show);
    container.append(segment);
  }
}
function canStack(groups, cents) {
  return cents > 0 && groups.every((group) => group.cents >= 0) && groups.reduce((sum, group) => sum + group.cents, 0) === cents;
}
function renderLegend() {
  $('legend').replaceChildren();
  function control(item, parent = false) {
    const button = node('button', undefined, 'legend-item'); button.type = 'button'; button.setAttribute('aria-pressed', String(!hiddenSeries.has(item.key)));
    button.dataset.seriesKey = item.key;
    if (parent) button.classList.add('legend-parent');
    else if (hiddenSeries.has('receipts')) { button.disabled = true; button.setAttribute('aria-pressed', 'false'); }
    const dot = node('span', undefined, 'legend-dot'); dot.style.backgroundColor = item.color; dot.setAttribute('aria-hidden', 'true');
    const check = node('span', !hiddenSeries.has(item.key) && !button.disabled ? '✓' : '', 'legend-check'); check.setAttribute('aria-hidden', 'true');
    button.append(check, dot, document.createTextNode(item.label));
    button.addEventListener('click', () => {
      if (hiddenSeries.has(item.key)) hiddenSeries.delete(item.key); else hiddenSeries.add(item.key);
      renderResourceTotals(); renderLegend(); renderChart(); renderTable();
      $('bar-detail').textContent = 'Selecione uma coluna ou faixa para consultar o valor declarado.';
      [...$('legend').querySelectorAll('button')].find((control) => control.dataset.seriesKey === item.key)?.focus({ preventScroll: true });
    });
    return button;
  }
  for (const item of series.filter((item) => item.kind)) {
    const group = node('div', undefined, 'legend-category'); group.setAttribute('role', 'group'); group.setAttribute('aria-label', item.label);
    group.style.setProperty('--category-color', item.color);
    group.dataset.category = item.kind;
    const parent = control(item, true); group.append(parent);
    if (item.kind === 'receipts') {
      const choice = node('fieldset', undefined, 'legend-composition'); choice.append(node('legend', 'Composição das receitas', 'sr-only'));
      for (const [field, label] of [['origins', 'Origens da verba'], ['sources', 'Fontes dos recursos']]) {
        const option = node('label'); const input = node('input'); input.type = 'radio'; input.name = 'receipt-composition'; input.value = field;
        input.checked = compositionField === field; input.disabled = hiddenSeries.has('receipts');
        input.addEventListener('change', () => { compositionField = field; render(); [...$('legend').querySelectorAll('input')].find((control) => control.value === field)?.focus({ preventScroll: true }); });
        option.append(input, document.createTextNode(label)); choice.append(option);
      }
      group.append(choice);
      const children = series.filter((item) => !item.kind);
      if (children.length) {
        const nested = node('div', undefined, 'legend-subcategories'); nested.id = 'receipt-subcategories';
        parent.setAttribute('aria-controls', nested.id);
        nested.append(node('p', compositionField === 'sources' ? 'Fontes dos recursos' : 'Origens da verba', 'legend-subtitle'));
        const options = node('div', undefined, 'legend-subcategory-options');
        for (const child of children) options.append(control(child));
        nested.append(options); group.append(nested);
      }
    }
    $('legend').append(group);
  }
}
function showValue(party, item) {
  const value = chartValue(party, item);
  const box = $('bar-detail'); box.replaceChildren(node('strong', `${party.party} · ${item.label}: ${exact(value)}`));
  box.append(document.createTextNode(` · ${number(party.accounts)} órgãos no recorte.`));
}
function renderChart() {
  const container = $('party-chart'); container.replaceChildren();
  const visible = series.filter((item) => item.kind && !hiddenSeries.has(item.key));
  $('chart-scroll-hint').hidden = true;
  if (!result.parties.length || !visible.length) { container.append(node('p', !result.parties.length ? 'Nenhum partido atende aos filtros. Reduza o valor mínimo ou ajuste o recorte.' : 'Ative uma categoria nos filtros do gráfico para exibir as colunas.', 'chart-placeholder')); return; }
  const field = compositionField;
  const width = Math.max(620, result.parties.length * 70 + 106, container.clientWidth);
  $('chart-scroll-hint').hidden = width <= container.clientWidth;
  const height = 480, left = 88, right = 18, top = 28, bottom = 76;
  const values = result.parties.flatMap((party) => visible.map((item) => chartValue(party, item).cents)).filter((value) => value !== null);
  const low = Math.min(0, ...values), high = Math.max(0, ...values);
  const upper = high * 1.1;
  const rawStep = (upper - low || 100) / 5, power = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 5, 10].map((n) => n * power).find((n) => n >= rawStep) || power * 10;
  const min = Math.floor(low / step) * step, max = upper || (low < 0 ? 0 : step);
  const y = (value) => top + (max - value) / (max - min) * (height - top - bottom);
  const svg = svgNode('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'group', 'aria-label': 'Três totais por partido, em reais. A coluna de receitas contém faixas horizontais por origem ou fonte.' });
  const defs = svgNode('defs'); const pattern = svgNode('pattern', { id: 'partial-hatch', width: 6, height: 6, patternUnits: 'userSpaceOnUse' });
  pattern.append(svgNode('path', { d: 'M-1,1 l2,-2 M0,6 l6,-6 M5,7 l2,-2', stroke: '#fff', 'stroke-width': 1.4 })); defs.append(pattern); svg.append(defs);
  const ticks = [];
  for (let tick = min; tick < max - step / 4; tick += step) ticks.push(tick);
  ticks.push(max);
  for (const tick of ticks) {
    svg.append(svgNode('line', { x1: left, x2: width - right, y1: y(tick), y2: y(tick), class: 'chart-grid' }), svgNode('text', { x: left - 10, y: y(tick) + 4, 'text-anchor': 'end', class: 'chart-axis' }, `R$ ${compact.format(tick / 100)}`));
  }
  const plotWidth = width - left - right, slot = plotWidth / result.parties.length;
  const barWidth = Math.min(22, (slot - 18) / visible.length);
  for (let index = 0; index < result.parties.length; index++) {
    const party = result.parties[index];
    const start = left + index * slot + (slot - visible.length * barWidth) / 2;
    if (index % 2 === 0) svg.append(svgNode('rect', { x: left + index * slot, y: top, width: slot, height: height - top - bottom, fill: '#103d4604', 'pointer-events': 'none' }));
    for (let i = 0; i < visible.length; i++) {
      const item = visible[i], value = chartValue(party, item);
      const barX = start + i * barWidth;
      const label = `${party.party}, ${item.label}: ${exact(value)}`;
      const column = svgNode('g', { class: 'party-column', 'data-series': item.kind, 'data-party': party.party });
      column.append(svgNode('rect', { x: barX, y: top, width: barWidth, height: height - top - bottom, fill: item.color, class: 'column-highlight', 'aria-hidden': 'true', 'pointer-events': 'none' }));
      const hitArea = svgNode('rect', { x: barX, y: top, width: barWidth, height: height - top - bottom, fill: 'transparent', class: 'column-hit-area', 'aria-hidden': 'true' });
      hitArea.addEventListener('click', () => showValue(party, item)); column.append(hitArea);
      column.addEventListener('pointerenter', () => showValue(party, item));
      let bar, overlay;
      if (value.cents === null) {
        bar = svgNode('text', { x: barX + barWidth / 2, y: y(0) - 3, 'text-anchor': 'middle', class: 'chart-axis party-bar', tabindex: 0, role: 'button', 'aria-label': label }, '—');
      } else {
        const barY = Math.min(y(value.cents), y(0)), barHeight = Math.max(2, Math.abs(y(value.cents) - y(0)));
        const attributes = { x: barX, y: barY, width: barWidth - 2, height: barHeight, fill: item.color, rx: 2, class: 'party-bar', tabindex: 0, role: 'button', 'aria-label': label };
        bar = svgNode('rect', attributes);
        if (value.missing) overlay = svgNode('rect', { ...attributes, class: '', fill: 'url(#partial-hatch)', tabindex: -1, 'aria-hidden': 'true', 'pointer-events': 'none' });
      }
      bar.append(svgNode('title', {}, label));
      bar.addEventListener('pointerenter', () => showValue(party, item)); bar.addEventListener('focus', () => showValue(party, item));
      bar.addEventListener('click', () => showValue(party, item)); bar.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); showValue(party, item); } });
      column.append(bar);
      if (overlay) column.append(overlay);
      if (item.kind === 'receipts' && canStack(party[field], value.cents)) {
        let accumulated = 0;
        for (const group of party[field]) {
          if (group.cents === 0) continue;
          const lower = accumulated; accumulated += group.cents;
          const category = { field, name: group.name, label: group.name };
          const categoryValue = chartValue(party, category);
          const hidden = hiddenSeries.has(`${field}:${group.name}`);
          const attributes = { x: barX, y: y(accumulated), width: barWidth - 2, height: y(lower) - y(accumulated), fill: hidden ? '#dce5e8' : categoryColors[field].get(group.name), class: 'receipt-segment', tabindex: 0, role: 'button', 'aria-label': `${party.party}, ${group.name}: ${exact(categoryValue)}` };
          const segment = svgNode('rect', attributes);
          segment.append(svgNode('title', {}, attributes['aria-label']));
          segment.addEventListener('pointerenter', () => showValue(party, category)); segment.addEventListener('focus', () => showValue(party, category));
          segment.addEventListener('click', () => showValue(party, category)); segment.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); showValue(party, category); } });
          column.append(segment);
          if (group.missing) column.append(svgNode('rect', { ...attributes, fill: 'url(#partial-hatch)', class: '', tabindex: -1, 'aria-hidden': 'true', 'pointer-events': 'none' }));
        }
      }
      svg.append(column);
    }
    const labelX = left + index * slot + slot / 2, labelY = height - bottom + 24;
    const label = svgNode('text', { x: labelX, y: labelY, 'text-anchor': 'middle', class: 'party-label', role: 'button', tabindex: 0, 'aria-label': `Ver totais de ${party.party}` }, party.party);
    label.addEventListener('click', () => showParty(party)); label.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); showParty(party); } }); svg.append(label);
  }
  container.append(svg);
}
function renderTable() {
  const visible = series.filter((item) => !hiddenSeries.has(item.key) && (item.kind || !hiddenSeries.has('receipts')));
  const head = node('tr'); const partyHead = node('th', 'Partido'); partyHead.scope = 'col'; head.append(partyHead);
  for (const item of visible) { const th = node('th', item.label, 'numeric'); th.scope = 'col'; head.append(th); }
  $('values-head').replaceChildren(head); $('values-body').replaceChildren();
  for (const party of result.parties) {
    const row = node('tr'); const name = node('th', party.party); name.scope = 'row'; row.append(name);
    for (const item of visible) row.append(node('td', exact(chartValue(party, item)), 'numeric'));
    $('values-body').append(row);
  }
}
function showParty(party) {
  $('party-title').textContent = party.party;
  $('party-context').textContent = `${party.partyName || ''} · ${number(party.accounts)} órgãos incluídos no recorte.`;
  $('party-totals').replaceChildren();
  for (const [kind, definition] of Object.entries(TABLES)) {
    const block = node('div'); block.append(node('span', definition.label), node('strong', exact(chartValue(party, { kind }))), node('span', totalsNote(party.totals[kind])));
    if (kind === 'receipts') {
      const field = compositionField;
      const breakdown = node('div', undefined, 'receipt-breakdown'); breakdown.append(node('h3', field === 'sources' ? 'Fontes dos recursos' : 'Origens da verba'));
      const maximum = Math.max(1, Math.abs(party.totals.receipts.knownCents), ...party[field].map((group) => Math.abs(group.cents)));
      for (const group of party[field]) {
        const row = node('div', undefined, 'origin-mini-row'); const track = node('div', undefined, 'mini-track'); const fill = node('span');
        fill.style.width = `${Math.abs(group.cents) / maximum * 100}%`; fill.style.backgroundColor = categoryColors[field].get(group.name); track.append(fill);
        row.append(node('span', group.name, 'mini-name'), node('strong', exact(group)), track); breakdown.append(row);
      }
      if (!party[field].length) breakdown.append(node('p', 'Sem lançamentos de receita neste recorte.', 'empty-value'));
      block.append(breakdown);
    }
    $('party-totals').append(block);
  }
  $('party-dialog').showModal();
}
for (const id of ['uf', 'sphere', 'statement-type', 'turn', 'minimum-kind', 'minimum-value']) $(id).addEventListener('change', render);
$('minimum-value').addEventListener('keydown', (event) => { if (event.key === 'Enter') render(); });
$('clear-minimum').addEventListener('click', () => { $('minimum-value').value = ''; render(); $('minimum-value').focus(); });
$('open-methodology').addEventListener('click', () => $('methodology-dialog').showModal());
$('close-methodology').addEventListener('click', () => $('methodology-dialog').close());
$('close-party').addEventListener('click', () => $('party-dialog').close());
$('reload').addEventListener('click', () => { $('methodology-dialog').close(); load(); });
for (const id of ['methodology-dialog', 'party-dialog']) $(id).addEventListener('click', (event) => { const rect = $(id).getBoundingClientRect(); if (event.target === $(id) && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) $(id).close(); });
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (result) renderChart(); }, 150); });
load();
