// Builds a tiny GBA test ROM (hand-assembled ARM) used by the local mock server and QA scripts.
// What it does, every frame:
//   - D-pad moves an 8x8 square; A turns it red, B green, L yellow (so input is visible in pixels)
//   - A plays a square-wave tone on sound channel 1 (so audio can be checked)
//   - Start writes the frame counter into SRAM (so save sync can be checked)
//   - the top 4 rows show the frame counter as 24 binary blocks (so speed and freezes can be measured)
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const COND = { EQ: 0, NE: 1, HS: 2, LO: 3, GE: 10, LT: 11, GT: 12, LE: 13, AL: 14 };
const OP = { AND: 0, SUB: 2, ADD: 4, TST: 8, CMP: 10, ORR: 12, MOV: 13, BIC: 14, MVN: 15 };
const SHIFT = { LSL: 0, LSR: 1 };

function encodeImm(value) {
  const v = value >>> 0;
  for (let rot = 0; rot < 16; rot += 1) {
    const r = ((v << (rot * 2)) | (v >>> (32 - rot * 2))) >>> 0;
    if (r <= 0xff) return (rot << 8) | r;
  }
  throw new Error(`immediate not encodable: 0x${v.toString(16)}`);
}

const code = [];
const labels = {};
const fixups = [];
const here = () => code.length * 4;
const emit = (word) => code.push(word >>> 0);
const label = (name) => { labels[name] = here(); };

function dp(op, { cond = 'AL', s = false, rd = 0, rn = 0, imm, rm, shift, shiftImm = 0, rs }) {
  let w = (COND[cond] << 28) | (OP[op] << 21) | ((s ? 1 : 0) << 20) | (rn << 16) | (rd << 12);
  if (imm !== undefined) {
    w |= (1 << 25) | encodeImm(imm);
  } else if (rs !== undefined) {
    w |= (rs << 8) | (SHIFT[shift] << 5) | (1 << 4) | rm;
  } else {
    w |= ((shiftImm & 31) << 7) | ((shift ? SHIFT[shift] : 0) << 5) | rm;
  }
  emit(w);
}

const mov = (rd, imm, cond) => dp('MOV', { rd, imm, cond });
const movr = (rd, rm, o = {}) => dp('MOV', { rd, rm, ...o });
const mvn = (rd, imm, cond) => dp('MVN', { rd, imm, cond });
const add = (rd, rn, imm, cond) => dp('ADD', { rd, rn, imm, cond });
const addr = (rd, rn, rm, o = {}) => dp('ADD', { rd, rn, rm, ...o });
const sub = (rd, rn, imm, cond) => dp('SUB', { rd, rn, imm, cond });
const subs = (rd, rn, imm) => dp('SUB', { rd, rn, imm, s: true });
const orr = (rd, rn, imm, cond) => dp('ORR', { rd, rn, imm, cond });
const and = (rd, rn, rm) => dp('AND', { rd, rn, rm });
const bic = (rd, rn, rm) => dp('BIC', { rd, rn, rm });
const tst = (rn, imm) => dp('TST', { rn, imm, s: true });
const cmp = (rn, imm) => dp('CMP', { rn, imm, s: true });
const mvnr = (rd, rm) => dp('MVN', { rd, rm });

// halfword load/store, immediate offset (pre-indexed, no writeback)
function hw(load, rd, rn, off = 0, cond = 'AL') {
  emit((COND[cond] << 28) | (1 << 24) | (1 << 23) | (1 << 22) | ((load ? 1 : 0) << 20)
    | (rn << 16) | (rd << 12) | (((off >> 4) & 0xf) << 8) | (0xb << 4) | (off & 0xf));
}
const ldrh = (rd, rn, off, cond) => hw(true, rd, rn, off, cond);
const strh = (rd, rn, off, cond) => hw(false, rd, rn, off, cond);
// strh rd, [rn], #2  (post-indexed)
const strhPost2 = (rd, rn) => emit((14 << 28) | (1 << 23) | (1 << 22) | (rn << 16) | (rd << 12) | (0xb << 4) | 2);
// strb rd, [rn, #off]
const strb = (rd, rn, off, cond = 'AL') => emit((COND[cond] << 28) | (1 << 26) | (1 << 24) | (1 << 23) | (1 << 22) | (rn << 16) | (rd << 12) | off);
// mul rd, rm, rs
const mul = (rd, rm, rs) => emit((14 << 28) | (rd << 16) | (rs << 8) | (0x9 << 4) | rm);

