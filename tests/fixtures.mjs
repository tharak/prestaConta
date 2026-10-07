import { deflateRawSync } from 'node:zlib';
import { crc32 } from '../site/zip.js';

// Fixtures integralmente sintéticas: não descrevem partidos ou pessoas reais.
export const base = {
  DT_GERACAO: '07/10/2026', HH_GERACAO: '08:30:00', AA_ELEICAO: '2026', CD_ELEICAO: 'TESTE',
  TP_PRESTACAO_CONTAS: 'Parcial', DT_PRESTACAO_CONTAS: '12/09/2026', ST_TURNO: '1',
  SQ_PRESTADOR_CONTAS: '90000000000000001', SQ_CANDIDATO: '90000000000000002',
  NM_CANDIDATO: 'CONTA SINTÉTICA DE TESTE', SG_PARTIDO: 'TESTE', NM_PARTIDO: 'SIGLA SINTÉTICA',
  SG_UF: 'SP', DS_CARGO: 'Cargo de teste', NR_CANDIDATO: '99999', NM_UE: 'SÃO PAULO',
};
export function csv(records) {
  const csvCell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const keys = [...new Set(records.flatMap((record) => Object.keys(record)))];
  return keys.map(csvCell).join(';') + '\r\n' + records.map((record) => keys.map((key) => csvCell(record[key] || '')).join(';')).join('\r\n') + '\r\n';
}
export function receipt(extra = {}) {
  return { ...base, DT_RECEITA: '01/09/2026', VR_RECEITA: '1.234,56', NM_DOADOR: 'DOADOR SINTÉTICO', DS_FONTE_RECEITA: 'Outros Recursos', DS_ORIGEM_RECEITA: 'Recursos próprios', DS_NATUREZA_RECEITA: 'Financeiro', DS_RECEITA: 'Texto de teste; com "aspas"', ...extra };
}
export function paid(extra = {}) {
  const { SQ_CANDIDATO, NM_CANDIDATO, DS_CARGO, NR_CANDIDATO, ...identity } = base;
  return { ...identity, DT_PAGTO_DESPESA: '03/09/2026', VR_PAGTO_DESPESA: '100,00', DS_DESPESA: 'Parcela de teste', SQ_DESPESA: 'DESPESA-TESTE', SQ_PARCELAMENTO_DESPESA: '1', ...extra };
}
export function contracted(extra = {}) {
  return { ...base, DT_DESPESA: '02/09/2026', VR_DESPESA_CONTRATADA: '250,00', NM_FORNECEDOR: 'FORNECEDOR SINTÉTICO', DS_ORIGEM_DESPESA: 'Categoria de teste', DS_DESPESA: 'Despesa de teste', ...extra };
}
export function makeZip(files, { stored = false } = {}) {
  const locals = [];
  const directory = [];
  let offset = 0;
  for (const [name, value] of Object.entries(files)) {
    const contents = Buffer.isBuffer(value) ? value : Buffer.from(value, 'latin1');
    const compressed = stored ? contents : deflateRawSync(contents);
    const filename = Buffer.from(name);
    const crc = crc32(contents);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(contents.length, 22); local.writeUInt16LE(filename.length, 26);
    locals.push(local, filename, compressed);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(stored ? 0 : 8, 10);
    entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(compressed.length, 20); entry.writeUInt32LE(contents.length, 24); entry.writeUInt16LE(filename.length, 28); entry.writeUInt32LE(offset, 42);
    directory.push(entry, filename);
    offset += local.length + filename.length + compressed.length;
  }
  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}
export function candidateZip() {
  const receipts = [receipt(), receipt({ VR_RECEITA: '500,00', DS_FONTE_RECEITA: 'Fundo Especial', DS_ORIGEM_RECEITA: 'Recursos de partido político' }), receipt({ VR_RECEITA: '75,00', DS_FONTE_RECEITA: 'Categoria não catalogada', DS_ORIGEM_RECEITA: 'Outra origem', DS_NATUREZA_RECEITA: 'Estimável' }), receipt({ TP_PRESTACAO_CONTAS: 'Final', DT_PRESTACAO_CONTAS: '05/10/2026', VR_RECEITA: '2.000,00' })];
  const second = receipt({ SQ_PRESTADOR_CONTAS: '90000000000000003', NM_CANDIDATO: 'SEGUNDA CONTA SINTÉTICA', SG_UF: 'RJ', VR_RECEITA: '-4' });
  return makeZip({
    'receitas_candidatos_2026_BRASIL.csv': csv([...receipts, second]),
    'receitas_candidatos_2026_SP.csv': csv([receipt()]),
    'receitas_candidatos_doador_originario_2026_BRASIL.csv': csv([receipt()]),
    'despesas_contratadas_candidatos_2026_BRASIL.csv': csv([contracted()]),
    'despesas_pagas_candidatos_2026_BRASIL.csv': csv([paid(), paid({ SQ_PARCELAMENTO_DESPESA: '2', VR_PAGTO_DESPESA: '50,00' })]),
  });
}
export function partyZip() {
  const { SQ_CANDIDATO, NM_CANDIDATO, DS_CARGO, NR_CANDIDATO, ...partyReceipt } = receipt();
  return makeZip({ 'receitas_orgaos_partidarios_2026_BRASIL.csv': csv([{ ...partyReceipt, DS_ESFERA_PARTIDARIA: 'Estadual' }]) });
}
