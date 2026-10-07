import { json } from './published.js';
import { config } from './config.js';
import { aggregateParties, chartValue } from './party-overview.js';
import { TABLES } from './data.js';

const $ = (id) => document.getElementById(id);
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
const number = (value) => value.toLocaleString('pt-BR');
const money = (cents) => cents === null ? 'Sem lançamentos' : brl.format(cents / 100);
const timestamp = (value) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(value)) + ' (Brasília)';
const colors = ['#167866', '#3c71b1', '#cd7b32', '#8952a5', '#c54870', '#608b38', '#af9830', '#447f92', '#8a6451', '#5d64a6', '#bc5e44', '#597463', '#707981'];
let data, result, series = [];
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
    fillSelect('uf', data.options.uf, '', 'Todo o Brasil');
    fillSelect('sphere', data.options.sphere, '', 'Todas as esferas');
    fillSelect('statement-type', data.options.type, 'latest', 'Última de cada órgão');
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
    if (!data) { $('coverage').textContent = 'Nenhum total eleitoral foi carregado.'; $('party-chart').replaceChildren(node('p', 'Gráfico indisponível até o carregamento da fonte.', 'chart-placeholder')); }
  } finally { $('reload').disabled = false; }
}
function render() {
  if (!data) return;
  const filters = { uf: $('uf').value, sphere: $('sphere').value, type: $('statement-type').value };
  if ($('turn').value !== '*') filters.turn = $('turn').value;
  result = aggregateParties(data, filters);
  const types = Object.entries(result.types).map(([type, count]) => `${type}: ${number(count)}`).join(' · ');
  const dates = result.firstDate ? `Prestações de ${result.firstDate} a ${result.lastDate}.` : 'Datas de prestação não disponíveis.';
  $('coverage').textContent = `${number(result.parties.length)} partidos · ${number(result.accounts)} contas de órgãos. ${dates} ${types}` + (result.undated ? ` · ${number(result.undated)} sem data informada.` : '');
  for (const [kind, total] of Object.entries(result.totals)) {
    $(`total-${kind}`).textContent = total.available ? money(total.count ? total.knownCents : null) + (total.missing ? ' *' : '') : 'Não disponível';
    $(`note-${kind}`).textContent = totalsNote(total);
  }
  const view = $('chart-view').value;
  series = Object.entries(TABLES).map(([kind, definition], i) => ({ key: kind, kind, label: definition.label === 'Receitas' ? 'Receita declarada' : definition.label, color: colors[i] }));
  if (view !== 'totals') {
    const field = view === 'sources' ? 'sources' : 'origins';
    series.push(...result.categories[field].map((name, i) => ({ key: `${field}:${name}`, field, name, label: name, color: colors[(i + 3) % colors.length] })));
  }
  $('chart-title').textContent = view === 'totals' ? 'Receitas, contratado e pago, por partido' : view === 'sources' ? 'Totais e fontes dos recursos, por partido' : 'Totais e origens da verba, por partido';
  renderLegend(); renderChart(); renderTable();
  $('bar-detail').textContent = 'Selecione uma coluna para consultar o valor declarado.';
}
function renderLegend() {
  $('legend').replaceChildren();
  for (const item of series) {
    const button = node('button', undefined, 'legend-item'); button.type = 'button'; button.setAttribute('aria-pressed', String(!hiddenSeries.has(item.key)));
    const dot = node('span', undefined, 'legend-dot'); dot.style.backgroundColor = item.color; dot.setAttribute('aria-hidden', 'true');
    button.append(dot, document.createTextNode(item.label));
    button.addEventListener('click', () => { if (hiddenSeries.has(item.key)) hiddenSeries.delete(item.key); else hiddenSeries.add(item.key); renderLegend(); renderChart(); renderTable(); });
    $('legend').append(button);
  }
}
function showValue(party, item) {
  const value = chartValue(party, item);
  const box = $('bar-detail'); box.replaceChildren(node('strong', `${party.party} · ${item.label}: ${exact(value)}`));
  box.append(document.createTextNode(` · ${number(party.accounts)} órgãos no recorte.`));
}
function renderChart() {
  const container = $('party-chart'); container.replaceChildren();
  const visible = series.filter((item) => !hiddenSeries.has(item.key));
  if (!result.parties.length || !visible.length) { container.append(node('p', !result.parties.length ? 'Nenhuma conta de órgão neste recorte. Experimente outro estado, esfera ou tipo de prestação.' : 'Ative uma série na legenda para exibir as colunas.', 'chart-placeholder')); return; }
  const width = Math.max(1050, result.parties.length * 30 + 105, $('party-chart').clientWidth);
  const height = 480, left = 88, right = 18, top = 28, bottom = 108;
  const values = result.parties.flatMap((party) => visible.map((item) => chartValue(party, item).cents)).filter((value) => value !== null);
  const low = Math.min(0, ...values), high = Math.max(0, ...values);
  const rawStep = (high - low || 100) / 5, power = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 5, 10].map((n) => n * power).find((n) => n >= rawStep) || power * 10;
  const min = Math.floor(low / step) * step, max = Math.ceil(high / step) * step || step;
  const y = (value) => top + (max - value) / (max - min) * (height - top - bottom);
  const svg = svgNode('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'group', 'aria-label': 'Colunas agrupadas por partido. Valores em reais. As origens compõem a receita declarada.' });
  const defs = svgNode('defs'); const pattern = svgNode('pattern', { id: 'partial-hatch', width: 6, height: 6, patternUnits: 'userSpaceOnUse' });
  pattern.append(svgNode('path', { d: 'M-1,1 l2,-2 M0,6 l6,-6 M5,7 l2,-2', stroke: '#fff', 'stroke-width': 1.4 })); defs.append(pattern); svg.append(defs);
  svg.append(svgNode('text', { x: left, y: 14, class: 'chart-axis' }, 'Valores em R$'));
  for (let tick = min; tick <= max + step / 100; tick += step) {
    svg.append(svgNode('line', { x1: left, x2: width - right, y1: y(tick), y2: y(tick), class: 'chart-grid' }), svgNode('text', { x: left - 10, y: y(tick) + 4, 'text-anchor': 'end', class: 'chart-axis' }, compact.format(tick / 100)));
  }
  const plotWidth = width - left - right, slot = plotWidth / result.parties.length;
  const barWidth = Math.min(19, (slot - 8) / visible.length);
  for (let index = 0; index < result.parties.length; index++) {
    const party = result.parties[index];
    const start = left + index * slot + (slot - visible.length * barWidth) / 2;
    for (let i = 0; i < visible.length; i++) {
      const item = visible[i], value = chartValue(party, item);
      const label = `${party.party}, ${item.label}: ${exact(value)}`;
      let bar, overlay;
      if (value.cents === null) {
        bar = svgNode('text', { x: start + i * barWidth + barWidth / 2, y: y(0) - 3, 'text-anchor': 'middle', class: 'chart-axis party-bar', tabindex: 0, role: 'button', 'aria-label': label }, '—');
      } else {
        const barY = Math.min(y(value.cents), y(0)), barHeight = Math.max(2, Math.abs(y(value.cents) - y(0)));
        const attributes = { x: start + i * barWidth, y: barY, width: Math.max(1.5, barWidth - .6), height: barHeight, fill: item.color, rx: 1, class: 'party-bar', tabindex: 0, role: 'button', 'aria-label': label };
        bar = svgNode('rect', attributes);
        if (value.missing) overlay = svgNode('rect', { ...attributes, class: '', fill: 'url(#partial-hatch)', tabindex: -1, 'aria-hidden': 'true', 'pointer-events': 'none' });
      }
      bar.append(svgNode('title', {}, label));
      bar.addEventListener('pointerenter', () => showValue(party, item)); bar.addEventListener('focus', () => showValue(party, item));
      bar.addEventListener('click', () => showValue(party, item)); bar.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); showValue(party, item); } });
      svg.append(bar);
      if (overlay) svg.append(overlay);
    }
    const labelX = left + index * slot + slot / 2 + 4, labelY = height - bottom + 20;
    const label = svgNode('text', { x: labelX, y: labelY, transform: `rotate(-45 ${labelX} ${labelY})`, 'text-anchor': 'end', class: 'party-label', role: 'button', tabindex: 0, 'aria-label': `Ver totais de ${party.party}` }, party.party);
    label.addEventListener('click', () => showParty(party)); label.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); showParty(party); } }); svg.append(label);
  }
  container.append(svg);
}
function renderTable() {
  const visible = series.filter((item) => !hiddenSeries.has(item.key));
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
  for (const [kind, definition] of Object.entries(TABLES)) { const block = node('div'); block.append(node('span', definition.label), node('strong', exact(chartValue(party, { kind }))), node('span', totalsNote(party.totals[kind]))); $('party-totals').append(block); }
  $('party-origins').replaceChildren();
  const maximum = Math.max(1, ...party.origins.map((group) => Math.abs(group.cents)));
  for (const group of party.origins) {
    const row = node('div', undefined, 'origin-mini-row'); const track = node('div', undefined, 'mini-track'); const fill = node('span'); fill.style.width = `${Math.abs(group.cents) / maximum * 100}%`; track.append(fill);
    row.append(node('span', group.name, 'mini-name'), node('strong', exact({ cents: group.cents, missing: group.missing })), track); $('party-origins').append(row);
  }
  if (!party.origins.length) $('party-origins').append(node('p', 'Sem lançamentos de receita neste recorte.', 'empty-value'));
  $('party-dialog').showModal();
}
for (const id of ['uf', 'sphere', 'statement-type', 'turn', 'chart-view']) $(id).addEventListener('change', render);
$('open-methodology').addEventListener('click', () => $('methodology-dialog').showModal());
$('close-methodology').addEventListener('click', () => $('methodology-dialog').close());
$('close-party').addEventListener('click', () => $('party-dialog').close());
$('reload').addEventListener('click', () => { $('methodology-dialog').close(); load(); });
for (const id of ['methodology-dialog', 'party-dialog']) $(id).addEventListener('click', (event) => { const rect = $(id).getBoundingClientRect(); if (event.target === $(id) && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) $(id).close(); });
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (result) renderChart(); }, 150); });
load();
