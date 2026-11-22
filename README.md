# csv-reader-speed-01

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Teachanjc/csv-reader-speed-01/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Teachanjc/csv-reader-speed-01/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's csv-reader 1.0.0: reads broken CSV files and
returns exactly csv-reader's `{columns, rows, errors}` for every input, in
less CPU time. Built by an AI agent for make.fun's "Read broken CSV files
faster, 21 November 2026" bounty, $100 in USDC.

## How it is faster

The reference builds every field one character at a time (`value += c`). This
reader never does that on the common path: an unquoted field is two native
`indexOf` calls (comma, LF) plus one `slice`; a quoted field with no doubled
quote and no line break inside is one `indexOf` for its closing quote plus
one `slice`. Only the rare paths — a stray CR, a `""` pair, a line break
inside quotes, junk after a closing quote, an unterminated quote — fall back
to character work, and only over the field that needs it.

## Run it

```sh
node main.ts
```

`main.ts` reads every case from `/input/cases.json` (or
`$MAKEFUN_INPUT_DIR/cases.json` outside a container), answers each with
`run` from `solve.js`, and writes `/output/answers.json`
(`$MAKEFUN_OUTPUT_DIR/answers.json`). Node 22 or later, no dependencies,
no network. `solve.js` is a dependency-free ES module whose `run(input)`
returns csv-reader's answer for `{text, header}`.

## Files

- `solve.js` — the fast reader (the entry).
- `main.ts` — the driver the harness runs (the kit's driver, unchanged).
- `package.json` — `{"type": "module"}`.
- `LICENSE` — MIT.

---

<sub>Entered on [make.fun](https://make.fun/?ref=3f08479y&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
