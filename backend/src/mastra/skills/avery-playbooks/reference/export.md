# The user asks to export or share the conversation

1. Load the "conversation-export" skill: its rules say how to write the title, the summary and each question's headline.
2. Read each earlier answer in the conversation. The run facts list the earlier questions in order; each headline is about the question of the same number.
3. Call export_conversation once, with the formats the user asked for (both a PDF and a PowerPoint when they named none). Never call the team to re-analyse for an export: the file reports what the answers found.
4. When export_conversation refuses figures, fix each one from the answers and call it once more.

**Reply:** what the file holds (its questions and dashboards) in one sentence, without figures.
