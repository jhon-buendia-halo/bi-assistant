# Memory smoke test — feat/hindsight-memory, 2026-10-05

Run by `smoke-memory.cjs` (kept outside the repo; it drives the public HTTP API the UI uses) against the web build on `127.0.0.1:3001` with `HINDSIGHT_URL=http://127.0.0.1:8888` (compose service `hindsight`, image `ghcr.io/vectorize-io/hindsight:0.10.2-slim`, OpenAI `gpt-5-mini` for extraction, `text-embedding-3-small`, reranker `rrf`). Data dir: a copy of the user's profile (World Cup, Health Insurance, Genomics datasets). Dataset used: **World Cup**, datasource `1ba3c9ab-…` → bank `halo-ds-1ba3c9ab-ea4a-4a9a-8eee-ac9feced985c`. Engine lever `memory = recall`. Full record: `smoke-memory-results.json`; log: `smoke-memory-log.txt`.

| Step | Time | What happened |
|---|---|---|
| Q1 (EN) "Which player scored the most goals in the 2018 World Cup, excluding own goals?" | 18:39:46 → 18:40:50 | Answered with SQL over `goals`, `matches`, `tournaments`, `players`; no memory yet (bank created lazily at 18:39:48). 👍 → "Answer saved as a verified query". |
| Retain after the approval | 18:41:21 | Bank holds **6 memories** (tables, joins, 2018 + own-goal filter, ordering, "an analyst approved this SQL"). |
| Q2 (ES, new session) "¿Quién fue el máximo goleador del Mundial 2018?" | 18:41:21 → 18:42:20 | **3 Memory items** in Knowledge in context; answer `verified: true` (reused the approved SQL). |
| Q3 (expert) "How many matches did Croatia win in the 2018 World Cup?" + reviewer note on the `metric` block (penalty shoot-outs count as draws) | 18:42:20 → 18:45:22 | Cross-check `agree`; 4 Memory items recalled; the comment produced two Knowledge lessons ("Win is goals lead after regulation or extra time", "Do not use winner_team_id to count wins") and a `corr:` signal. Bank at **14 memories**. |
| Q4 (ES, new session) "¿Cuántos partidos ganó Croacia en el Mundial 2018?" | 18:45:22 → 18:46:53 | **5 Memory items**, including the reviewer correction. Answer: "Croacia ganó 1 partido … Cuartos: Russia 2–2 Croatia; 3–4 en penaltis — se cuenta como empate según la regla de no computar tandas como victorias." |
| Final bank | 18:46:53 | **18 memories**, documents `vq:…`, `corr:…:metric`, `knowledge:…` ×2. Observations already consolidating. |

Verdict: `recallAfterApproval: true · recallAfterCorrection: true · correctionMentionedInAnswer: true`.

Observations from the run:
- The 800 ms recall timeout fired once, on the pin-fingerprint recompute after the 👍 (not on a turn). The timeout was raised to 2.5 s afterwards (code, tests and specs), and `recall-only/` holds the re-run of Q2 and Q4 against the rebuilt server.
- `'own_goal'` was redacted to `'?'` because the literal was not in the question ("own goals"). The redaction now keeps snake_case codes (schema vocabulary) — see `redact.ts`.
- The stored LLM key only decrypted with `APP_SECRET=insecure-dev-secret`: it was encrypted before the `.app-secret` file existed (see retrospective 1.3.6).
- Both versions (A and B) learn the penalties lesson into Knowledge via `feedback-learner`; what B adds is the cross-session, paraphrase- and language-independent recall of approvals and corrections with provenance, and the Hindsight bank itself.
