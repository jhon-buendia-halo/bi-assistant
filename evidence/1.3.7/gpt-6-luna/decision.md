# ADR-0031 memory eval — gpt-6-luna (low), Phase 5, 2026-11-02

## Runs
| Side | Arm | Model | Repeats | Status | Cost USD | Run ids |
|---|---|---|---|---|---|---|
| noneA | none | openai/gpt-6-luna | 3 | completed | 0.0589 | 9288c1a6, 4ccd416a, 42de8423 |
| noneB | none | openai/gpt-6-luna | 3 | completed | 0.0588 | 2b2218a5, 897d1464, 4bd33b83 |
| mastraA | mastra | openai/gpt-6-luna | 3 | completed | 0.1542 | 98805bb4, 2ca59ff6, b15246b8 |
| mastraB | mastra | openai/gpt-6-luna | 3 | completed | 0.1517 | baa68bda, c530a3d4, 39a36f2a |

## Pass^k by category (questions passed / scored · attempt pass rate)
| Category | noneA | noneB | mastraA | mastraB |
|---|---|---|---|---|
| memory-reuse | 2/6 (33.3%) · 55.6% | 4/6 (66.7%) · 66.7% | 6/6 (100.0%) · 100.0% | 6/6 (100.0%) · 100.0% |
| memory-correction | 2/6 (33.3%) · 44.4% | 3/6 (50.0%) · 55.6% | 5/6 (83.3%) · 94.4% | 6/6 (100.0%) · 100.0% |
| memory-update | 2/6 (33.3%) · 44.4% | 3/6 (50.0%) · 55.6% | 6/6 (100.0%) · 100.0% | 5/6 (83.3%) · 94.4% |
| memory-rejected | 3/6 (50.0%) · 61.1% | 3/6 (50.0%) · 61.1% | 5/6 (83.3%) · 88.9% | 4/6 (66.7%) · 88.9% |
| memory-abstain | 6/6 (100.0%) · 100.0% | 6/6 (100.0%) · 100.0% | 0/6 (0.0%) · 0.0% | 0/6 (0.0%) · 5.6% |
| memory-vs-curated | 4/6 (66.7%) · 83.3% | 4/6 (66.7%) · 66.7% | 4/6 (66.7%) · 83.3% | 6/6 (100.0%) · 100.0% |
| LEARNING (4) | 9/24 (37.5%) · 51.4% | 13/24 (54.2%) · 59.7% | 22/24 (91.7%) · 95.8% | 21/24 (87.5%) · 95.8% |

### dev
| Category | noneA | noneB | mastraA | mastraB |
|---|---|---|---|---|
| memory-reuse | 2/4 | 4/4 | 4/4 | 4/4 |
| memory-correction | 2/4 | 3/4 | 4/4 | 4/4 |
| memory-update | 2/4 | 3/4 | 4/4 | 3/4 |
| memory-rejected | 3/4 | 3/4 | 4/4 | 3/4 |
| memory-abstain | 4/4 | 4/4 | 0/4 | 0/4 |
| memory-vs-curated | 4/4 | 4/4 | 4/4 | 4/4 |
| LEARNING (4) | 9/16 | 13/16 | 16/16 | 14/16 |

### held-out
| Category | noneA | noneB | mastraA | mastraB |
|---|---|---|---|---|
| memory-reuse | 0/2 | 0/2 | 2/2 | 2/2 |
| memory-correction | 0/2 | 0/2 | 1/2 | 2/2 |
| memory-update | 0/2 | 0/2 | 2/2 | 2/2 |
| memory-rejected | 0/2 | 0/2 | 1/2 | 1/2 |
| memory-abstain | 2/2 | 2/2 | 0/2 | 0/2 |
| memory-vs-curated | 0/2 | 0/2 | 0/2 | 2/2 |
| LEARNING (4) | 0/8 | 0/8 | 6/8 | 7/8 |

## Rule 1 — A/A noise (learning categories)
- none: A 9/24, B 13/24, gap 16.7 pts (B−A interval -10.8 pts to +40.9 pts)
  - memory-reuse: 2/6 vs 4/6
  - memory-correction: 2/6 vs 3/6
  - memory-update: 2/6 vs 3/6
  - memory-rejected: 3/6 vs 3/6
  - memory-abstain: 6/6 vs 6/6
  - memory-vs-curated: 4/6 vs 4/6
- mastra: A 22/24, B 21/24, gap 4.2 pts (B−A interval -23.6 pts to +15.2 pts)
  - memory-reuse: 6/6 vs 6/6
  - memory-correction: 5/6 vs 6/6
  - memory-update: 6/6 vs 5/6
  - memory-rejected: 5/6 vs 4/6
  - memory-abstain: 0/6 vs 0/6
  - memory-vs-curated: 4/6 vs 6/6
- **noise = 16.7 pts** (the larger A/A gap)

## Rule 2 — may memory be on by default?
- a. learning: none 22/48 (45.8%), mastra 43/48 (89.6%); d = +43.8 pts vs noise 16.7 pts → **beats beyond noise** (for information: Newcombe +25.6 pts to +58.3 pts, eval:diff flag `up`)
  - memory-reuse: none 6/12, mastra 12/12 (+50.0 pts)
  - memory-correction: none 5/12, mastra 11/12 (+50.0 pts)
  - memory-update: none 5/12, mastra 11/12 (+50.0 pts)
  - memory-rejected: none 6/12, mastra 9/12 (+25.0 pts)
- b. abstain: none 12/12, mastra 0/12 (-100.0 pts) → **WORSE beyond noise**; M3 teachNotRecalled under mastra 6/36 attempts
- c. existing sets: not worse by construction (R238, OD-8: no teach signal, nothing recalled); not measured.
- d. M1 under mastra: 216/216 attempts → **100%**
- vs-curated (information): none 8/12, mastra 10/12 (+16.7 pts)
- M2 notRejectedSql under mastra (information): 36/36 attempts
- **Rule 2 verdict: memory may NOT be on by default**

## Rule 3 — build the Hindsight + Mastra arm?
- mastra on the learning categories: 89.6% (A+B) → **at or above 80%: no Hindsight arm; this set cannot show a gain from it**

## Cost and recall
- noneA: 0.0589 USD, 0.0016 USD per case (36 cases)
- noneB: 0.0588 USD, 0.0016 USD per case (36 cases)
- mastraA: 0.1542 USD, 0.0043 USD per case (36 cases), recall p50 5 ms · p90 523 ms over 108 attempts
- mastraB: 0.1517 USD, 0.0042 USD per case (36 cases), recall p50 5 ms · p90 529 ms over 108 attempts
