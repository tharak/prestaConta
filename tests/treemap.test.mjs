import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutTreemap } from '../site/treemap.js';

function checkGeometry(values, width, height) {
  const result = layoutTreemap(values, width, height);
  assert.equal(result.status, 'ready');
  let area = 0;
  for (const tile of result.tiles) {
    assert.ok(tile.width > 0 && tile.height > 0);
    assert.ok(tile.x >= -1e-7 && tile.y >= -1e-7);
    assert.ok(tile.x + tile.width <= width + 1e-7 && tile.y + tile.height <= height + 1e-7);
    assert.ok(Math.abs(tile.width * tile.height - tile.share * width * height) < 1e-5);
    area += tile.width * tile.height;
  }
  assert.ok(Math.abs(area - width * height) < 1e-5);
  for (let i = 0; i < result.tiles.length; i++) for (let j = i + 1; j < result.tiles.length; j++) {
    const a = result.tiles[i], b = result.tiles[j];
    const overlapWidth = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const overlapHeight = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    assert.ok(overlapWidth <= 1e-7 || overlapHeight <= 1e-7);
  }
  return result;
}

test('mosaico conserva a área proporcional e cobre o painel sem sobreposição', () => {
  const values = [{ id: 'A', cents: 300, missing: 1 }, { id: 'B', cents: 100 }, { id: 'C', cents: 200 }];
  const result = checkGeometry(values, 900, 520);
  assert.equal(result.total, 600);
  assert.equal(result.tiles.find((tile) => tile.id === 'A').share, .5);
  assert.equal(result.tiles.find((tile) => tile.id === 'A').missing, 1);
  assert.equal(values[0].area, undefined);
  assert.deepEqual(values.map((entry) => entry.id), ['A', 'B', 'C']);
});

test('mosaico ocupa toda a área com um só item e exclui valores zero ou ausentes', () => {
  const result = checkGeometry([{ id: 'A', cents: 500 }, { id: 'B', cents: 0 }, { id: 'C', cents: null }], 375, 460);
  assert.equal(result.tiles.length, 1);
  assert.equal(result.tiles[0].width, 375);
  assert.equal(result.tiles[0].height, 460);
  assert.equal(result.tiles[0].share, 1);
});

test('mosaico preserva os sinais e não fabrica área em recortes sem valores positivos', () => {
  assert.deepEqual(layoutTreemap([{ cents: -100 }, { cents: 300 }], 900, 520), { status: 'negative', total: 200, tiles: [] });
  for (const values of [[], [{ cents: 0 }], [{ cents: null }]]) assert.equal(layoutTreemap(values, 900, 520).status, 'empty');
});

test('mosaico mantém a proporção de blocos pequenos em painéis largos e estreitos', () => {
  const values = Array.from({ length: 30 }, (_, index) => ({ id: String(index), cents: index === 0 ? 1_000_000 : (index * 47) % 2000 + 1 }));
  for (const [width, height] of [[900, 520], [310, 460], [2000, 340]]) {
    const result = checkGeometry(values, width, height);
    assert.equal(result.tiles.length, values.length);
    assert.ok(result.tiles.every((tile) => Number.isFinite(tile.x) && Number.isFinite(tile.y)));
  }
});

test('mosaico rejeita dimensões inválidas antes de desenhar os blocos', () => {
  for (const [width, height] of [[0, 10], [10, -1], [NaN, 10], [10, Infinity]]) assert.throws(() => layoutTreemap([{ cents: 100 }], width, height), /Dimensões inválidas/);
});
