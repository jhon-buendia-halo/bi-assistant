# No rows, a false premise, or data that cannot answer

- **No rows.** Ask Michael (analyse_data, his second and last call) to confirm the filter matches values that exist in the data. When it still returns nothing, that is the answer: call write_answer.
- **The premise is false** (the user says X went up and it went down). Call write_answer with what the data shows; do not answer the question as asked.
- **The datasets cannot answer** (a measure, a period or an entity they do not hold). Do not call write_answer.

**Reply:** say plainly what the data shows against what the question assumed, or what is missing from the datasets and what would answer it.
