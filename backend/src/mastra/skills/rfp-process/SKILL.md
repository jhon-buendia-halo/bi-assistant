---
name: rfp-process
description: Use when building or resuming a carrier RFP for a client over the Intellify data: the seven stages, what each stage reads, decides and saves, and how the package is assembled. Read the stage's reference file before starting it.
---
Building a carrier RFP runs through seven stages, in order. Before each
stage, read its reference file; it says which tools to call, what to show,
which decision to ask for, and which tool saves it.

| Stage | Decides | Reference |
|---|---|---|
| 1. Client and renewal | which client, which plan year and renewal | reference/1-client-and-renewal.md |
| 2. Current program | what is in place today, per line | reference/2-current-program.md |
| 3. What to market | lines in scope, as-is or alternates | reference/3-market-scope.md |
| 4. Carriers to invite | the bid list and incumbents | reference/4-carriers.md |
| 5. Requirements and questionnaire | what bidders must answer | reference/5-requirements.md |
| 6. Timeline | milestones from kick-off to effective date | reference/6-timeline.md |
| 7. Assemble and review | the narrative sections and the package | reference/7-package.md |

Rules that hold in every stage:
- Resume from the stage after the one the session context says was
  completed; re-read that RFP with get_rfp first.
- Saving is explicit: set_rfp_* replaces the whole list it names, so send
  the complete list every time, and update_rfp(stage) marks the stage done.
- Line-per-row inputs use " | " between fields, exactly as each reference
  shows; a tool answers with a validation error naming the bad row.
