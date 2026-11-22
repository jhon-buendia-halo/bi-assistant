### Mastra workflow

A new Mastra workflow or a change to an existing one (`backend/src/mastra/workflows/`): its steps, its control flow (branch, loop, parallel, suspend and resume), or how agents and tools are composed into one. Each step below fills the workflow step named in brackets.

1. **[Understand]** Load the [`mastra-workflows`](../skills/mastra-workflows/SKILL.md) skill. Read the Mastra workflows documentation ([overview](https://mastra.ai/docs/workflows/overview) and the pages it links that apply) and confirm every API against the installed types (skill section 1).
2. **[Understand]** Check which existing agents, tools and workflows can be reused or serve as a reference (skill section 2).
3. **[Clarify]** Offer the user **three possible approaches** with their trade-offs and say which one you recommend and why. Build only after the user picks one (skill section 3).
4. **[Specs]** Update the lines the change makes false in the workflows spec and `agents.md` (skill section 4, *Specs, on the same branch*).
5. **[Implement]** Build with the skill's build rules (section 4) and the code rules in [`workflow-implement`](../skills/workflow-implement/SKILL.md). When the workflow's answer runs queries, it reaches the user through the query inspector layer: the **agent-change** playbook, step 3.
6. **[Checks]** The skill's checks (section 5) with [`verify`](../skills/verify/SKILL.md). When the change alters what an agent receives, run its evals per the **agent-change** playbook, steps 1 and 5.
7. **[Hand over]** Start an instance per the **local-instance** playbook so the user can run the workflow.

**Reply:** the approach the user picked, what changed in the workflow's steps and edges, how you verified it, and the instance URL.
