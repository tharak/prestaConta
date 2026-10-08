import { FlowView } from './flow-view.js';
import { buildFlow } from './flow-data.js';
import { layoutNetwork, networkPath, networkLineWidths } from './network-layout.js';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const exact = (entry) => entry.available === false ? 'Não disponível' : `${entry.count ? brl.format(entry.cents / 100) : 'Sem lançamentos'}${entry.missing ? ` · parcial (${entry.missing.toLocaleString('pt-BR')} registro(s) sem valor)` : ''}`;
const node = (tag, text, className) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
const svgNode = (tag, attrs = {}, text) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  if (text !== undefined) el.textContent = text;
  return el;
};
function labelLines(label) {
  const lines = [''];
  for (const word of label.split(/\s+/)) {
    if ((lines.at(-1) + ' ' + word).trim().length > 23 && lines.at(-1)) lines.push('');
    lines[lines.length - 1] += (lines.at(-1) ? ' ' : '') + word;
  }
  return lines.slice(0, 3).map((line, i) => i === 2 && lines.length > 3 ? line + '…' : line);
}

export class NetworkView extends FlowView {
  setData(data) { super.setData(data); this.layouts = new WeakMap(); }
  render(focus = false) {
    if (!this.data) return;
    const context = this.frames.at(-1), graph = (this.options.buildGraph || buildFlow)(this.data, { ...context, incoming: this.incoming, outgoing: this.outgoing });
    const key = `${this.incoming}:${this.outgoing}`;
    if (!this.layouts.has(context)) this.layouts.set(context, new Map());
    const cached = this.layouts.get(context);
    if (!cached.has(key)) cached.set(key, { layout: layoutNetwork(graph), camera: null });
    const state = cached.get(key), { layout } = state;
    const lineWidths = networkLineWidths(layout.links);
    const byId = new Map(layout.nodes.map((entry) => [entry.id, entry]));
    const outgoingLabel = this.outgoing === 'paid' ? 'Despesas pagas' : 'Despesas contratadas';
    const toolbar = node('div', undefined, 'flow-toolbar');
    const back = node('button', '←', 'mosaic-back'); back.type = 'button'; back.id = 'network-back'; back.disabled = this.frames.length === 1;
    back.setAttribute('aria-label', 'Voltar um nível no grafo'); back.title = 'Voltar um nível';
    back.addEventListener('click', () => { this.frames.pop(); this.render(true); });
    const title = node('strong', context.title || context.party || this.options.rootTitle || 'Todos os partidos', 'flow-context'); title.tabIndex = -1;
    const totals = node('div', undefined, 'flow-totals');
    for (const [label, value] of [['Receitas declaradas', graph.totals.receipts], [outgoingLabel, graph.totals.outgoing]]) {
      const total = node('span'); total.append(node('span', label), node('strong', exact(value))); totals.append(total);
    }
    toolbar.append(back, title, totals);
    const viewport = node('div', undefined, 'network-viewport');
    const svg = svgNode('svg', { class: 'network-graph', role: 'group', tabindex: 0, 'aria-label': 'Grafo de relações financeiras. Setas indicam entradas e saídas. Use mais e menos para ampliar, setas para mover e zero para ajustar.' });
    const tools = node('div', undefined, 'network-tools'); tools.setAttribute('role', 'group'); tools.setAttribute('aria-label', 'Zoom do grafo');
    const zoomLabel = node('span', '', 'network-zoom');
    const tool = (label, accessible, action) => { const button = node('button', label); button.type = 'button'; button.setAttribute('aria-label', accessible); button.title = accessible; button.addEventListener('click', action); tools.append(button); return button; };
    const detail = node('p', 'Selecione um nó ou uma ligação para ver os valores. Arraste para mover; clique nos nós com + para explorar.', 'mosaic-detail'); detail.setAttribute('role', 'status'); detail.setAttribute('aria-live', 'polite');
    viewport.append(svg, tools);
    this.container.replaceChildren(toolbar, viewport, detail);
    const width = viewport.clientWidth || 1000, height = viewport.clientHeight || 620;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const defs = svgNode('defs'), marker = svgNode('marker', { id: 'network-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 8, markerHeight: 8, markerUnits: 'userSpaceOnUse', orient: 'auto-start-reverse' });
    marker.append(svgNode('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: 'context-stroke' })); defs.append(marker); svg.append(defs);
    const world = svgNode('g'), edges = svgNode('g', { class: 'network-edges' }), nodes = svgNode('g', { class: 'network-nodes' });
    world.append(edges, nodes); svg.append(world);
    let camera = state.camera;
    const transform = () => { state.camera = camera; world.setAttribute('transform', `translate(${camera.x} ${camera.y}) scale(${camera.k})`); zoomLabel.textContent = `${Math.round(camera.k * 100)}%`; };
    const fit = () => {
      const minX = Math.min(0, ...layout.nodes.map((entry) => entry.x - 105)), maxX = Math.max(layout.width, ...layout.nodes.map((entry) => entry.x + 105));
      const minY = Math.min(0, ...layout.nodes.map((entry) => entry.y - entry.radius - 10)), maxY = Math.max(layout.height, ...layout.nodes.map((entry) => entry.y + entry.radius + 60));
      const k = Math.min((width - 32) / (maxX - minX), (height - 48) / (maxY - minY));
      camera = { k, x: (width - (maxX + minX) * k) / 2, y: (height - (maxY + minY) * k) / 2, width, height }; transform();
    };
    const zoom = (factor, x = width / 2, y = height / 2) => {
      const k = Math.max(.08, Math.min(5, camera.k * factor)), ratio = k / camera.k;
      camera = { ...camera, k, x: x - (x - camera.x) * ratio, y: y - (y - camera.y) * ratio }; transform();
    };
    tool('+', 'Ampliar grafo', () => zoom(1.3)); tool('−', 'Reduzir grafo', () => zoom(1 / 1.3)); tool('Ajustar', 'Ajustar grafo à tela', fit); tools.append(zoomLabel);
    if (!camera || camera.width !== width || camera.height !== height) fit(); else transform();
    const edgeControls = [], nodeControls = new Map();
    const valueLabel = (entry) => entry.side === 'party' ? `Receitas: ${exact(this.partyValue(graph, entry, false))} · ${outgoingLabel}: ${exact(this.partyValue(graph, entry, true))}` : exact(entry);
    const highlight = (entry, edge = false) => {
      const related = edge ? new Set([entry.source, entry.target]) : new Set([entry.id]);
      for (const item of edgeControls) {
        const active = edge ? item.entry.id === entry.id : item.entry.source === entry.id || item.entry.target === entry.id;
        item.control.classList.toggle('is-active', active);
        if (active) { related.add(item.entry.source); related.add(item.entry.target); }
      }
      for (const [id, control] of nodeControls) control.classList.toggle('is-active', related.has(id));
      svg.classList.add('has-highlight');
      const label = edge ? `${byId.get(entry.source).label} → ${byId.get(entry.target).label}` : entry.label;
      detail.replaceChildren(node('strong', label), document.createTextNode(` · ${edge ? exact(entry) : valueLabel(entry)}`));
    };
    this.highlightParty = (party) => { const entry = layout.nodes.find((entry) => entry.party === party); if (entry) highlight(entry); };
    const clear = () => svg.classList.remove('has-highlight');
    const redraw = () => {
      for (const entry of layout.nodes) nodeControls.get(entry.id)?.setAttribute('transform', `translate(${entry.x} ${entry.y})`);
      for (const item of edgeControls) for (const path of item.control.querySelectorAll('path')) path.setAttribute('d', networkPath(byId.get(item.entry.source), byId.get(item.entry.target)));
    };
    for (const entry of layout.nodes) if (entry.navigation) this.colors.set(entry.party, entry.navigation.color);
    for (const entry of layout.links) {
      const label = `${byId.get(entry.source).label} → ${byId.get(entry.target).label}: ${exact(entry)}`;
      const control = svgNode('g', { class: `network-edge${entry.cents < 0 ? ' is-negative' : ''}`, tabindex: 0, role: 'button', 'data-network-edge': entry.id, 'aria-label': label });
      const thickness = lineWidths.widths.get(entry.id);
      control.append(svgNode('title', {}, label), svgNode('path', { class: 'network-edge-hit', fill: 'none', 'stroke-width': 16 }), svgNode('path', { class: 'network-edge-line', fill: 'none', stroke: this.colors.get(entry.party) || '#367c72', 'stroke-width': thickness, ...(thickness ? { 'marker-end': 'url(#network-arrow)' } : {}) }));
      control.addEventListener('pointerenter', () => highlight(entry, true)); control.addEventListener('focus', () => highlight(entry, true)); control.addEventListener('click', () => highlight(entry, true));
      control.addEventListener('keydown', (event) => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); highlight(entry, true); } });
      edgeControls.push({ entry, control }); edges.append(control);
    }
    for (const entry of layout.nodes) {
      const explore = entry.side === 'party' && (this.options.canExplore ? this.options.canExplore(entry, context) : !context.party), interactive = explore || Boolean(entry.children);
      const control = svgNode('g', { tabindex: 0, role: 'button', class: 'network-node', 'data-network-id': entry.id, 'data-network-side': entry.side, 'aria-label': `${entry.label}: ${valueLabel(entry)}${interactive ? '. Abrir detalhes' : ''}` });
      control.append(svgNode('title', {}, `${entry.label}: ${valueLabel(entry)}`), svgNode('rect', { x: -94, y: -entry.radius - 8, width: 188, height: entry.radius * 2 + 64, rx: 6, class: 'network-node-hit' }), svgNode('circle', { r: entry.radius + 6, class: 'network-halo' }), svgNode('circle', { r: entry.radius, fill: entry.side === 'party' ? this.colors.get(entry.party) || '#367c72' : entry.side === 'incoming' ? '#0a695c' : '#ae803d', class: 'network-dot' }));
      if (interactive) control.append(svgNode('text', { 'text-anchor': 'middle', y: 5, style: `font-size:${Math.min(16, entry.radius * 1.4)}px`, class: 'network-plus' }, '+'));
      const text = svgNode('text', { y: entry.radius + 18, 'text-anchor': 'middle', class: 'network-label' });
      labelLines(entry.label).forEach((line, index) => text.append(svgNode('tspan', { x: 0, dy: index ? 16 : 0 }, line))); control.append(text);
      const activate = () => {
        highlight(entry);
        if (entry.children) this.navigate({ ...context, expanded: [...context.expanded, entry.expandSide] });
        else if (explore) { if (this.options.nextContext) this.navigate(this.options.nextContext(entry)); else this.selectParty(entry.party); }
      };
      control.addEventListener('pointerenter', () => highlight(entry)); control.addEventListener('focus', () => {
        highlight(entry);
        const x = camera.x + entry.x * camera.k, y = camera.y + entry.y * camera.k;
        if (x < 80 || x > width - 80 || y < 80 || y > height - 80) { camera.x = width / 2 - entry.x * camera.k; camera.y = height / 2 - entry.y * camera.k; transform(); }
      });
      control.addEventListener('click', (event) => { if (this.suppressClick) { this.suppressClick = false; event.preventDefault(); return; } activate(); });
      control.addEventListener('keydown', (event) => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); activate(); } });
      nodes.append(control); nodeControls.set(entry.id, control);
    }
    redraw();
    const point = (event) => { const rect = svg.getBoundingClientRect(); return { x: (event.clientX - rect.left) * width / rect.width, y: (event.clientY - rect.top) * height / rect.height }; };
    const pointers = new Map(); let gesture;
    const begin = () => {
      const touches = [...pointers.values()];
      if (touches.length > 1) {
        const [a, b] = touches; gesture = { type: 'pinch', distance: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, camera: { ...camera } };
      } else if (touches.length) { const a = touches[0]; gesture = { type: a.node ? 'node' : 'pan', point: a, camera: { ...camera }, node: a.node, startX: a.node?.x, startY: a.node?.y, moved: false }; }
      else gesture = null;
    };
    svg.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      if (!pointers.size) this.suppressClick = false;
      const id = event.target.closest('[data-network-id]')?.getAttribute('data-network-id');
      const capture = event.target.closest('[data-network-id], [data-network-edge]') || svg;
      pointers.set(event.pointerId, { ...point(event), node: byId.get(id), capture }); begin(); capture.setPointerCapture(event.pointerId);
    });
    svg.addEventListener('pointermove', (event) => {
      if (!pointers.has(event.pointerId) || !gesture) return;
      const p = point(event); pointers.set(event.pointerId, { ...pointers.get(event.pointerId), ...p });
      if (gesture.type === 'pinch') {
        const [a, b] = [...pointers.values()], distance = Math.hypot(a.x - b.x, a.y - b.y), x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
        camera = { ...gesture.camera }; zoom(distance / Math.max(1, gesture.distance), gesture.x, gesture.y); camera.x += x - gesture.x; camera.y += y - gesture.y; transform(); this.suppressClick = true;
      } else {
        const dx = p.x - gesture.point.x, dy = p.y - gesture.point.y;
        if (Math.hypot(dx, dy) > 4) gesture.moved = true;
        if (!gesture.moved) return;
        this.suppressClick = true;
        if (gesture.type === 'node') {
          const control = nodeControls.get(gesture.node.id);
          if (nodes.lastElementChild !== control) { nodes.append(control); control.setPointerCapture(event.pointerId); }
          gesture.node.x = gesture.startX + dx / camera.k; gesture.node.y = gesture.startY + dy / camera.k; redraw();
        }
        else { camera = { ...gesture.camera, x: gesture.camera.x + dx, y: gesture.camera.y + dy }; transform(); }
      }
    });
    const finish = (event) => { const capture = pointers.get(event.pointerId)?.capture; pointers.delete(event.pointerId); if (capture?.hasPointerCapture(event.pointerId)) capture.releasePointerCapture(event.pointerId); begin(); };
    svg.addEventListener('pointerup', finish); svg.addEventListener('pointercancel', finish);
    svg.addEventListener('pointerleave', () => { if (!pointers.size) clear(); });
    svg.addEventListener('wheel', (event) => { event.preventDefault(); const p = point(event); zoom(Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * .005), p.x, p.y); }, { passive: false });
    svg.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { clear(); return; }
      if (['+', '=', '-', '0', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        if (['+', '='].includes(event.key)) zoom(1.3); else if (event.key === '-') zoom(1 / 1.3); else if (event.key === '0') fit();
        else { camera.x += event.key === 'ArrowLeft' ? 50 : event.key === 'ArrowRight' ? -50 : 0; camera.y += event.key === 'ArrowUp' ? 50 : event.key === 'ArrowDown' ? -50 : 0; transform(); }
      }
    });
    const legend = node('div', undefined, 'network-key');
    for (const [label, color] of [[this.incoming === 'origins' ? 'Origens' : 'Fontes', '#0a695c'], [graph.centerTitle || 'Partidos', '#367c72'], ['Despesas', '#ae803d']]) {
      const key = node('span'); const swatch = node('span', undefined, 'chart-swatch'); swatch.style.backgroundColor = color; key.append(swatch, document.createTextNode(label)); legend.append(key);
    }
    legend.append(node('span', 'Círculos centrais: total de receitas · linhas: valor de cada ligação'));
    this.container.append(legend);
    if (graph.missing) this.container.append(node('p', `Soma parcial: ${graph.missing.toLocaleString('pt-BR')} registro(s) sem valor.`, 'mosaic-note'));
    if (graph.hasNegative) this.container.append(node('p', 'Linhas tracejadas indicam valores negativos. A direção segue a categoria do lançamento; consulte o sinal na seleção.', 'mosaic-note'));
    if (graph.categoriesUnavailable) this.container.append(node('p', 'Esta publicação não detalha todas as categorias.', 'mosaic-note'));
    if (!graph.totals.receipts.available || !graph.totals.outgoing.available) this.container.append(node('p', 'Uma das tabelas não está disponível na fonte.', 'mosaic-note'));
    this.container.append(node('p', this.options.note || 'Última prestação de cada conta. As relações mostram receitas e despesas agregadas; não identificam qual receita financiou cada despesa. Repasses entre órgãos podem reaparecer como receita.', 'mosaic-note'));
    if (focus) title.focus({ preventScroll: true });
  }
}
