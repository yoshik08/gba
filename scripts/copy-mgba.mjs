import { cp, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', '@thenick775', 'mgba-wasm', 'dist');
const dest = join(root, 'public', 'mgba');

await mkdir(dest, { recursive: true });
await cp(src, dest, { recursive: true });
console.log('copied mGBA wasm files to public/mgba');
