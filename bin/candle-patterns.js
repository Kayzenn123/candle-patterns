#!/usr/bin/env node
// candle-patterns — detect candlestick patterns in OHLC CSV data.
'use strict';
const fs = require('fs');
const path = require('path');
const { scan, parseCsv, DEFAULTS } = require('../lib/patterns');

const VERSION = '1.0.0';
const PATTERNS = ['doji', 'hammer', 'shooting-star', 'bullish-engulfing', 'bearish-engulfing', 'inside-bar', 'marubozu-bullish', 'marubozu-bearish', 'spinning-top'];

const HELP = `candle-patterns ${VERSION}
Detect candlestick patterns (doji, engulfing, hammer, ...) in OHLC CSV data.

Usage:
  candle-patterns [FILE] [options]
  cat data.csv | candle-patterns [options]

CSV needs a header with: timestamp,open,high,low,close[,volume]

Options:
  --json                  machine-readable JSON output
  --pattern <list>        only report these patterns (comma-separated)
  --doji <r>              body/range ratio at or below which a candle is a
                          doji (default ${DEFAULTS.dojiRatio})
  --wick <r>              lower-wick/body ratio for hammer/shooting-star
                          (default ${DEFAULTS.wickRatio})
  --write <OUT.csv>       write input CSV back with extra pattern,strength
                          columns. DRY-RUN by default: prints a preview and
                          writes nothing. Add --yes to actually write.
  --yes                   confirm the --write action (disables dry-run)
  --help                  show this help
  --version               show version

Exit codes: 0 ok, 1 runtime error, 2 usage error.

Environment: NO_COLOR disables color output. Colors are off when stdout
is not a TTY.

Patterns: ${PATTERNS.join(', ')}
`;

function usageError(msg) { process.stderr.write(`error: ${msg}\ntry: candle-patterns --help\n`); process.exit(2); }
function runtimeError(msg) { process.stderr.write(`error: ${msg}\n`); process.exit(1); }

function parseArgs(argv) {
  const o = { file: null, json: false, patterns: null, doji: DEFAULTS.dojiRatio,
              wick: DEFAULTS.wickRatio, write: null, yes: false };
  const a = argv.slice();
  while (a.length) {
    const t = a.shift();
    if (t === '--help') { process.stdout.write(HELP); process.exit(0); }
    else if (t === '--version') { process.stdout.write(VERSION + '\n'); process.exit(0); }
    else if (t === '--json') o.json = true;
    else if (t === '--yes') o.yes = true;
    else if (t === '--pattern') {
      const v = a.shift(); if (!v) usageError('--pattern needs a value');
      const list = v.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      const bad = list.filter(p => !PATTERNS.includes(p));
      if (bad.length) usageError(`unknown pattern(s): ${bad.join(', ')}`);
      o.patterns = list.join(',');
    }
    else if (t === '--doji') { const v = Number(a.shift()); if (!(v > 0 && v < 1)) usageError('--doji needs a number between 0 and 1'); o.doji = v; }
    else if (t === '--wick') { const v = Number(a.shift()); if (!(v > 0)) usageError('--wick needs a positive number'); o.wick = v; }
    else if (t === '--write') { const v = a.shift(); if (!v) usageError('--write needs an output path'); o.write = v; }
    else if (t.startsWith('-')) usageError(`unknown flag: ${t}`);
    else if (o.file) usageError('only one input file allowed');
    else o.file = t;
  }
  return o;
}

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const C = {
  head: s => useColor ? `\x1b[1m${s}\x1b[0m` : s,
  pat: s => useColor ? `\x1b[33m${s}\x1b[0m` : s,
  strong: s => useColor ? `\x1b[1;32m${s}\x1b[0m` : s,
};

function humanTable(candles, signals) {
  const byIndex = new Map();
  for (const s of signals) {
    if (!byIndex.has(s.index)) byIndex.set(s.index, []);
    byIndex.get(s.index).push(s);
  }
  const lines = [];
  lines.push(C.head('timestamp'.padEnd(20) + '  pattern'.padEnd(22) + 'str  o/h/l/c'));
  for (let i = 0; i < candles.length; i++) {
    const sigs = byIndex.get(i);
    if (!sigs) continue;
    const c = candles[i];
    for (const s of sigs) {
      const ohlc = [c.open, c.high, c.low, c.close].join('/');
      lines.push(
        String(c.timestamp).padEnd(20) + '  ' +
        C.pat(s.pattern).padEnd(22) + ' ' +
        String(s.strength) + '    ' + ohlc
      );
    }
  }
  return lines.join('\n');
}

function annotateCsv(headerLine, candles, signals) {
  const byIndex = new Map();
  for (const s of signals) {
    if (!byIndex.has(s.index)) byIndex.set(s.index, []);
    byIndex.get(s.index).push(s);
  }
  const cols = headerLine.split(',');
  const rows = [cols.concat(['pattern', 'strength']).join(',')];
  candles.forEach((c, i) => {
    const sigs = byIndex.get(i) || [];
    const vals = cols.map(h => {
      const k = h.trim().toLowerCase();
      return k === 'timestamp' ? c.timestamp : c[k];
    });
    const pat = sigs.map(s => s.pattern).join('|');
    const str = sigs.map(s => s.strength).join('|');
    rows.push(vals.concat([pat, str]).join(','));
  });
  return rows.join('\n') + '\n';
}

function readAll() {
  return new Promise((resolve, reject) => {
    let s = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', d => { s += d; });
    process.stdin.on('end', () => resolve(s));
    process.stdin.on('error', reject);
  });
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  let text;
  if (o.file) {
    try { text = fs.readFileSync(o.file, 'utf8'); }
    catch (e) { runtimeError(`cannot read "${o.file}": ${e.message}`); }
  } else {
    if (process.stdin.isTTY) usageError('no input file and stdin is a TTY (nothing to read)');
    text = await readAll();
    if (!text.trim()) runtimeError('empty input on stdin');
  }

  let candles, headerLine, badRows;
  try {
    const p = parseCsv(text);
    candles = p.candles; headerLine = p.header; badRows = p.badRows;
  } catch (e) { runtimeError(e.message); }

  const signals = scan(candles, { dojiRatio: o.doji, wickRatio: o.wick, patterns: o.patterns });

  if (o.write) {
    const csv = annotateCsv(headerLine, candles, signals);
    const annotated = signals.filter((s, i, a) => a.findIndex(x => x.index === s.index) === i).length;
    const out = path.resolve(o.write);
    if (!o.yes) {
      process.stdout.write(
        `dry-run: would write ${candles.length} rows (${annotated} annotated) to ${out}\n` +
        `preview (first annotated rows):\n` +
        csv.split('\n').slice(0, 3).join('\n') + '\n' +
        `no file written. Re-run with --yes to write.\n`
      );
      process.exit(0);
    }
    try { fs.writeFileSync(out, csv); }
    catch (e) { runtimeError(`cannot write "${out}": ${e.message}`); }
    process.stderr.write(`wrote ${candles.length} rows (${annotated} annotated) to ${out}\n`);
  }

  if (o.json) {
    process.stdout.write(JSON.stringify(
      signals.map(s => ({ timestamp: s.timestamp, pattern: s.pattern, strength: s.strength })), null, 2) + '\n');
  } else if (!o.write || o.yes) {
    process.stdout.write(humanTable(candles, signals) + '\n');
    process.stdout.write(`\nscanned ${candles.length} candles, found ${signals.length} signal(s)` +
      (badRows ? `, skipped ${badRows} bad row(s)` : '') + '\n');
  }
}

main().catch(e => runtimeError(e.message));
