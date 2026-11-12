# M1-23 amendment — a faster, cheaper development workflow (stories 1.23.28–1.23.33, plus 1.23.26 moved up)

- **Decided by the user on 2026-11-11:** implement every suggestion of the speed-up review, on the epic branch `feat/M1-23-workflow-first` (not a separate process epic).
- **Why:** measured on this epic, the builder agent takes 5.5–29 min per story (≈20 min on average, 50–245 tool calls), while builds, unit tests and check-specs take seconds and Playwright 20 s–3.7 min. Opus builders used about 175–350k tokens per story (≈280k on average) and Sonnet builders about 110–130k. Tokens grow with context size × tool calls. The context is inflated by:
  - giant specs: 2 MB in total; `agents.md` 291 KB, `ui.md` 211 KB, `api.md` 193 KB, `roadmap.md` 277 KB, of which 88 % is finished history;
  - monoliths: `sessions.service.ts` 3,496 lines, `app.ts` 1,567 lines plus a large `app.html`;
  - every builder rediscovering the repo;
  - per-story fixed costs (specs, roadmap, mirrored Gherkin, evidence, demo, axe in two themes, full E2E runs) paid twice, by the builder and then by the lead.
- **Target:** an M story ≈ 6–8 min and ≈ 80–120k tokens; an epic of ~10 stories ≈ 1–1.5 h and ≈ 1 M tokens.
- **Deliberate deviation from the review: the giant specs are not split into many files.** Splitting would mean rewriting hundreds of cross-references (`agents.md 5.11`-style) across 2 MB of specs, costing more tokens than it saves for many epics and risking broken links. Instead, a generated **section index** (1.23.29) lets agents read only the line range they need. That gets most of the benefit at a fraction of the cost. The roadmap *is* archived (1.23.30), because that is cheap.

## 1.23.28 — Lean story lane, model and effort routing, decide-before-build (process docs only)

Changes to `CLAUDE.md`, `.claude/skills/workflow-start`, `workflow-implement`, `verify`, `workflow-gate`, `.claude/agents/builder.md` and `.claude/agents/reviewer.md`, and to `specs/system/delivery.md` sections 10, 12 and 13 where they state the same facts. Keep `CLAUDE.md` short: it holds the rules, and the skills hold the how.

- **Decide before you build.** Before an L epic, or an M feature whose end state is unclear, show a cheap prototype (an HTML mock or an ASCII/Markdown sketch, ≤ 10 min, no spec, no ADR), then **one batched confirmation per epic**: spec, ADR, open questions with recommendations, and branch, in a single message. Direction changes after the confirmation are re-planned once, not story by story.
- **Lean story lane** (replaces the per-story fast loop for agent-built stories):
  - **The builder** writes the code, its unit tests, **one** Playwright scenario for a UI story (the `@demo @story-<id>` one), and only the spec lines its change makes false. It runs only `npx jest --findRelatedTests <files>` / the touched frontend specs and **its own Playwright file**, never full suites. It does no axe scans, no screenshots in two themes, no evidence, no demo and no `qa.mjs`, unless the brief asks.
  - **The lead** merges a **wave** (the stories built in parallel) and runs one `qa.mjs --wave` (1.23.31) over it. It then hands the user the running app, with a demo only for the wave's user-visible milestone.
  - **Evidence and demos** are recorded per wave. The acceptance gate stays per epic (steps 6, 7, 9–11).
- **Gherkin once.** A flow's Gherkin lives in the Playwright test (`scenarioStep` lines). The capability spec keeps the Feature heading, its `E2E:` line and one line per scenario (`Scenario: <title>`), and no longer copies the steps. `check-specs.py` checks that every listed scenario title exists in the named E2E file (1.23.29 adds the check). Existing Features keep their steps until someone edits them.
- **Model and effort routing table** (in `CLAUDE.md` "Model usage"):

  | Work | Model | Effort |
  |---|---|---|
  | Plans, ADRs, design, critical/risky paths | Opus | high for plans, default for code |
  | UI on an existing pattern, tests, migrations of tests, deletions, docs | Sonnet | default/low |
  | Search, inventories, "where is X" | Haiku (`Explore`) | low |

  When two or more builders run in parallel, at most two use Opus.
