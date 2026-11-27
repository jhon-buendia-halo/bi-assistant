# Readiness rubric (v1.0)

The standard assess_readiness applies. It is versioned so assessments compare over time; every assessment records its version.

## 1. Dimensions
| # | Dimension | Question it answers | Applies to |
|---|---|---|---|
| D1 | Availability and access | Does the data exist, is it accessible and does it have an owner? | All |
| D2 | Quality | Is the data complete, unique, valid, consistent and accurate? | All |
| D3 | Freshness and reliability | Does it arrive on time and steadily? | All |
| D4 | Semantics and documentation | Is it clear what each thing means and where it comes from? | All |
| D5 | Governance and privacy | Can it be used legally and safely? | All |
| D6 | AI fitness | Does it meet the specific needs of ML, RAG or agents? | AI uses only |

## 2. Levels (0-4)
| Level | Name | General meaning |
|---|---|---|
| 0 | Non-existent | Does not exist or cannot be accessed |
| 1 | Initial | Exists, but with serious problems that prevent the use |
| 2 | Partial | Usable with important limitations and manual supervision |
| 3 | Adequate | Meets the use's requirements with minor documented limitations |
| 4 | Optimal | Meets them comfortably, with monitoring and automatic controls |
| N/E | Not evaluated | Could not be measured (no access or no evidence). Never averaged as 0 or 4 |

## 3. Criteria by dimension
| Dimension | Level 1 | Level 2 | Level 3 | Level 4 |
|---|---|---|---|---|
| D1 Availability | Exists but without stable access or without an owner | Manual or awkward access; informal owner | Programmatic access; defined owner | Governed self-service access; owner and support channel |
| D2 Quality | Serious failures in key fields (>20 % nulls, massive duplicates) | Known moderate failures; no tests | Within the use's thresholds; basic tests | Within thresholds with automatic tests and alerts |
| D3 Freshness | Manual or irregular loads | Automatic loads with frequent failures or no SLA | Meets the required SLA on >= 95 % of loads | Meets the SLA on >= 99 %, with monitoring and a stable schema |
| D4 Semantics | No documentation; cryptic names | Partial documentation (< 50 % of key columns) | Key columns documented; metrics defined | Semantic layer or governed metrics; complete lineage |
| D5 Governance | No classification; uncontrolled personal data | Partial classification; broad access | Classified; personal data masked; role-based access | All of the above + documented retention, audit and legal basis |
| D6 AI fitness | Insufficient volume, labels or format | Sufficient with important biases or gaps | Representative, labelled and documented for the use | All of the above + versioning, reproducible splits and drift monitoring |

Where the evidence sits between two levels, the lower one is taken. A criterion the app cannot measure caps the level at what was measured and is listed as not evaluated. When one critical source is much worse than the others, the dimension takes the weakest critical source's level, not the average.

## 4. Blocking gates
If any fails, the verdict is **Not ready**, whatever the scores.

| Gate | Failure condition |
|---|---|
| G1 Access | The critical source is not accessible (D1 = 0) |
| G2 Owner | No critical source has an identifiable owner |
| G3 Legal basis | There is personal data without a legal basis or a purpose compatible with the use |
| G4 Exposed personal data | Unclassified, unmasked personal data in a use that does not need it |
| G5 Key field | A field indispensable to the use has quality level <= 1 |
| G6 Critical freshness | Freshness is below the minimum the use requires (the use needs daily data and it arrives weekly) |

## 5. Weights by use type
| Use type | D1 | D2 | D3 | D4 | D5 | D6 |
|---|---|---|---|---|---|---|
| Ad hoc analytics (`analytics`) | 15 % | 30 % | 15 % | 25 % | 15 % | — |
| Dashboard / recurring report (`dashboard`) | 10 % | 25 % | 25 % | 25 % | 15 % | — |
| ML model (`ml`) | 10 % | 25 % | 15 % | 10 % | 15 % | 25 % |
| RAG / AI agent (`rag-agent`) | 10 % | 15 % | 15 % | 20 % | 20 % | 20 % |

A critical dimension weighs 20 % or more for the use type. N/E dimensions are left out of the weighted score and their weights redistributed, which is reported; when a critical dimension is N/E there is no weighted score.

## 6. Verdict
| Verdict | Condition |
|---|---|
| **Ready** | Every gate passes, no applicable dimension below 3 and no critical dimension N/E |
| **Ready with conditions** | Every gate passes, no dimension below 2, and each dimension at level 2 has a documented mitigation (a verifiable condition) |
| **Not ready** | A gate fails, or an applicable dimension is below 2, or a critical dimension is N/E |

The weighted score (0-4) is an indicator of progress between assessments. **The verdict is decided by the gates and the minimums, not by the average.**
