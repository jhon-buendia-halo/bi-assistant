# ADR-0031 memory eval — gpt-5.6-luna (low), Phase 3, 2026-11-02

## Runs
| Side | Arm | Model | Repeats | Status | Cost USD | Run ids |
|---|---|---|---|---|---|---|
| noneA | none | openai/gpt-5.6-luna | 3 | completed | 0.1439 | 16c6870f, 21e6bf9a, f78c5d62 |
| noneB | none | openai/gpt-5.6-luna | 3 | completed | 0.1474 | 6cc71431, 065b9096, 52727902 |
| mastraA | mastra | openai/gpt-5.6-luna | 3 | completed | 0.3322 | 6ed4d5b3, 5d84cff0, 495ad032 |
| mastraB | mastra | openai/gpt-5.6-luna | 3 | completed | 0.3289 | 96fbe94b, b70ff9a5, 1b95111d |

## Pass^k by category (questions passed / scored · attempt pass rate)
| Category | noneA | noneB | mastraA | mastraB |
|---|---|---|---|---|
| memory-reuse | 2/6 (33.3%) · 44.4% | 3/6 (50.0%) · 50.0% | 6/6 (100.0%) · 100.0% | 6/6 (100.0%) · 100.0% |
| memory-correction | 2/6 (33.3%) · 55.6% | 4/6 (66.7%) · 66.7% | 6/6 (100.0%) · 100.0% | 6/6 (100.0%) · 100.0% |
| memory-update | 3/6 (50.0%) · 61.1% | 2/6 (33.3%) · 50.0% | 6/6 (100.0%) · 100.0% | 6/6 (100.0%) · 100.0% |
| memory-rejected | 5/6 (83.3%) · 83.3% | 3/6 (50.0%) · 72.2% | 6/6 (100.0%) · 100.0% | 6/6 (100.0%) · 100.0% |
| memory-abstain | 6/6 (100.0%) · 100.0% | 6/6 (100.0%) · 100.0% | 0/6 (0.0%) · 0.0% | 0/6 (0.0%) · 0.0% |
| memory-vs-curated | 5/6 (83.3%) · 83.3% | 5/6 (83.3%) · 88.9% | 4/6 (66.7%) · 83.3% | 3/6 (50.0%) · 77.8% |
| LEARNING (4) | 12/24 (50.0%) · 61.1% | 12/24 (50.0%) · 59.7% | 24/24 (100.0%) · 100.0% | 24/24 (100.0%) · 100.0% |

### dev
| Category | noneA | noneB | mastraA | mastraB |
|---|---|---|---|---|
| memory-reuse | 2/4 | 3/4 | 4/4 | 4/4 |
| memory-correction | 1/4 | 3/4 | 4/4 | 4/4 |
| memory-update | 3/4 | 2/4 | 4/4 | 4/4 |
| memory-rejected | 4/4 | 3/4 | 4/4 | 4/4 |
| memory-abstain | 4/4 | 4/4 | 0/4 | 0/4 |
| memory-vs-curated | 4/4 | 4/4 | 3/4 | 3/4 |
| LEARNING (4) | 10/16 | 11/16 | 16/16 | 16/16 |

### held-out
| Category | noneA | noneB | mastraA | mastraB |
|---|---|---|---|---|
| memory-reuse | 0/2 | 0/2 | 2/2 | 2/2 |
| memory-correction | 1/2 | 1/2 | 2/2 | 2/2 |
| memory-update | 0/2 | 0/2 | 2/2 | 2/2 |
| memory-rejected | 1/2 | 0/2 | 2/2 | 2/2 |
| memory-abstain | 2/2 | 2/2 | 0/2 | 0/2 |
| memory-vs-curated | 1/2 | 1/2 | 1/2 | 0/2 |
| LEARNING (4) | 2/8 | 1/8 | 8/8 | 8/8 |

## Rule 1 — A/A noise (learning categories)
- none: A 12/24, B 12/24, gap 0.0 pts (B−A interval -26.3 pts to +26.3 pts)
  - memory-reuse: 2/6 vs 3/6
  - memory-correction: 2/6 vs 4/6
  - memory-update: 3/6 vs 2/6
  - memory-rejected: 5/6 vs 3/6
  - memory-abstain: 6/6 vs 6/6
  - memory-vs-curated: 5/6 vs 5/6
- mastra: A 24/24, B 24/24, gap 0.0 pts (B−A interval -13.8 pts to +13.8 pts)
  - memory-reuse: 6/6 vs 6/6
  - memory-correction: 6/6 vs 6/6
  - memory-update: 6/6 vs 6/6
  - memory-rejected: 6/6 vs 6/6
  - memory-abstain: 0/6 vs 0/6
  - memory-vs-curated: 4/6 vs 3/6
- **noise = 0.0 pts** (the larger A/A gap)

## Rule 2 — may memory be on by default?
- a. learning: none 24/48 (50.0%), mastra 48/48 (100.0%); d = +50.0 pts vs noise 0.0 pts → **beats beyond noise** (for information: Newcombe +34.5 pts to +63.6 pts, eval:diff flag `up`)
  - memory-reuse: none 5/12, mastra 12/12 (+58.3 pts)
  - memory-correction: none 6/12, mastra 12/12 (+50.0 pts)
  - memory-update: none 5/12, mastra 12/12 (+58.3 pts)
  - memory-rejected: none 8/12, mastra 12/12 (+33.3 pts)
- b. abstain: none 12/12, mastra 0/12 (-100.0 pts) → **WORSE beyond noise**; M3 teachNotRecalled under mastra 6/36 attempts
- c. existing sets: not worse by construction (R238, OD-8: no teach signal, nothing recalled); not measured.
- d. M1 under mastra: 216/216 attempts → **100%**
- vs-curated (information): none 10/12, mastra 7/12 (-25.0 pts) — WORSE beyond noise
- M2 notRejectedSql under mastra (information): 36/36 attempts
- **Rule 2 verdict: memory may NOT be on by default**

## Rule 3 — build the Hindsight + Mastra arm?
- mastra on the learning categories: 100.0% (A+B) → **at or above 80%: no Hindsight arm; this set cannot show a gain from it**

## Cost and recall
- noneA: 0.1439 USD, 0.0040 USD per case (36 cases)
- noneB: 0.1474 USD, 0.0041 USD per case (36 cases)
- mastraA: 0.3322 USD, 0.0092 USD per case (36 cases), recall p50 5 ms · p90 637 ms over 108 attempts
- mastraB: 0.3289 USD, 0.0091 USD per case (36 cases), recall p50 5 ms · p90 576 ms over 108 attempts
