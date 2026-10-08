// Uma única escala em R$ para ambas as pontas. Espaço reservado aos rótulos
// não aumenta a espessura monetária de nós ou ligações pequenas.
export function layoutFlow(graph, width = 1160) {
  if (!Number.isFinite(width) || width < 600) throw new Error('Largura inválida para o fluxo.');
  const centerSlot = graph.centerSlot || 32;
  const height = Math.max(540, ...graph.columns.map((column, index) => column.length * (index === 1 ? centerSlot : 62) + 280));
  const sums = graph.columns.map((column) => column.reduce((sum, entry) => sum + (entry.side === 'party' ? Math.max(0, entry.inCents, entry.outCents) : Math.max(0, entry.cents)), 0));
  const scale = Math.min(...graph.columns.map((column, index) => sums[index] > 0 ? (height - 100 - column.length * (index === 1 ? centerSlot : 62)) / sums[index] : Infinity));
  const unit = Number.isFinite(scale) ? Math.max(0, scale) : 0;
  const positions = [width * .265, width * .5, width * .735], nodes = [], byId = new Map();
  graph.columns.forEach((column, index) => {
    const slot = index === 1 ? centerSlot : 62;
    const used = sums[index] * unit + column.length * slot;
    let y = 65 + (height - 80 - used) / 2;
    for (const entry of column) {
      const value = entry.side === 'party' ? Math.max(0, entry.inCents, entry.outCents) : Math.max(0, entry.cents);
      const barHeight = value * unit;
      const placed = { ...entry, x: positions[index], y: y + slot / 2, height: barHeight, labelY: y + (slot + barHeight) / 2 };
      nodes.push(placed); byId.set(entry.id, placed); y += slot + barHeight;
    }
  });
  const offsets = new Map(), links = [];
  if (!graph.hasNegative) for (const edge of graph.links.filter((link) => link.cents > 0).sort((a, b) => byId.get(a.source).y - byId.get(b.source).y || byId.get(a.target).y - byId.get(b.target).y)) {
    const source = byId.get(edge.source), target = byId.get(edge.target), thickness = edge.cents * unit;
    const startKey = `${source.id}:out`, endKey = `${target.id}:in`;
    const start = source.y + (offsets.get(startKey) || 0) + thickness / 2;
    const end = target.y + (offsets.get(endKey) || 0) + thickness / 2;
    offsets.set(startKey, (offsets.get(startKey) || 0) + thickness); offsets.set(endKey, (offsets.get(endKey) || 0) + thickness);
    const x1 = source.x + 12, x2 = target.x, middle = (x1 + x2) / 2;
    links.push({ ...edge, thickness, path: `M ${x1} ${start} C ${middle} ${start}, ${middle} ${end}, ${x2} ${end}` });
  }
  return { width, height, scale: unit, nodes, links };
}