function branch(target, cond = 'AL', link = false) {
  fixups.push({ at: code.length, target, cond, link });
  emit(0);
}
const b = (t, c) => branch(t, c);
const bl = (t) => branch(t, 'AL', true);

const IO = 0, X = 2, Y = 3, FRAME = 4, VRAM = 5, SRAM = 8, PREV = 9, COLOR = 10;
const BG = 0x2800;

// ---- program ----
label('start');
mov(IO, 0x04000000);
mov(1, 0x400); orr(1, 1, 3); strh(1, IO, 0); // DISPCNT: mode 3, BG2
mov(VRAM, 0x06000000);
mov(SRAM, 0x0e000000);
mov(1, 0x80); strh(1, IO, 0x84); // sound master enable
mov(1, 0x77); orr(1, 1, 0x1100); strh(1, IO, 0x80); // ch1 left+right, volume 7
mov(1, 2); strh(1, IO, 0x82); // PSG 100%
mov(X, 116); mov(Y, 76); mov(FRAME, 0); mov(PREV, 0);
mov(1, 0); mov(6, 0); mov(7, 240); mov(12, 160); mov(COLOR, BG); bl('fill');

label('loop');
label('w1'); ldrh(1, IO, 6); cmp(1, 160); b('w1', 'HS');
label('w2'); ldrh(1, IO, 6); cmp(1, 160); b('w2', 'LO');
// erase square
movr(1, X); movr(6, Y); mov(7, 8); mov(12, 8); mov(COLOR, BG); bl('fill');
// keys: r1 = ~KEYINPUT & 0x3ff
add(11, IO, 0x100); ldrh(1, 11, 0x30); mvnr(1, 1);
mov(7, 0xff); orr(7, 7, 0x300); and(1, 1, 7);
tst(1, 0x10); add(X, X, 2, 'NE');
tst(1, 0x20); sub(X, X, 2, 'NE');
tst(1, 0x40); sub(Y, Y, 2, 'NE');
tst(1, 0x80); add(Y, Y, 2, 'NE');
cmp(X, 0); mov(X, 0, 'LT'); cmp(X, 232); mov(X, 232, 'GT');
cmp(Y, 8); mov(Y, 8, 'LT'); cmp(Y, 152); mov(Y, 152, 'GT');
mvn(COLOR, 0x8000); // white
tst(1, 1); mov(COLOR, 0x1f, 'NE'); // A red
tst(1, 2); mov(COLOR, 0x3e0, 'NE'); // B green
tst(1, 0x200); mov(COLOR, 0x3e0, 'NE'); orr(COLOR, COLOR, 0x1f, 'NE'); // L yellow
// draw square (fill keeps r1? no — save keys in r9 path below first)
movr(PREV, PREV); // no-op spacer for readability
// newly pressed = keys & ~prev -> r7 ; released = prev & ~keys -> r12
bic(7, 1, PREV);
bic(12, PREV, 1);
movr(PREV, 1);
// A pressed: start tone
tst(7, 1);
mov(11, 0xf000, 'NE'); orr(11, 11, 0x80, 'NE'); strh(11, IO, 0x62, 'NE');
mov(11, 0x8600, 'NE'); orr(11, 11, 0xd6, 'NE'); strh(11, IO, 0x64, 'NE');
// A released: silence
tst(12, 1);
mov(11, 0, 'NE'); strh(11, IO, 0x62, 'NE');
mov(11, 0x8000, 'NE'); strh(11, IO, 0x64, 'NE');
// Start pressed: write frame counter to SRAM
tst(7, 8);
strb(FRAME, SRAM, 0, 'NE');
movr(11, FRAME, { shift: 'LSR', shiftImm: 8, cond: 'NE' }); strb(11, SRAM, 1, 'NE');
movr(11, FRAME, { shift: 'LSR', shiftImm: 16, cond: 'NE' }); strb(11, SRAM, 2, 'NE');
mov(11, 0x5a, 'NE'); strb(11, SRAM, 3, 'NE');
// draw square
movr(1, X); movr(6, Y); mov(7, 8); mov(12, 8); bl('fill');
// frame counter blocks on rows 0..3
add(FRAME, FRAME, 1);
mov(1, 0); movr(6, VRAM);
label('bit');
movr(11, FRAME, { shift: 'LSR', rs: 1 });
tst(11, 1);
mvn(7, 0x8000, 'NE');
mov(7, 0, 'EQ');
mov(12, 4); movr(11, 6);
label('brow');
mov(13, 10); movr(COLOR, 11);
label('bcol');
strhPost2(7, COLOR);
subs(13, 13, 1); b('bcol', 'NE');
add(11, 11, 480);
subs(12, 12, 1); b('brow', 'NE');
add(6, 6, 20);
add(1, 1, 1);
cmp(1, 24); b('bit', 'LT');
b('loop');

