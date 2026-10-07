import { cp, mkdir, readFile, rm, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { refresh } from './refresh-data.mjs';

const source = resolve('site');
const target = resolve('dist');
const files = await readdir(source);
for (const filename of files) {
  if (!/\.(?:html|css|js)$/.test(filename)) throw new Error(`Arquivo inesperado na publicação: ${filename}. Dados eleitorais não devem ser publicados com o site.`);
  if (filename.endsWith('.js')) execFileSync(process.execPath, ['--check', resolve(source, filename)], { stdio: 'inherit' });
}
const html = await readFile(resolve(source, 'index.html'), 'utf8');
if (!html.includes('lang="pt-BR"')) throw new Error('A página precisa declarar o idioma português.');
for (const [, asset] of html.matchAll(/(?:src|href)="\.\/([^"#]+)"/g)) await readFile(resolve(source, asset));
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });
if (process.argv.includes('--refresh')) await refresh(resolve(target, 'data'));
console.log('Publicação preparada em dist/. Arquivos eleitorais não são versionados no repositório.');
