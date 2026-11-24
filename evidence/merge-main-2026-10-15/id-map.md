# BA-9 ids renumbered ahead of merging main (commit 58abf47)

Generated from `git show 35db496:specs/...` (before) and `git show 58abf47:specs/...` (after). Past changelog, retrospective and evidence entries of BA-9 keep the old ids; read them through this map.

## agents-evals rules (+43; main owns R63–R105)

| Old | New |
|---|---|
| R63 | R106 |
| R64 | R107 |
| R65 | R108 |
| R66 | R109 |
| R67 | R110 |
| R68 | R111 |
| R69 | R112 |
| R70 | R113 |
| R71 | R114 |
| R72 | R115 |
| R73 | R116 |
| R74 | R117 |
| R75 | R118 |
| R76 | R119 |
| R77 | R120 |
| R78 | R121 |
| R79 | R122 |
| R80 | R123 |
| R81 | R124 |
| R82 | R125 |
| R90 | R133 |
| R100 | R143 |
| R101 | R144 |
| R102 | R145 |
| R103 | R146 |
| R104 | R147 |
| R105 | R148 |
| R106 | R149 |
| R107 | R150 |
| R108 | R151 |
| R109 | R152 |
| R110 | R153 |
| R120 | R163 |
| R121 | R164 |
| R122 | R165 |
| R123 | R166 |
| R124 | R167 |
| R125 | R168 |
| R126 | R169 |
| R140 | R183 |
| R141 | R184 |
| R142 | R185 |
| R143 | R186 |
| R144 | R187 |
| R145 | R188 |
| R146 | R189 |
| R147 | R190 |
| R148 | R191 |
| R160 | R203 |
| R161 | R204 |
| R162 | R205 |
| R163 | R206 |
| R164 | R207 |

## testing-data rules (+1; main owns R21)

| Old | New |
|---|---|
| R21 | R22 |
| R22 | R23 |
| R23 | R24 |
| R24 | R25 |

## data-model sections (main owns 4.8, *Old user skill folder*)

| Old | New |
|---|---|
| 4.8 Eval question bank files | 4.9 |
| 4.9 Sample fixture data | 4.10 |

## Seed files (main owns `003_intellify.sql.gz`)

| Old | New |
|---|---|
| `003_health_insurance 004_health_insurance.sql` | `.sql` |
| `004_genomics 005_genomics.sql` | `.sql` |
| `005_supply_chain 006_supply_chain.sql` | `.sql` |
| `006_finance 007_finance.sql` | `.sql` |
| `007_marketing_analytics 008_marketing_analytics.sql` | `.sql` |

## Modules

| Old | New |
|---|---|
| `backend/src/mastra/evals/eval-sets.ts` (the set-file loader) | `eval-set-files.ts` — main's `eval-sets.ts` is the per-agent registry |

## Roadmap

| Feature | Old | New |
|---|---|---|
| Intellify sample as a Testing Data fixture (BA-212, from main) | 1.1.2 | 1.1.19 |
