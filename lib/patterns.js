// lib/patterns.js — pure candlestick pattern detection (no I/O).
'use strict';

const DEFAULTS = Object.freeze({
  dojiRatio: 0.1,      // body/range <= dojiRatio        -> doji
  wickRatio: 2.0,      // lowerWick/body >= wickRatio    -> hammer candidate
  smallWick: 0.25,     // upperWick/range <= smallWick   -> hammer candidate
  marubozuRatio: 0.9,  // body/range >= marubozuRatio    -> marubozu
});

function geom(c) {
  const open = +c.open, high = +c.high, low = +c.low, close = +c.close;
  const body = Math.abs(close - open);
  const range = high - low;
  const bullish = close >= open;
  const upperWick = high - Math.max(open, close);
  const lowerWick = Math.min(open, close) - low;
  return { open, high, low, close, body, range, bullish, upperWick, lowerWick };
}

function isZero(range) { return range <= 0; }

// strength: 1 (weak) .. 3 (strong) from how far a ratio exceeds its threshold
function strength3(ratio, threshold) {
  if (ratio <= threshold) return 1;
  if (ratio >= threshold * 2) return 3;
  return 2;
}

function singleCandle(c, opt = {}) {
  const o = Object.assign({}, DEFAULTS, opt);
  const g = geom(c);
  const hits = [];
  if (isZero(g.range)) return hits;

  // doji: tiny body relative to range
  if (g.body / g.range <= o.dojiRatio) {
    hits.push({ pattern: 'doji', strength: strength3(o.dojiRatio / Math.max(g.body / g.range, 1e-9), 1) });
  }
  // marubozu: almost no wicks
  if (g.body / g.range >= o.marubozuRatio) {
    hits.push({
      pattern: g.bullish ? 'marubozu-bullish' : 'marubozu-bearish',
      strength: strength3(g.body / g.range / o.marubozuRatio, 1),
    });
  }
  // hammer: long lower wick, small upper wick, body in the upper half
  if (g.body > 0 &&
      g.lowerWick / g.body >= o.wickRatio &&
      g.upperWick / g.range <= o.smallWick &&
      (g.close + g.open) / 2 >= (g.high + g.low) / 2) {
    hits.push({ pattern: 'hammer', strength: strength3(g.lowerWick / g.body / o.wickRatio, 1) });
  }
  // shooting star: mirror of hammer (body in the lower half)
  if (g.body > 0 &&
      g.upperWick / g.body >= o.wickRatio &&
      g.lowerWick / g.range <= o.smallWick &&
      (g.close + g.open) / 2 <= (g.high + g.low) / 2) {
    hits.push({ pattern: 'shooting-star', strength: strength3(g.upperWick / g.body / o.wickRatio, 1) });
  }
  // spinning top: both wicks long relative to body, body small (but not doji)
  if (g.body > 0 && g.body / g.range > o.dojiRatio &&
      g.upperWick / g.body >= 1.0 && g.lowerWick / g.body >= 1.0) {
    hits.push({ pattern: 'spinning-top', strength: 1 });
  }
  return hits;
}

function twoCandle(prev, cur, opt = {}) {
  const hits = [];
  const p = geom(prev), c = geom(cur);
  if (isZero(p.range) || isZero(c.range) || p.body <= 0 || c.body <= 0) return hits;

  // engulfing: current body fully covers previous body, opposite directions
  const pTop = Math.max(p.open, p.close), pBot = Math.min(p.open, p.close);
  const cTop = Math.max(c.open, c.close), cBot = Math.min(c.open, c.close);
  if (c.bullish !== p.bullish && cTop >= pTop && cBot <= pBot) {
    const ratio = c.body / p.body;
    hits.push({
      pattern: c.bullish ? 'bullish-engulfing' : 'bearish-engulfing',
      strength: ratio >= 2 ? 3 : ratio >= 1.2 ? 2 : 1,
    });
  }
  // inside bar: current range fully inside previous range
  if (c.high < p.high && c.low > p.low) {
    hits.push({ pattern: 'inside-bar', strength: 1 });
  }
  return hits;
}

// Scan an array of candle objects {timestamp,open,high,low,close[,volume]}.
// Returns array of {index, timestamp, pattern, strength}.
function scan(candles, opt = {}) {
  const o = Object.assign({}, DEFAULTS, opt);
  const allow = opt.patterns ? new Set(opt.patterns.split(',').map(s => s.trim().toLowerCase())) : null;
  const out = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const hits = singleCandle(c, o);
    if (i > 0) hits.push(...twoCandle(candles[i - 1], c, o));
    for (const h of hits) {
      if (allow && !allow.has(h.pattern)) continue;
      out.push({ index: i, timestamp: c.timestamp, pattern: h.pattern, strength: h.strength });
    }
  }
  return out;
}

const REQUIRED = ['timestamp', 'open', 'high', 'low', 'close'];

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length < 2) throw new Error('CSV needs a header row and at least one data row');
  const header = lines[0].split(',').map(h => h.trim().toLowerCase());
  const missing = REQUIRED.filter(r => !header.includes(r));
  if (missing.length) throw new Error(`missing required column(s): ${missing.join(', ')}`);
  const idx = {};
  header.forEach((h, i) => { idx[h] = i; });
  const candles = [];
  const errs = [];
  for (let n = 1; n < lines.length; n++) {
    const cells = lines[n].split(',');
    try {
      const c = { timestamp: cells[idx.timestamp].trim() };
      for (const k of ['open', 'high', 'low', 'close']) {
        const v = Number(cells[idx[k]]);
        if (!Number.isFinite(v)) throw new Error(`row ${n + 1}: ${k} is not a number`);
        c[k] = v;
      }
      if (idx.volume !== undefined) c.volume = Number(cells[idx.volume]) || 0;
      if (c.high < c.low) throw new Error(`row ${n + 1}: high < low`);
      if (c.high < Math.max(c.open, c.close) || c.low > Math.min(c.open, c.close)) {
        throw new Error(`row ${n + 1}: open/close outside high-low range`);
      }
      candles.push(c);
    } catch (e) {
      errs.push(e.message);
    }
  }
  if (!candles.length) throw new Error(`no valid candles (${errs.length} bad row(s): ${errs.slice(0, 3).join('; ')})`);
  return { candles, badRows: errs.length, header: lines[0] };
}

module.exports = { scan, singleCandle, twoCandle, parseCsv, geom, DEFAULTS, REQUIRED };
