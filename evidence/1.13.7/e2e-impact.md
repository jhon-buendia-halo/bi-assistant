# 1.13.7 — E2E impact analysis (step 6)

Touched: `mastra/app-skills.ts` (every agent's skills), `context-blocks.ts` (curated-knowledge), `deep-analysis.phases.ts`, `visualization.service.ts` (`reference/` paths), the `assistant` agent.

| Feature (spec) | Scenario | Decision |
|---|---|---|
| Skills the assistant is given (`assistant-skills.spec.ts`) | The assistant is offered only its own skills | Re-run as-is |
| | A turn without curated knowledge carries no knowledge rules | Re-run as-is |
| | A turn with curated knowledge carries the rules right after the block | Re-run as-is |
| | A user-level skill is offered to the assistant on demand | **Add** |
| | A user-level override of the curated-knowledge skill reaches the turn | **Add** |
| Skills the designer is given (`designer-skills.spec.ts`) | both scenarios | Re-run as-is (comments renamed to `reference/`) |
| Deep analysis, chat and visuals, knowledge | all | Re-run as-is (full suite) |

Red run before the change: both added scenarios failed for the right reason (no catalog; the built-in rules sent instead of the override). The three existing ones passed.
