'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { singleCandle, twoCandle, scan, parseCsv } = require('../lib/patterns');

const BIN = path.join(__dirname, '..', 'bin', 'candle-patterns.js');

// ---- unit: single-candle patterns ----
test('doji: tiny body vs range', () => {
  const hits = singleCandle({ timestamp: 't', open: 100, high: 105, low: 95, close: 100.2 });
  assert.ok(hits.some(h => h.pattern === 'doji'), JSON.stringify(hits));
});

test('doji: NOT doji when body is large', () => {
  const hits = singleCandle({ timestamp: 't', open: 100, high: 105, low: 95, close: 104 });
  assert.ok(!hits.some(h => h.pattern === 'doji'));
});

test('hammer: long lower wick, small upper wick, body low', () => {
  const hits = singleCandle({ timestamp: 't', open: 98, high: 100, low: 90, close: 99 });
  assert.ok(hits.some(h => h.pattern === 'hammer'), JSON.stringify(hits));
});

test('shooting-star: mirror of hammer', () => {
  const hits = singleCandle({ timestamp: 't', open: 92, high: 100, low: 91, close: 93 });
  assert.ok(hits.some(h => h.pattern === 'shooting-star'), JSON.stringify(hits));
});

test('marubozu-bullish: almost no wicks', () => {
  const hits = singleCandle({ timestamp: 't', open: 100, high: 110, low: 100, close: 110 });
  assert.ok(hits.some(h => h.pattern === 'marubozu-bullish'), JSON.stringify(hits));
});

test('noise candle yields no pattern', () => {
  const hits = singleCandle({ timestamp: 't', open: 100, high: 102.5, low: 99.5, close: 102 });
  assert.deepEqual(hits, []);
});

test('spinning-top: both wicks long vs body', () => {
  const hits = singleCandle({ timestamp: 't', open: 100, high: 104, low: 97, close: 102 });
  assert.ok(hits.some(h => h.pattern === 'spinning-top'), JSON.stringify(hits));
});

// ---- unit: two-candle patterns ----
test('bullish-engulfing detected', () => {
  const prev = { timestamp: 'a', open: 102, high: 103, low: 98, close: 99 };  // red
  const cur = { timestamp: 'b', open: 98.5, high: 104, low: 98, close: 103 }; // green engulfs
  const hits = twoCandle(prev, cur);
  assert.ok(hits.some(h => h.pattern === 'bullish-engulfing'), JSON.stringify(hits));
});

test('bearish-engulfing detected', () => {
  const prev = { timestamp: 'a', open: 99, high: 104, low: 98, close: 103 };  // green
  const cur = { timestamp: 'b', open: 103.5, high: 104, low: 97, close: 98 }; // red engulfs
  const hits = twoCandle(prev, cur);
  assert.ok(hits.some(h => h.pattern === 'bearish-engulfing'), JSON.stringify(hits));
});

test('engulfing strength scales with body ratio', () => {
  const prev = { timestamp: 'a', open: 101, high: 102, low: 99, close: 100 };
  const weak = { timestamp: 'b', open: 99.9, high: 102, low: 99.8, close: 101 };  // barely engulfs (ratio 1.1)
  const strong = { timestamp: 'b', open: 98, high: 104, low: 97, close: 104 };     // dominates
  const sw = twoCandle(prev, weak).find(h => h.pattern === 'bullish-engulfing');
  const ss = twoCandle(prev, strong).find(h => h.pattern === 'bullish-engulfing');
  assert.ok(sw && ss && ss.strength > sw.strength, `weak=${sw?.strength} strong=${ss?.strength}`);
});

test('inside-bar detected', () => {
  const prev = { timestamp: 'a', open: 100, high: 110, low: 90, close: 105 };
  const cur = { timestamp: 'b', open: 102, high: 107, low: 95, close: 104 };
  const hits = twoCandle(prev, cur);
  assert.ok(hits.some(h => h.pattern === 'inside-bar'), JSON.stringify(hits));
});

