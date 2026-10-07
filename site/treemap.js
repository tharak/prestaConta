// Retângulos com área proporcional à soma conhecida. Zero e ausência não
// recebem área; totais negativos exigem consulta dos valores, sem mosaico.
export function layoutTreemap(values, width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || !(width > 0) || !(height > 0)) throw new Error('Dimensões inválidas para o mosaico.');
  const total = values.reduce((sum, entry) => sum + (entry.cents ?? 0), 0);
  if (values.some((entry) => entry.cents < 0)) return { status: 'negative', total, tiles: [] };
  const positive = values.filter((entry) => entry.cents > 0);
  if (!positive.length) return { status: 'empty', total, tiles: [] };
  const remaining = positive.map((entry) => ({ ...entry, share: entry.cents / total, area: entry.cents / total * width * height }))
    .sort((a, b) => b.area - a.area);
  const tiles = [];
  let box = { x: 0, y: 0, width, height };
  const ratio = (row, side) => {
    const sum = row.reduce((value, entry) => value + entry.area, 0);
    const smallest = Math.min(...row.map((entry) => entry.area));
    const largest = Math.max(...row.map((entry) => entry.area));
    return Math.max(side * side * largest / (sum * sum), sum * sum / (side * side * smallest));
  };
  while (remaining.length) {
    const side = Math.min(box.width, box.height);
    const row = [remaining.shift()];
    while (remaining.length && ratio([...row, remaining[0]], side) <= ratio(row, side)) row.push(remaining.shift());
    const area = row.reduce((sum, entry) => sum + entry.area, 0);
    const vertical = box.width >= box.height;
    const thickness = remaining.length ? area / side : vertical ? box.width : box.height;
    let offset = 0;
    row.forEach((entry, index) => {
      const length = index === row.length - 1 ? side - offset : entry.area / thickness;
      tiles.push({ ...entry, x: box.x + (vertical ? 0 : offset), y: box.y + (vertical ? offset : 0), width: vertical ? thickness : length, height: vertical ? length : thickness });
      offset += length;
    });
    box = vertical ? { ...box, x: box.x + thickness, width: box.width - thickness } : { ...box, y: box.y + thickness, height: box.height - thickness };
  }
  return { status: 'ready', total, tiles };
}
