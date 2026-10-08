// Geometria independente dos valores: o grafo representa relações declaradas.
// Nós e linhas têm tamanho constante; os montantes são consultados na seleção.
export function layoutNetwork(graph) {
  const width = 1280, centerColumns = Math.min(3, graph.columns[1].length || 1);
  const height = Math.max(560, ...graph.columns.map((rows, index) => (index === 1 ? Math.ceil(rows.length / centerColumns) : rows.length) * 84 + 130));
  const nodes = graph.columns.flatMap((rows, side) => rows.map((entry, index) => {
    const columns = side === 1 ? centerColumns : 1, row = Math.floor(index / columns), count = Math.ceil(rows.length / columns);
    const x = side === 0 ? 160 : side === 2 ? 1120 : 640 + (index % columns - (columns - 1) / 2) * 190;
    const y = (height - count * 84) / 2 + row * 84 + 22;
    return { ...entry, x, y, anchorX: x, anchorY: y, radius: side === 1 ? 12 : 8 };
  }));
  const byId = new Map(nodes.map((entry) => [entry.id, entry]));
  const links = graph.links.map((edge) => {
    if (!byId.has(edge.source) || !byId.has(edge.target)) throw new Error('Ligação sem nó correspondente.');
    return { ...edge };
  });
  // Molas e repulsão aproximam os nós ligados, mantendo espaço para os rótulos.
  // A disposição é determinística, inclusive para contas sem valor ou ligação.
  for (let step = 0; step < 100; step++) {
    const forces = new Map(nodes.map((entry) => [entry.id, { x: (entry.anchorX - entry.x) * .08, y: (entry.anchorY - entry.y) * .08 }]));
    for (const edge of links) {
      const source = byId.get(edge.source), target = byId.get(edge.target), dx = target.x - source.x, dy = target.y - source.y;
      const distance = Math.hypot(dx, dy) || 1, strength = (distance - 360) * .0006;
      forces.get(source.id).x += dx * strength / distance; forces.get(source.id).y += dy * strength / distance;
      forces.get(target.id).x -= dx * strength / distance; forces.get(target.id).y -= dy * strength / distance;
    }
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j], dx = b.x - a.x, dy = b.y - a.y;
      if (Math.abs(dx) >= 176 || Math.abs(dy) >= 78) continue;
      const vertical = Math.abs(dy) / 78 > Math.abs(dx) / 176;
      const axis = vertical ? 'y' : 'x', gap = vertical ? dy : dx, limit = vertical ? 78 : 176;
      const push = Math.sign(gap || 1) * (limit - Math.abs(gap)) * .25;
      forces.get(a.id)[axis] -= push; forces.get(b.id)[axis] += push;
    }
    for (const entry of nodes) {
      const force = forces.get(entry.id);
      entry.x = Math.max(100, Math.min(width - 100, entry.x + Math.max(-4, Math.min(4, force.x))));
      entry.y = Math.max(40, Math.min(height - 80, entry.y + Math.max(-4, Math.min(4, force.y))));
    }
  }
  return { width, height, nodes, links };
}

export function networkPath(source, target) {
  const dx = target.x - source.x, dy = target.y - source.y, distance = Math.hypot(dx, dy);
  if (distance <= source.radius + target.radius + 4) return '';
  const bend = Math.min(36, distance * .07), nx = -dy / distance, ny = dx / distance;
  const cx = (source.x + target.x) / 2 + nx * bend, cy = (source.y + target.y) / 2 + ny * bend;
  const start = Math.hypot(cx - source.x, cy - source.y), end = Math.hypot(target.x - cx, target.y - cy);
  const x1 = source.x + (cx - source.x) / start * (source.radius + 2), y1 = source.y + (cy - source.y) / start * (source.radius + 2);
  const x2 = target.x - (target.x - cx) / end * (target.radius + 6), y2 = target.y - (target.y - cy) / end * (target.radius + 6);
  return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
}