- **Quiet output rule** for every agent: Playwright `--reporter=dot` (or `line`), Jest `--silent`, builds and test runs redirected to a log file, and only the summary or the failure block read back. Never `cat` a whole log.
- **Read rule:** never read a file over 500 lines whole. First `grep -n` or use the section index (`specs/INDEX.md`, 1.23.29), then read the range.
- **Session hygiene:** one lead session per epic wave; before a new session, write `.context/handoff.md` (template in `workflow-gate`).
- **Builder brief = story pack:** the lead runs `node scripts/story-pack.mjs <id>` (1.23.29) and passes its output path. The builder starts from it instead of exploring.
- `lessons.md`: replace the lines this supersedes. "Do not trust a subagent's report" stays, now satisfied by the wave gate.

Acceptance: `check-specs.py` green; the docs are consistent with each other. A reviewer agent (`reviewer`, Haiku or Sonnet) reads the diff of these files and finds no contradiction between `CLAUDE.md`, the skills, `builder.md` and `delivery.md`.

## 1.23.29 — `scripts/story-pack.mjs` and the spec section index

- `node scripts/spec-index.mjs` writes `specs/INDEX.md`: for every `specs/**/*.md` and `roadmap.md`, each heading (levels 2–4) and each rule id (`- R<n>.`) with its **line range**, as `path:start-end  heading`. It is regenerated by the script, never edited by hand.
  - `check-specs.py` fails when the index is stale: it regenerates the index in memory and compares.
  - It also adds the Gherkin-once check of 1.23.28: every `Scenario:` title listed under a Feature exists as a `test(` or `scenarioStep` title in its `E2E:` file.
- `node scripts/story-pack.mjs <roadmap-id> [--out <file>]` writes `.context/story-packs/<id>.md` (gitignored), the builder's single starting brief. It contains:
  1. the story's roadmap entry, verbatim;
  2. the plan/contract sections it cites, resolved through links and "plan section N" or "plan 1.24.x" references, verbatim, capped at about 400 lines;
  3. the spec sections the entry names (resolved through the index), each with its range;
  4. a file map: for each code path named in the entry or its plan section, the top-level symbols with line numbers (from `grep -n` of `export|class|function|@Component|selector`);
  5. the applicable `lessons.md` lines (by keyword: frontend, backend, e2e, specs, agents);
  6. the standard builder rules and the report block.
  - The pack is plain Markdown. Its size is printed, and the script warns above 60 KB.
- Delivery: `specs/system/delivery.md` §2 (npm script `story-pack`, `spec-index`) and §13.
- Acceptance: unit tests (node test runner or Jest in `scripts/`, whichever the repo uses for scripts; see `scripts/*.test.*`) for the index format, the staleness check, reference resolution and the size cap. `story-pack.mjs 1.23.16` produces a pack under 60 KB that holds plan 1.24.6 and the Data Readiness spec ranges. `check-specs.py` green.

## 1.23.30 — Archive finished milestones of the roadmap

- Move every milestone whose features are all `✅ Done` or `🚫 Cut` (and that is not the active epic) from `roadmap.md` to `roadmap-archive.md`, verbatim and in the same order. `roadmap.md` keeps the header, the release and milestone skeleton (one line per archived milestone: `### Milestone x.y — <title> (<epic id>) — archived, see roadmap-archive.md`), the open milestones, and the backlog.
- `check-specs.py`, `qa.mjs` (`storyTitle`, the roadmap readers at lines ~424/453) and `demo-page.mjs` read stories and epics from **both** files.
- Links into `roadmap.md#…` anchors elsewhere (grep) are pointed to the archive where needed.
- Acceptance: `roadmap.md` under ~40 KB; `check-specs.py` green; `qa.mjs <old id> --dry-run` and `demo-page.mjs <old id>` still find an archived story; nothing is lost (`git diff --stat` shows moved lines only).

