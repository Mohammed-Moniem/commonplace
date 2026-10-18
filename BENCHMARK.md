# Reproducing the benchmarks

These benchmarks measure finite local Commonplace behavior contracts, not complete Google Workspace or Microsoft Office parity.

## Clean-checkout commands

Use Node 24 and run from the repository root:

```sh
npm ci --ignore-scripts
npm run benchmark
npm run benchmark:cells
npm run benchmark:features
node scripts/verify.mjs
```

Use `npm.cmd` in Windows PowerShell. The GitHub Actions matrix runs these checks on Ubuntu, macOS, and Windows; its actual run status establishes platform results.

| Check | Measures |
| --- | --- |
| Baseline | Extracts the included immutable Commonplace 0.1 ZIP into temporary storage. Thirty identical Docs/Sheets/Slides fixtures compare selected missing old capabilities against current source; current regression tests also run. |
| Cells | Fifty-six clipboard, value, formula-assistance and daily-editing contracts. |
| Features | Requires passing checks for all 60 additions in the feature plan, plus shared templates/linked-data and the full regression suite. Repeated assertions do not inflate the 60-feature count. |
| Distribution | Tests, isolated build, JavaScript syntax, ZIP contents, actual extracted-server launch/assets/API create, process restart and saved-content recovery. |

Fresh machine reports are generated under ignored `evidence/` directories. They bind the actual source digests and exact case counts and retain raw events. A result for another source checkout is not current verification. The commands reject source changes during a run.

## Published inputs

The repository includes the audited synthetic `docs-cases.json`, `sheets-cases.json`, and `slides-cases.json`, plus `evidence/benchmark-v2/baseline/commonplace-0.1.0.zip`. That baseline contains earlier **Commonplace source**, not Google source or a personal SQLite workspace.

Personal browser captures, private development provenance, machine activation receipts, and captured third-party HTML are excluded from publication. Current reports are reproduced locally. After the three benchmarks succeed, `node scripts/report-benchmark.mjs` can replace this guide with a current source-bound summary.

## Acceptance boundary

Assertions exercise actual editor transactions, formula expected values, native OOXML structures, APIs and SQLite persistence. Native Office XML assertions do not substitute for opening files in Word, Excel, or PowerPoint. Browser-native uploads, pointer interactions, presenter windows, print layout, accessibility, and exhaustive third-party interoperability require separate manual review.

Complete original Google runtime behavior was unavailable without account verification. Static analysis of an earlier replacement and public product documentation do not establish complete original-product equivalence. A finite passing case set leaves full Google/Office parity unproven.
