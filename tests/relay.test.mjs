import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../relay/worker.js';
const origin = 'https://tharak.github.io';
const env = { ALLOWED_ORIGINS: origin };
function request(path, options = {}) { return new Request(`https://relay.invalid${path}`, { ...options, headers: { Origin: origin, ...options.headers } }); }
function catalog(url = 'https://cdn.tse.jus.br/estatistica/teste/candidatos.zip') {
  return { success: true, result: { resources: [
    { id: 'dc8c1c26-7df0-4d90-a6da-f567b3f6cc00', url, name: 'Candidatos' },
    { id: '4b60ada3-66d9-474d-ba3f-a42a7bbcf90d', url: 'https://cdn.tse.jus.br/estatistica/teste/partidos.zip', name: 'Partidos' },
  ] } };
}
test('relay exige origem configurada e rejeita métodos, rotas e URLs arbitrárias', async () => {
  assert.equal((await worker.fetch(request('/resources'), {})).status, 503);
  assert.equal((await worker.fetch(request('/resources', { headers: { Origin: 'https://outra.invalid' } }), env)).status, 403);
  assert.equal((await worker.fetch(request('/resources', { method: 'POST' }), env)).status, 405);
  assert.equal((await worker.fetch(request('/outra'), env)).status, 404);
  assert.equal((await worker.fetch(request('/archive?scope=__proto__'), env)).status, 400);
  assert.equal((await worker.fetch(request('/archive?scope=candidates&url=https://outra.invalid'), env)).status, 400);
  assert.equal((await worker.fetch(request('/archive?scope=candidates', { headers: { Range: 'bytes=0-1,3-4' } }), env)).status, 400);
});
test('preflight expõe os cabeçalhos necessários apenas para a origem autorizada', async () => {
  const response = await worker.fetch(request('/resources', { method: 'OPTIONS' }), env);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
  assert.match(response.headers.get('access-control-expose-headers'), /ETag/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
test('relay descobre arquivos atuais e encaminha Range e corpo sem persistência', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/api/')) return Response.json(catalog());
    return new Response('abc', { status: 206, headers: { 'Content-Range': 'bytes 0-2/100', ETag: '"teste"' } });
  };
  try {
    const response = await worker.fetch(request('/archive?scope=candidates', { headers: { Range: 'bytes=0-2' } }), env);
    assert.equal(response.status, 206);
    assert.equal(await response.text(), 'abc');
    assert.equal(response.headers.get('etag'), '"teste"');
    assert.equal(calls[1].options.headers.Range, 'bytes=0-2');
    assert.equal(calls[1].options.redirect, 'error');
  } finally { globalThis.fetch = originalFetch; }
});
test('URLs fora do CDN oficial e indisponibilidade não são encaminhadas', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json(catalog('https://outra.invalid/arquivo.zip')); };
  try {
    const response = await worker.fetch(request('/archive?scope=candidates'), env);
    assert.equal(response.status, 502); assert.equal(calls, 1);
    globalThis.fetch = async () => { throw new Error('Falha sintética'); };
    assert.equal((await worker.fetch(request('/resources'), env)).status, 502);
  } finally { globalThis.fetch = originalFetch; }
});