test('same-direction big candle is NOT engulfing', () => {
  const prev = { timestamp: 'a', open: 100, high: 102, low: 99, close: 101 };
  const cur = { timestamp: 'b', open: 101, high: 106, low: 100.5, close: 105 };
  const hits = twoCandle(prev, cur);
  assert.ok(!hits.some(h => h.pattern.includes('engulfing')));
});

// ---- unit: csv parsing ----
test('parseCsv: header case-insensitive, valid candles', () => {
  const { candles, badRows } = parseCsv('Timestamp,Open,High,Low,Close\n2024-01-01,100,105,95,102\n');
  assert.equal(candles.length, 1);
  assert.equal(badRows, 0);
  assert.equal(candles[0].close, 102);
});

test('parseCsv: missing column throws with column name', () => {
  assert.throws(() => parseCsv('timestamp,open,high,close\n2024-01-01,100,105,102\n'), /missing required column.*low/);
});

test('parseCsv: bad row skipped, counted', () => {
  const { candles, badRows } = parseCsv('timestamp,open,high,low,close\n2024-01-01,100,105,95,102\nbad,row,here\n2024-01-02,102,107,100,106\n');
  assert.equal(candles.length, 2);
  assert.equal(badRows, 1);
});

test('scan: full pipeline finds engulfing in a series', () => {
  const candles = [
    { timestamp: 'a', open: 100, high: 101, low: 98.5, close: 99 },
    { timestamp: 'b', open: 98.6, high: 102, low: 98.4, close: 101.5 },
    { timestamp: 'c', open: 101.5, high: 103, low: 100, close: 102 },
  ];
  const sigs = scan(candles);
  assert.ok(sigs.some(s => s.pattern === 'bullish-engulfing' && s.index === 1));
});

// ---- e2e: real CLI process ----
const CSV = 'timestamp,open,high,low,close\n' +
  '2024-01-01,100,101,98.5,99\n' +
  '2024-01-02,98.6,102,98.4,101.5\n';

function tmpFile(name, content) {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-')), name);
  fs.writeFileSync(p, content);
  return p;
}

function runCli(args, input) {
  return spawnSync(process.execPath, [BIN, ...args], {
    input, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' },
  });
}

test('e2e: scans file, exit 0, table lists pattern', () => {
  const f = tmpFile('d.csv', CSV);
  const r = runCli([f]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /bullish-engulfing/);
  assert.match(r.stdout, /scanned 2 candles/);
});

test('e2e: --json outputs parseable array', () => {
  const f = tmpFile('d.csv', CSV);
  const r = runCli(['--json', f]);
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.ok(Array.isArray(j) && j.length > 0);
  assert.ok(j.every(x => x.timestamp && x.pattern && [1, 2, 3].includes(x.strength)));
});

test('e2e: bad csv -> exit 1, clean message, no stack trace', () => {
  const f = tmpFile('bad.csv', 'timestamp,open\n2024-01-01,100\n');
  const r = runCli([f]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /missing required column/);
  assert.ok(!r.stderr.includes('at '), 'no stack trace');
});

test('e2e: unknown flag -> exit 2', () => {
  const r = runCli(['--frobnicate']);
  assert.equal(r.status, 2);
});

test('e2e: stdin input works', () => {
  const r = runCli([], CSV);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /bullish-engulfing/);
});

test('e2e: --write without --yes is dry-run (no file created)', () => {
  const f = tmpFile('d.csv', CSV);
  const out = path.join(path.dirname(f), 'annotated.csv');
  const r = runCli(['--write', out, f]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /dry-run/);
  assert.ok(!fs.existsSync(out), 'file must NOT be written in dry-run');
});

test('e2e: --write --yes writes annotated csv with pattern column', () => {
  const f = tmpFile('d.csv', CSV);
  const out = path.join(path.dirname(f), 'annotated.csv');
  const r = runCli(['--write', out, '--yes', f]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(out));
  const content = fs.readFileSync(out, 'utf8');
  assert.match(content, /pattern,strength/);
  assert.match(content, /bullish-engulfing/);
});

test('e2e: NO_COLOR strips ANSI codes', () => {
  const f = tmpFile('d.csv', CSV);
  const r = runCli([f]);
  assert.ok(!/\x1b\[/.test(r.stdout), 'stdout must not contain ANSI codes');
});
