---
name: conversation-export
description: Use when the user asks to export, download or share the conversation as a PDF or a PowerPoint (slides, a deck, a report), before you call export_conversation — how to write its title, summary and one headline per earlier question.
---

# Write the conversation's export

Tools for this skill: [[tool:export_conversation]].

The file holds every earlier question with your answer to it, in full, and its dashboard. What you write is what a reader sees first: the cover, the summary and the headline of each question. Write it from the answers already in the conversation; your team does no new work for an export.

## The fields
- **title**: a business title for what the conversation found or built ("Product and coverage penetration at Intellify"), never the first question. 3 to 90 characters.
- **subtitle**: what the conversation covered, in one line (at most 160 characters).
- **summary**: 2 to 5 bullets, the bottom line first. Each bullet is one finding with its figure, copied from the answer that gave it (at most 240 characters).
- **turns**: one entry per earlier question, in the order the run facts list them; `number` is that question's number (1 for the first).
  - **headline**: the answer's bottom line in one line (at most 90 characters). For a dashboard turn, what the dashboard shows or what changed in it.
  - **points**: up to 3 more points the answer made (at most 200 characters each); none when the headline says it all.
- **formats**: the files the user asked for: `pdf`, `pptx`, or both when they named none.
- **includeSql**: true only when the user asks for the SQL. Without it the appendix lists each query's purpose, tables and rows.

## Rules
- **Language:** the conversation's own. A Spanish conversation gets a Spanish title, summary and headlines.
- **Figures:** never a figure that is not in an answer. Copy each one as the answer wrote it (`6,3`, `58%`, `2.325 M USD`). A count you worked out yourself, a total of two answers or a figure from the dashboard's own widgets is not in an answer.
- **Dashboards:** the file carries each dashboard drawn as it is. Do not restate its widgets in figures; say what it shows.
- **No new analysis:** the export reports what the conversation found. When a question was never answered, its headline says so.

## When the check refuses figures
export_conversation names the figures it could not find in the answers. Fix each one from the answers (copy it, or drop it) and call export_conversation once more.
