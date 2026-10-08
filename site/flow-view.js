import { buildFlow } from './flow-data.js';
import { layoutFlow } from './flow-layout.js';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const money = (cents) => brl.format(cents / 100);
const exact = (entry) => entry.available === false ? 'Não disponível' : `${entry.count ? money(entry.cents) : 'Sem lançamentos'}${entry.missing ? ` · parcial (${entry.missing.toLocaleString('pt-BR')} registro(s) sem valor)` : ''}`;
const node = (tag, text, className) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
const svgNode = (tag, attributes = {}, text) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, value);
  if (text !== undefined) el.textContent = text;
  return el;
};
function wrap(text, limit = 36) {
  const lines = []; let line = '';
  for (const word of text.split(/\s+/)) {
    if (line && (line + ' ' + word).length > limit) { lines.push(line); line = word; } else line += (line ? ' ' : '') + word;
  }
  if (line) lines.push(line);
  return lines;
}

export class FlowView {
  constructor(container, colors, options = {}) {
    this.container = container; this.colors = colors; this.options = options;
    this.frames = [{ party: null, expanded: [] }]; this.incoming = 'origins'; this.outgoing = 'paid';
  }
  setData(data) { this.data = data; this.frames = [{ party: null, expanded: [] }]; }
  navigate(context) { this.frames.push(context); this.render(true); }
  selectParty(party) {
    if (!this.data || this.frames.at(-1).party === party) return;
    this.frames.push({ party, expanded: [] }); this.render(true);
  }
  render(focus = false) {
    if (!this.data) return;
    const context = this.frames.at(-1), graph = (this.options.buildGraph || buildFlow)(this.data, { ...context, incoming: this.incoming, outgoing: this.outgoing });
    const outgoingLabel = this.outgoing === 'paid' ? 'Despesas pagas' : 'Despesas contratadas';
    const toolbar = node('div', undefined, 'flow-toolbar');
    const back = node('button', '←', 'mosaic-back'); back.type = 'button'; back.id = 'flow-back'; back.disabled = this.frames.length === 1;
    back.setAttribute('aria-label', 'Voltar um nível no fluxo'); back.title = 'Voltar um nível';
    back.addEventListener('click', () => { this.frames.pop(); this.render(true); });
    const title = node('strong', context.title || context.party || this.options.rootTitle || 'Todos os partidos', 'flow-context'); title.tabIndex = -1;
    toolbar.append(back, title);
    const totals = node('div', undefined, 'flow-totals');
    for (const [label, value] of [['Receitas declaradas', graph.totals.receipts], [outgoingLabel, graph.totals.outgoing]]) {
      const total = node('span'); total.append(node('span', label), node('strong', value.available ? exact(value) : 'Não disponível')); totals.append(total);
    }
    toolbar.append(totals);
    const viewport = node('div', undefined, 'flow-viewport'); viewport.tabIndex = 0; viewport.setAttribute('role', 'region'); viewport.setAttribute('aria-label', `Gráfico de fluxo: origens, ${this.options.entities || 'partidos'} e despesas. Rolagem horizontal em telas pequenas.`);
    this.container.replaceChildren(toolbar, node('p', 'Deslize o gráfico para ver o fluxo completo.', 'flow-scroll-hint'), viewport);
    const layout = layoutFlow(graph, Math.max(1100, viewport.clientWidth));
    const svg = svgNode('svg', { viewBox: `0 0 ${layout.width} ${layout.height}`, class: 'flow-graph', role: 'group', 'aria-label': `${this.incoming === 'origins' ? 'Origens' : 'Fontes'} dos recursos → ${context.title || context.party || this.options.entities || 'Partidos'} → ${outgoingLabel.toLowerCase()}` });
    viewport.append(svg);
    const heading = (x, text, anchor) => svg.append(svgNode('text', { x, y: 24, 'text-anchor': anchor, class: 'flow-column-title' }, text));
    heading(layout.width * .265, this.incoming === 'origins' ? 'Origens dos recursos' : 'Fontes dos recursos', 'end');
    heading(layout.width * .5, graph.centerTitle || 'Partidos', 'middle'); heading(layout.width * .735, outgoingLabel, 'start');
    const paths = svgNode('g', { class: 'flow-links', 'aria-hidden': 'true' }); svg.append(paths);
    for (const entry of graph.columns[1]) if (entry.navigation) this.colors.set(entry.party, entry.navigation.color);
    for (const link of layout.links) {
      paths.append(svgNode('path', { d: link.path, stroke: this.colors.get(link.party) || '#0a695c', 'stroke-width': link.thickness, 'data-source': link.source, 'data-target': link.target, 'data-party': link.party, class: 'flow-link' }));
    }
    const detail = node('p', this.options.instruction || 'Passe o mouse ou toque em um item para ver os valores. Clique em um partido para explorar.', 'mosaic-detail'); detail.setAttribute('role', 'status'); detail.setAttribute('aria-live', 'polite');
    const valueLabel = (entry) => entry.side === 'party' ? `Receitas: ${exact({ ...entry, ...this.partyValue(graph, entry, false) })} · ${outgoingLabel}: ${exact({ ...entry, ...this.partyValue(graph, entry, true) })}` : exact(entry);
    const highlight = (entry) => {
      for (const path of paths.children) path.classList.toggle('is-active', entry.side === 'party' ? path.dataset.party === entry.party : path.dataset.source === entry.id || path.dataset.target === entry.id);
      svg.classList.add('has-highlight'); detail.replaceChildren(node('strong', entry.label), document.createTextNode(` · ${valueLabel(entry)}`));
    };
    this.highlightParty = (party) => { const entry = graph.nodes.find((entry) => entry.party === party); if (entry) highlight(entry); };
    svg.addEventListener('pointerleave', () => svg.classList.remove('has-highlight'));
    for (const entry of layout.nodes) {
      const explore = this.options.canExplore ? this.options.canExplore(entry, context) : !context.party;
      const interactive = entry.side === 'party' && explore || Boolean(entry.children);
      const control = svgNode('g', { tabindex: 0, role: 'button', class: `flow-node${interactive ? ' is-expandable' : ''}`, 'data-flow-id': entry.id, 'data-flow-side': entry.side, 'aria-label': `${entry.label}: ${valueLabel(entry)}${interactive ? '. Abrir detalhes' : ''}` });
      control.append(svgNode('title', {}, `${entry.label}: ${valueLabel(entry)}`));
      const labelLines = wrap(entry.label);
      const hitHeight = Math.max(entry.height, (labelLines.length + (entry.children ? 1 : 0)) * 14 + 20, 28);
      control.append(svgNode('rect', { x: entry.x - (entry.side === 'incoming' ? 285 : 4), y: entry.labelY - hitHeight / 2, width: entry.side === 'party' ? entry.navigation ? 230 : 120 : 290, height: hitHeight, class: 'flow-hit' }));
      if (entry.height > 0) control.append(svgNode('rect', { x: entry.x, y: entry.y, width: 12, height: entry.height, rx: 2, fill: entry.side === 'party' ? this.colors.get(entry.party) : entry.side === 'incoming' ? '#0a695c' : '#ae803d', class: 'flow-bar' }));
      const x = entry.side === 'incoming' ? entry.x - 12 : entry.x + 24, anchor = entry.side === 'incoming' ? 'end' : 'start';
      const text = svgNode('text', { x, y: entry.labelY - (labelLines.length - 1) * 7 - 4, 'text-anchor': anchor, class: `flow-node-label${entry.side === 'party' ? ' flow-party-label' : ''}` });
      for (const [index, line] of labelLines.entries()) text.append(svgNode('tspan', { x, dy: index ? 14 : 0 }, line));
      if (entry.children) text.append(svgNode('tspan', { x, dy: 14, class: 'flow-expand-label' }, 'Abrir detalhes ›'));
      if (entry.side !== 'party') text.append(svgNode('tspan', { x, dy: 16, class: 'flow-node-value' }, exact(entry)));
      control.append(text);
      const activate = () => {
        highlight(entry);
        if (entry.children) { this.frames.push({ ...context, expanded: [...context.expanded, entry.expandSide] }); this.render(true); }
        else if (entry.side === 'party' && explore) { if (this.options.nextContext) this.navigate(this.options.nextContext(entry)); else this.selectParty(entry.party); }
      };
      control.addEventListener('pointerenter', () => highlight(entry)); control.addEventListener('focus', () => highlight(entry)); control.addEventListener('click', activate);
      control.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); } }); svg.append(control);
    }
    this.container.append(detail);
    if (!graph.totals.receipts.available || !graph.totals.outgoing.available) this.container.append(node('p', 'Uma das tabelas não está disponível na fonte. Os valores disponíveis continuam visíveis.', 'mosaic-note'));
    if (graph.categoriesUnavailable) this.container.append(node('p', 'Esta publicação ainda não detalha as categorias. Atualize após a próxima publicação para vê-las.', 'mosaic-note'));
    if (graph.hasNegative) this.container.append(node('p', 'Há valores negativos neste recorte. As ligações foram omitidas; selecione os itens para consultar os valores com seus sinais.', 'mosaic-note'));
    if (graph.missing) this.container.append(node('p', `Soma parcial: ${graph.missing.toLocaleString('pt-BR')} registro(s) sem valor.`, 'mosaic-note'));
    if (!layout.links.length && !graph.hasNegative) this.container.append(node('p', 'Nenhum valor positivo disponível para desenhar ligações neste recorte.', 'mosaic-note'));
    this.container.append(node('p', this.options.note || 'Valores brutos declarados. As ligações mostram receitas e despesas agregadas; não identificam qual receita financiou cada despesa. Repasses entre órgãos podem reaparecer como receita.', 'mosaic-note'));
    if (focus) title.focus({ preventScroll: true });
  }
  partyValue(graph, entry, outgoing) {
    const edges = graph.links.filter((edge) => outgoing ? edge.source === entry.id : edge.target === entry.id);
    return { available: outgoing ? graph.totals.outgoing.available : graph.totals.receipts.available, cents: outgoing ? entry.outCents : entry.inCents, count: edges.reduce((sum, edge) => sum + edge.count, 0), missing: edges.reduce((sum, edge) => sum + edge.missing, 0) };
  }
}
