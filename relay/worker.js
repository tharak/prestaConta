// Relay HTTP opcional: encaminha somente os dois recursos oficiais de 2026.
// Não recebe arquivos de usuários, não persiste dados e não aceita URLs arbitrárias.
const CATALOG = 'https://dadosabertos.tse.jus.br/api/3/action/package_show?id=prestacao-de-contas-eleitorais-2026';
const RESOURCE_IDS = {
  candidates: 'dc8c1c26-7df0-4d90-a6da-f567b3f6cc00',
  parties: '4b60ada3-66d9-474d-ba3f-a42a7bbcf90d',
};
function sourceUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'cdn.tse.jus.br' || !url.pathname.startsWith('/estatistica/') || !url.pathname.endsWith('.zip') || url.username || url.password) throw new Error('Recurso oficial não reconhecido.');
  return url.href;
}
async function resources(signal) {
  const response = await fetch(CATALOG, { signal, redirect: 'error', cache: 'no-store' });
  if (!response.ok) throw new Error('Catálogo do TSE indisponível.');
  const payload = await response.json();
  if (!payload.success || !Array.isArray(payload.result?.resources)) throw new Error('Catálogo do TSE não reconhecido.');
  const result = {};
  for (const [scope, id] of Object.entries(RESOURCE_IDS)) {
    const resource = payload.result.resources.find((item) => item.id === id);
    if (!resource?.url) throw new Error('Recurso ausente no catálogo do TSE.');
    result[scope] = { url: sourceUrl(resource.url), name: resource.name || '', id };
  }
  return result;
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean);
    if (!allowed.length) return new Response('Configure ALLOWED_ORIGINS antes de usar o relay.', { status: 503 });
    if (!allowed.includes(origin)) return new Response('Origem não autorizada.', { status: 403 });
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified',
      'Cache-Control': 'no-store',
      'Vary': 'Origin',
      'X-Content-Type-Options': 'nosniff',
    };
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'Método não permitido.' }, 405);
    const url = new URL(request.url);
    if (!['/resources', '/archive'].includes(url.pathname)) return json({ error: 'Rota não encontrada.' }, 404);
    if (url.pathname === '/resources' && [...url.searchParams].length) return json({ error: 'Parâmetros não permitidos.' }, 400);
    const scope = url.searchParams.get('scope');
    if (url.pathname === '/archive' && (!Object.hasOwn(RESOURCE_IDS, scope) || [...url.searchParams].length !== 1)) return json({ error: 'Selecione candidates ou parties, sem outros parâmetros.' }, 400);
    const requestedRange = request.headers.get('Range');
    if (requestedRange && !/^bytes=(?:\d+-\d*|-\d+)$/.test(requestedRange)) return json({ error: 'Intervalo de bytes inválido.' }, 400);
    try {
      const catalog = await resources(request.signal);
      if (url.pathname === '/resources') {
        if (request.method === 'HEAD') return new Response(null, { headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
        return json(catalog);
      }
      const headers = { 'Accept-Encoding': 'identity' };
      if (requestedRange) headers.Range = requestedRange;
      const upstream = await fetch(catalog[scope].url, { method: request.method, headers, signal: request.signal, redirect: 'error', cache: 'no-store' });
      if (![200, 206, 416].includes(upstream.status)) {
        await upstream.body?.cancel();
        return json({ error: `Arquivo do TSE indisponível (HTTP ${upstream.status}).` }, 502);
      }
      const outgoing = new Headers(cors);
      for (const name of ['Content-Length', 'Content-Range', 'Accept-Ranges', 'ETag', 'Last-Modified']) {
        if (upstream.headers.has(name)) outgoing.set(name, upstream.headers.get(name));
      }
      outgoing.set('Content-Type', 'application/zip');
      // Mantém o stream: não carrega o ZIP inteiro na memória do Worker.
      return new Response(upstream.body, { status: upstream.status, headers: outgoing });
    } catch {
      return json({ error: 'Não foi possível consultar os arquivos oficiais do TSE. Tente novamente mais tarde.' }, 502);
    }
  },
};
