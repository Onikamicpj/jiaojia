#!/usr/bin/env node
/**
 * 打包成单文件 HTML：双击就能用，不需要 Node、不需要装东西、不联网也能查。
 *
 * 数据、样式、脚本全部内联进一个 .html，用 file:// 打开即可。
 * 唯一需要联网的是汇率，取不到就退回内置汇率。
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'jiaojia.html');

const read = (p) => readFile(resolve(ROOT, p), 'utf8');

const [rawData, html, css, runtime, rawAlias] = await Promise.all([
  read('data/bandai-official.json'),
  read('public/index.html'),
  read('public/style.css'),
  read('scripts/standalone-runtime.js'),
  read('data/aliases.json')
]);

const store = JSON.parse(rawData);
const items = store.items
  .filter((it) => it.price && it.name)
  .map((it) => ({
    id: it.id,
    n: it.name,
    p: it.price,
    g: it.grade || null,
    s: it.scale || null,
    c: it.code || null,
    r: it.released || null,
    i: it.img || null
  }));

// 中文/英文别名表，前后端共用同一份 data/aliases.json
const alias = JSON.parse(rawAlias);

const out = html
  .replace('<link rel="stylesheet" href="/style.css">', `<style>\n${css}\n</style>`)
  .replace(
    '<script src="/app.js"></script>',
    `<script>
window.__DATA__ = ${JSON.stringify(items)};
window.__ALIAS__ = ${JSON.stringify(alias)};
</script>
<script>
${runtime}
</script>`
  );

await writeFile(OUT, out, 'utf8');

const kb = (Buffer.byteLength(out, 'utf8') / 1024).toFixed(0);
console.log(`打包完成：${OUT}`);
console.log(`  ${items.length} 条官价 · ${Object.keys(alias).length} 条中文别名 · ${kb} KB`);
