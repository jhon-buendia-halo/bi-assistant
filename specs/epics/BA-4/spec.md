# BA-4 — Knowledge Store

- **Jira:** [BA-4](https://halo-powered.atlassian.net/browse/BA-4) · **Roadmap:** Milestone 1.3 · **Status:** Draft — confirmation waived by the user on 2026-10-04 (one-time exception); work on its stories may start

## Goal
Curated knowledge the assistant treats as authoritative: business-glossary terms, standing instructions and default filters, scoped to a datasource or dataset. Analysts author and curate it, suggestions are mined from past sessions, and the relevant knowledge is injected into each turn, so terms like "revenue" always mean the same thing.

## Scope
- Research and ontology design: concepts, synonyms, mappings, relations; boundary with the Data Model DSL (structure vs meaning).
- Ontology model and knowledge graph, snippet migration, extended bootstrap agent (drafts arrive disabled).
- Ontology-grounded retrieval and SQL checking, replacing newest-first selection; retrieval logged per turn.
- Curation UI, conflict detection, feedback learning, per-answer provenance.

## Out of scope
- The structural model itself ([BA-2](../BA-2/spec.md)).
- Implementation in the research story (BA-78).

## Stories
| Story | Summary | Roadmap feature |
|---|---|---|
| [BA-123](https://halo-powered.atlassian.net/browse/BA-123) | Knowledge Store — Research | 1.3.5 |
| [BA-124](https://halo-powered.atlassian.net/browse/BA-124) | Knowledge Store — Execution plan | 1.3.6 |
| [BA-78](https://halo-powered.atlassian.net/browse/BA-78) | Research and ontology design (moved to BA-320 as 1.21.7–1.21.9 on 2026-11-09) | 1.3.1 |
| [BA-79](https://halo-powered.atlassian.net/browse/BA-79) | Ontology model, knowledge graph and bootstrap (moved to BA-320 as 1.21.7–1.21.9 on 2026-11-09) | 1.3.2 |
| [BA-80](https://halo-powered.atlassian.net/browse/BA-80) | Ontology-grounded retrieval and SQL generation, measured by evals | 1.3.3 |
| [BA-81](https://halo-powered.atlassian.net/browse/BA-81) | Curation UI, feedback learning and provenance | 1.3.4 |

**Moved on 2026-11-09:** at the user's request roadmap stories 1.3.1 and 1.3.2 (BA-78, BA-79) were built on BA-320 as 1.21.7–1.21.9, "Knowledge becomes each dataset's ontology" ([dataset-ontology](../../capabilities/dataset-ontology/spec.md), ADR-0036): the per-dataset ontology of concepts, relations, constraints and instructions, its tab in the dataset editor and its bootstrap. Stories 1.3.3 (ontology-grounded retrieval and SQL generation) and 1.3.4 (curation UI, feedback learning and provenance) remain on this epic and build on that ontology.

## Specs touched
- Capabilities: [dataset-ontology](../../capabilities/dataset-ontology/spec.md) (concept/relation model, retrieval, curation), [verified-queries](../../capabilities/verified-queries/spec.md) and [metrics](../../capabilities/metrics/spec.md) (linked to concepts), [sessions-chat](../../capabilities/sessions-chat/spec.md) (retrieval, provenance in the answer panel), [agents-evals](../../capabilities/agents-evals/spec.md) (knowledge on/off eval).
- System: [data-model](../../system/data-model.md) (the `ontology_items` collection and migration M15, built), [api](../../system/api.md) (ontology endpoints, built), [agents](../../system/agents.md) (`knowledge-bootstrap`, `sql-verifier`, `sql-fixer`), [ui](../../system/ui.md) (curation surface). Needs an ADR (BA-78).

## Acceptance
Per story, from Jira and the roadmap:
- Decision record merged and model agreed (BA-78).
- A dataset can be bootstrapped into a reviewed ontology; the graph returns a concept with its metric, mappings and example queries (BA-79).
- A golden-dataset eval with knowledge on vs off shows an accuracy gain with no category worse (BA-80).
- An analyst can fix a wrong answer by editing a concept and the next answer cites it (BA-81).

## Dependencies, risks and open questions
- **Research:** [docs/research/BA-4.md](../../../docs/research/BA-4.md) (BA-123) holds the findings, options and recommendation, and the decision record BA-78 asks for. The ADR itself is still to be written (BA-124).
- **Built since:** the flat knowledge snippets became each dataset's ontology (concepts with column mappings, relations, constraints, instructions; shared items; bootstrap from schema, samples, references and metrics) under BA-320 (1.21.7–1.21.9), so BA-78 and BA-79 are delivered there. Open for BA-80 and BA-81: retrieval by question relevance, SQL checks against the ontology, feedback learning and provenance.
- BA-80 depends on the ontology built in BA-320 (1.21.7) and the golden dataset ([BA-9](../BA-9/spec.md)); BA-81's provenance display ties into [BA-12](../BA-12/spec.md).
- Depends on the DSL's logical references ([BA-2](../BA-2/spec.md)), which are not on `main` yet.
- Assignee in Jira: Sergio Berrospi (epic); stories unassigned.
