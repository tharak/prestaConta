const MAX_DIRECTORY = 16 * 1024 * 1024;
const MAX_DOWNLOAD = 300 * 1024 * 1024;
const view = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
function uint64(data, offset) {
  const value = data.getBigUint64(offset, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('ZIP excede o tamanho suportado.');
  return Number(value);
}
function range(start, end) { return `bytes=${start}-${end}`; }

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
export function crc32(bytes, previous = 0) {
  let crc = (previous ^ 0xffffffff) >>> 0;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// Lê apenas diretório e membros necessários quando o servidor permite HTTP Range.
export class ZipSource {
  constructor({ blob, url, signal, onProgress = () => {} }) {
    this.blob = blob;
    this.url = url;
    this.signal = signal;
    this.onProgress = onProgress;
    this.etag = '';
    this.modified = '';
  }
  async fetch(headers) {
    let response;
    try { response = await fetch(this.url, { headers, signal: this.signal, cache: 'no-store', credentials: 'omit', redirect: 'follow' }); }
    catch (error) { if (this.signal?.aborted) throw error; throw new Error('Não foi possível ler o arquivo oficial. A conexão pode estar indisponível ou o TSE pode ter bloqueado o acesso pelo navegador. Tente abrir o ZIP baixado no portal oficial.'); }
    if (!response.ok) throw new Error(`O TSE respondeu com erro HTTP ${response.status}. Tente novamente mais tarde.`);
    const etag = response.headers.get('etag');
    const modified = response.headers.get('last-modified');
    if ((this.etag && etag && this.etag !== etag) || (this.modified && modified && this.modified !== modified)) {
      await response.body?.cancel();
      throw new Error('O arquivo do TSE mudou durante a leitura. Atualize a base para carregar uma versão completa.');
    }
    this.etag ||= etag || '';
    this.modified ||= modified || '';
    return response;
  }
  async whole(response) {
    if (Number(response.headers.get('content-length')) > MAX_DOWNLOAD) {
      await response.body?.cancel();
      throw new Error('Este servidor não permite leitura parcial do ZIP e o arquivo é grande demais para download automático. Baixe o ZIP no portal do TSE e abra-o pela opção abaixo.');
    }
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > MAX_DOWNLOAD) throw new Error('ZIP acima de 300 MB sem suporte a leitura parcial. Abra o arquivo baixado no portal oficial.');
        chunks.push(value);
        this.onProgress(`Baixando arquivo: ${(received / 1024 / 1024).toFixed(1).replace('.', ',')} MB recebidos.`);
      }
      this.blob = new Blob(chunks, { type: 'application/zip' });
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
  }
  async bytes(start, end) {
    if (start < 0 || end < start || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)) throw new Error('Intervalo inválido no ZIP.');
    if (this.blob) return new Uint8Array(await this.blob.slice(start, end + 1).arrayBuffer());
    const response = await this.fetch({ Range: range(start, end) });
    if (response.status === 200) { await this.whole(response); return this.bytes(start, end); }
    if (response.status !== 206) { await response.body?.cancel(); throw new Error('Resposta inválida ao ler parte do ZIP.'); }
    const data = new Uint8Array(await response.arrayBuffer());
    if (data.length !== end - start + 1) throw new Error('O TSE enviou um intervalo incompleto do ZIP.');
    return data;
  }
  async directory() {
    let tail;
    if (this.blob) tail = new Uint8Array(await this.blob.slice(Math.max(0, this.blob.size - 65557)).arrayBuffer());
    else {
      const response = await this.fetch({ Range: 'bytes=-65557' });
      if (response.status === 200) {
        await this.whole(response);
        return this.directory();
      }
      if (response.status !== 206) { await response.body?.cancel(); throw new Error('Não foi possível ler o diretório do ZIP.'); }
      tail = new Uint8Array(await response.arrayBuffer());
    }
    const data = view(tail);
    let end = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (data.getUint32(i, true) === 0x06054b50 && i + 22 + data.getUint16(i + 20, true) === tail.length) { end = i; break; }
    }
    if (end < 0) throw new Error('Arquivo inválido: o diretório ZIP não foi encontrado.');
    if (data.getUint16(end + 4, true) || data.getUint16(end + 6, true)) throw new Error('ZIP dividido em vários volumes não é suportado.');
    let count = data.getUint16(end + 10, true);
    let size = data.getUint32(end + 12, true);
    let offset = data.getUint32(end + 16, true);
    if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
      const locator = end - 20;
      if (locator < 0 || data.getUint32(locator, true) !== 0x07064b50) throw new Error('Diretório ZIP64 ausente.');
      if (data.getUint32(locator + 4, true) || data.getUint32(locator + 16, true) !== 1) throw new Error('ZIP64 dividido em volumes não é suportado.');
      const zip64Offset = uint64(data, locator + 8);
      const zip64 = view(await this.bytes(zip64Offset, zip64Offset + 55));
      if (zip64.getUint32(0, true) !== 0x06064b50) throw new Error('Diretório ZIP64 inválido.');
      if (zip64.getUint32(16, true) || zip64.getUint32(20, true)) throw new Error('ZIP64 dividido em volumes não é suportado.');
      count = uint64(zip64, 32); size = uint64(zip64, 40); offset = uint64(zip64, 48);
    }
    if (!size || size > MAX_DIRECTORY) throw new Error('Diretório ZIP vazio ou grande demais.');
    const directory = await this.bytes(offset, offset + size - 1);
    const entries = [];
    const dir = view(directory);
    let cursor = 0;
    while (cursor + 46 <= directory.length) {
      if (dir.getUint32(cursor, true) !== 0x02014b50) throw new Error('Entrada inválida no diretório ZIP.');
      const flags = dir.getUint16(cursor + 8, true);
      const nameSize = dir.getUint16(cursor + 28, true);
      const extraSize = dir.getUint16(cursor + 30, true);
      const commentSize = dir.getUint16(cursor + 32, true);
      const next = cursor + 46 + nameSize + extraSize + commentSize;
      if (next > directory.length) throw new Error('Diretório ZIP truncado.');
      const entry = {
        name: new TextDecoder(flags & 0x800 ? 'utf-8' : 'windows-1252').decode(directory.subarray(cursor + 46, cursor + 46 + nameSize)),
        flags, method: dir.getUint16(cursor + 10, true), crc: dir.getUint32(cursor + 16, true),
        compressedSize: dir.getUint32(cursor + 20, true), size: dir.getUint32(cursor + 24, true), offset: dir.getUint32(cursor + 42, true),
      };
      let extra = cursor + 46 + nameSize;
      const extraEnd = extra + extraSize;
      while (extra + 4 <= extraEnd) {
        const type = dir.getUint16(extra, true);
        const length = dir.getUint16(extra + 2, true);
        if (extra + 4 + length > extraEnd) throw new Error('Campos extras inválidos no ZIP.');
        if (type === 1) {
          let pos = extra + 4;
          for (const field of ['size', 'compressedSize', 'offset']) {
            if (entry[field] === 0xffffffff) {
              if (pos + 8 > extra + 4 + length) throw new Error('Campo ZIP64 incompleto.');
              entry[field] = uint64(dir, pos); pos += 8;
            }
          }
        }
        extra += 4 + length;
      }
      if ([entry.size, entry.compressedSize, entry.offset].includes(0xffffffff)) throw new Error('Entrada ZIP64 incompleta.');
      entries.push(entry); cursor = next;
    }
    if (entries.length !== count || cursor !== directory.length) throw new Error('Quantidade de entradas inconsistente no ZIP.');
    return entries;
  }
  async stream(entry) {
    if (entry.flags & 1) throw new Error('ZIP protegido por senha não é suportado.');
    if (![0, 8].includes(entry.method)) throw new Error('Compressão do ZIP não suportada pelo navegador.');
    const headerBytes = await this.bytes(entry.offset, entry.offset + 29);
    if (headerBytes.length !== 30) throw new Error('Cabeçalho do ZIP incompleto.');
    const header = view(headerBytes);
    if (header.getUint32(0, true) !== 0x04034b50 || header.getUint16(8, true) !== entry.method) throw new Error('Cabeçalho inválido no ZIP.');
    const start = entry.offset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
    const end = start + entry.compressedSize - 1;
    let compressed;
    if (!entry.compressedSize) compressed = new Blob([]).stream();
    else if (this.blob) compressed = this.blob.slice(start, end + 1).stream();
    else {
      const response = await this.fetch({ Range: range(start, end) });
      if (response.status === 200) { await this.whole(response); compressed = this.blob.slice(start, end + 1).stream(); }
      else if (response.status === 206) compressed = response.body;
      else { await response.body?.cancel(); throw new Error('Não foi possível ler o conteúdo do ZIP.'); }
    }
    let uncompressed = compressed;
    if (entry.method === 8) {
      try { uncompressed = compressed.pipeThrough(new DecompressionStream('deflate-raw')); }
      catch { await compressed.cancel().catch(() => {}); throw new Error('Seu navegador não suporta a descompactação deste ZIP. Use uma versão atual do Chrome, Firefox, Edge ou Safari.'); }
    }
    let size = 0;
    let crc = 0;
    return uncompressed.pipeThrough(new TransformStream({
      transform(chunk, controller) {
        size += chunk.byteLength;
        if (size > entry.size) throw new Error(`${entry.name}: tamanho descompactado inválido.`);
        crc = crc32(chunk, crc);
        controller.enqueue(chunk);
      },
      flush() {
        if (size !== entry.size || crc !== entry.crc) throw new Error(`${entry.name}: falha de integridade. O arquivo está incompleto ou mudou durante a leitura.`);
      },
    }));
  }
}
