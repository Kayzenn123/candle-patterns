# candle-patterns

> Detect candlestick patterns (doji, engulfing, hammer) in OHLC CSV data. Daily Tools #26.

## Why

A trader exporting daily bars from their broker or Yahoo Finance wants to
answer one question fast: "which candles formed recognizable patterns?".
The closest existing tool,
[kjcingel/CandlestickPatternRecognizer](https://github.com/kjcingel/CandlestickPatternRecognizer),
reads CSVs and finds patterns, but it is not a proper CLI: no `--json`
for scripting, no configurable thresholds, no write-back of annotated
data, and no dry-run safety. `candle-patterns` is a zero-dependency Node
CLI: scan from file or stdin, get a human table or machine JSON, and
optionally write an annotated CSV back — always dry-run first, never
surprise writes.

## Install

```bash
git clone https://github.com/Kayzenn123/candle-patterns.git
cd candle-patterns
npm link   # optional: makes `candle-patterns` available globally
```

Requires: Node >= 18. No dependencies.

## Usage

```bash
candle-patterns data.csv                  # human-readable table
candle-patterns data.csv --json           # machine-readable JSON
cat data.csv | candle-patterns --json
candle-patterns data.csv --pattern doji,hammer --doji 0.15
candle-patterns data.csv --write annotated.csv        # DRY-RUN: preview only
candle-patterns data.csv --write annotated.csv --yes  # actually write
```

CSV input needs a header with `timestamp,open,high,low,close` (extra
columns like `volume` are kept on write-back).

| Flag | Function | Default |
| --- | --- | --- |
| `--json` | JSON array output instead of table | off |
| `--pattern <list>` | only report these patterns (comma-separated) | all 9 |
| `--doji <r>` | body/range ratio at or below which a candle counts as doji | 0.1 |
| `--wick <r>` | lower-wick/body ratio required for hammer/shooting-star | 2.0 |
| `--write <OUT.csv>` | write CSV back with `pattern` and `strength` columns | dry-run preview |
| `--yes` | confirm `--write` (disables dry-run) | off |

Exit codes: `0` ok, `1` runtime error (bad file/CSV), `2` usage error.
Respects `NO_COLOR`; colors are off when stdout is not a TTY.

## Example output

Command:

```bash
candle-patterns gold-2025.csv
```

Output (real, copied from an actual run):

```text
timestamp             pattern             str  o/h/l/c
2025-01-02            spinning-top           1    2650/2654.31/2645.43/2651.71
2025-01-03            spinning-top           1    2651.71/2658.82/2648.27/2655.05
2025-01-04            inside-bar             1    2655.05/2656.67/2654.81/2655.91
2025-01-05            bearish-engulfing      3    2655.91/2657.35/2647.65/2652.64
2025-01-06            bullish-engulfing      1    2652.64/2659.5/2650.83/2656.14
2025-01-08            bullish-engulfing      2    2653.29/2662.95/2651.04/2658.75
...
2025-06-10            doji                   2    2744.16/2752.16/2743.66/2744.66
2025-06-10            shooting-star          3    2744.16/2752.16/2743.66/2744.66

scanned 159 candles, found 131 signal(s)
```

Dry-run write-back preview (real run):

```text
dry-run: would write 159 rows (107 annotated) to /home/user/runs/annotated.csv
preview (first annotated rows):
timestamp,open,high,low,close,pattern,strength
2025-01-02,2650,2654.31,2645.43,2651.71,spinning-top,1
2025-01-03,2651.71,2658.82,2648.27,2655.05,spinning-top,1
no file written. Re-run with --yes to write.
```

## How it works

1. Parse the CSV (header required, case-insensitive; bad rows are
   skipped and counted, fatal only when nothing valid remains).
2. For each candle compute geometry: body, range, upper/lower wick.
   Single-candle rules fire on ratios (doji, hammer, shooting-star,
   marubozu, spinning-top); two-candle rules compare neighbors
   (engulfing, inside-bar). Strength 1–3 comes from how far the
   measured ratio exceeds its threshold — no lookahead, no future data.
3. Render a table, JSON, or an annotated CSV (extra `pattern`,
   `strength` columns; multiple hits joined with `|`).
4. Core logic lives in `lib/patterns.js` as pure functions, separate
   from the CLI in `bin/candle-patterns.js`.

## Limitations

- Only 9 classic patterns; no advanced ones (harami, three-soldiers,
  evening/morning star).
- Strength is a geometric heuristic, not a prediction of what price
  does next.
- CSV only; live broker feeds are out of scope.
- Engulfing requires the previous candle's body to be non-zero
  (zero-range rows never match two-candle patterns).
- Assumes timestamps are already sorted; no date parsing is done.

## Disclaimer

This tool is for analysis and education only. It is not investment
advice. Detected patterns describe past price shapes; backtest results
and pattern counts do not guarantee future returns. Always do your own
research and never trade money you cannot afford to lose.

## Development

```bash
npm test   # 24 tests (unit + end-to-end), must pass twice in a row
```

## License

MIT

---
Ringkasan (Bahasa Indonesia): `candle-patterns` memindai file CSV OHLC
(timestamp,open,high,low,close) lalu menandai 9 pola candlestick klasik
(doji, engulfing, hammer, shooting-star, inside-bar, marubozu,
spinning-top) lengkap dengan skor kekuatan 1–3. Output berupa tabel di
terminal atau JSON (`--json`), dan bisa menulis ulang CSV dengan kolom
tambahan `pattern`/`strength` — aksi tulis selalu dry-run dulu sampai
dikasih `--yes`. Jalan tanpa dependensi di Node ≥ 18. Bukan saran
investasi: pola hanya mendeskripsikan bentuk harga di masa lalu.
