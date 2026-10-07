// A pizza exige totais não negativos. Ausência de lançamentos não vira zero.
export function layoutPie(values) {
  const total = values.reduce((sum, value) => sum + (value.cents ?? 0), 0);
  if (values.some((value) => value.cents < 0)) return { status: 'negative', total, slices: [] };
  if (!values.some((value) => value.cents > 0)) return { status: 'empty', total, slices: [] };
  let accumulated = 0;
  const slices = values.filter((value) => value.cents > 0).map((value) => {
    const start = accumulated / total;
    accumulated += value.cents;
    return { ...value, share: value.cents / total, start, end: accumulated / total };
  });
  return { status: 'ready', total, slices };
}

export function slicePath(start, end, radius = 130, center = 160) {
  const point = (turn) => [center + radius * Math.sin(turn * Math.PI * 2), center - radius * Math.cos(turn * Math.PI * 2)];
  const [x1, y1] = point(start);
  if (end - start >= 1) {
    return `M ${center} ${center - radius} A ${radius} ${radius} 0 1 1 ${center} ${center + radius} A ${radius} ${radius} 0 1 1 ${center} ${center - radius} Z`;
  }
  const [x2, y2] = point(end);
  return `M ${center} ${center} L ${x1} ${y1} A ${radius} ${radius} 0 ${end - start > .5 ? 1 : 0} 1 ${x2} ${y2} Z`;
}