// fill(r1=x, r6=y, r7=w, r12=h, r10=color); clobbers r6, r11, r12, r13
label('fill');
mov(11, 240);
mul(11, 6, 11);
addr(11, 11, 1);
addr(11, VRAM, 11, { shift: 'LSL', shiftImm: 1 });
label('frow');
movr(13, 7); movr(6, 11);
label('fcol');
strhPost2(COLOR, 6);
subs(13, 13, 1); b('fcol', 'NE');
add(11, 11, 480);
subs(12, 12, 1); b('frow', 'NE');
movr(15, 14);

for (const f of fixups) {
  const target = labels[f.target];
  if (target === undefined) throw new Error(`missing label ${f.target}`);
  const offset = ((target - (f.at * 4 + 8)) >> 2) & 0xffffff;
  code[f.at] = ((COND[f.cond] << 28) | (0b101 << 25) | ((f.link ? 1 : 0) << 24) | offset) >>> 0;
}

// ---- image ----
const rom = new Uint8Array(0x10000);
const view = new DataView(rom.buffer);
const CODE_AT = 0xc0;
view.setUint32(0, (0xea000000 | ((CODE_AT - 8) >> 2)) >>> 0, true); // b start
const title = 'MGBA TEST';
for (let i = 0; i < 12; i += 1) rom[0xa0 + i] = i < title.length ? title.charCodeAt(i) : 0;
'BTST'.split('').forEach((c, i) => { rom[0xac + i] = c.charCodeAt(0); });
'01'.split('').forEach((c, i) => { rom[0xb0 + i] = c.charCodeAt(0); });
rom[0xb2] = 0x96;
let sum = 0;
for (let i = 0xa0; i <= 0xbc; i += 1) sum = (sum - rom[i]) & 0xff;
rom[0xbd] = (sum - 0x19) & 0xff;
code.forEach((w, i) => view.setUint32(CODE_AT + i * 4, w, true));
const tag = 'SRAM_V113';
const tagAt = 0x800;
for (let i = 0; i < tag.length; i += 1) rom[tagAt + i] = tag.charCodeAt(i);

const out = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '..', '.local', 'roms', 'Input Test.gba');
await mkdir(dirname(out), { recursive: true });
await writeFile(out, rom);
console.log(`test ROM written: ${out} (${code.length} instructions)`);