## 1.23.31 — `qa.mjs --wave`: one verification for several stories

- `node scripts/qa.mjs --wave <id>,<id>,… --base <ref> [--no-demo] [--demo <id>]`. It runs once:
  - the build;
  - the related unit tests of the union of changed files since `--base`;
  - `check-specs`;
  - the union of the Playwright specs of the Features touched, with `--reporter=dot`;
  - optionally one demo, for `--demo <id>`.
- It writes `evidence/<id>/tests.md` for each story, every one pointing to the shared wave report `evidence/waves/<first-id>…<last-id>.md`.
- Also: every Playwright invocation in `qa.mjs` uses `--reporter=dot` plus the JSON/HTML reporters it already writes, and every child's output goes to the log file. The console prints one line per step.
- Delivery §13 updated.
- Acceptance: unit tests for argument parsing, spec union and evidence writing (`--dry-run` output); a real `--wave 1.23.29,1.23.30 --no-demo --dry-run` plan; check-specs green.

## 1.23.32 — Playwright in parallel

- Measure first: run the web suite with `--workers=3` on unchanged code and list the failures.
  - Each web test already starts its own CLI on a free port with its own temp data dir (delivery §13).
  - The shared state is the compose Postgres: specs create and drop databases on it.
- Make the specs that share state parallel-safe: unique database names per worker (`testInfo.workerIndex` or a random suffix), and no fixed ports.
- If a spec cannot be made safe cheaply, mark it `test.describe.configure({ mode: 'serial' })` or move it to a serial project.
- Set `workers` to 3 locally (env `E2E_WORKERS` overrides; CI 1). The QA lane lock stays, around the whole Playwright phase.
- Acceptance: the full web suite passes 3 times in a row with 3 workers (lessons: count flakes); its wall time is recorded before and after in `evidence/1.23.32/timings.md`; check-specs green.

## 1.23.26 (moved up) — Extract the turn engine from `sessions.service.ts`

Unchanged from the retire-chats plan's 1.25.5, except that it runs now, before the rest of Phase A. That way the remaining stories read a smaller file. **Scope for now:** extract the turn engine (`streamTurn`, `consume`, `agentInput`, `agentOptions`, `runTurnWorkflow` and their helpers) into `backend/src/modules/sessions/turn/` (or the folder the plan names) with no behaviour change. Moving evals and dev scripts to run hosts stays with the plan's 1.25.5 remainder and is re-entered as 1.23.26b.

Acceptance: `sessions.service.ts` shrinks by more than 1,500 lines; every backend unit suite and backend e2e passes unchanged; the request-recording Playwright specs pass unchanged; the agents' prompt and tool-list hashes are equal.

## 1.23.33 — Split `app.ts` / `app.html` by area

- Move each main area's state, handlers and template block out of the root component into an area container component under `frontend/src/app/features/<area>/` (or `core/shell/`): sessions/chat, workflows, agents, datasets, context, monitoring, settings. The root keeps the shell (rail, header, right panel host, routing between views).
- No visible change and no test-id change.
- Acceptance: `app.ts` under ~500 lines and `app.html` under ~400; the frontend unit suite passes (tests moved with their code); the web build stays within budget; the full web Playwright suite passes (with 1.23.32's workers).

## Waves

1. **Wave S1 (parallel):** 1.23.28 (docs, the lead), 1.23.29 + 1.23.31 (one Sonnet builder: both are scripts), 1.23.30 (Sonnet), 1.23.32 (Opus).
2. **Wave S2 (parallel):** 1.23.26 (Opus) and 1.23.33 (Sonnet). They touch backend and frontend respectively.
3. Then Phase A resumes (1.23.16, 1.23.17, 1.23.19, 1.23.21) on the lean lane.
