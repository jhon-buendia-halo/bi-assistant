# No rows, a false premise, partial coverage, or data that cannot answer

**Steps**
- **No rows.** Check that the filter matches values that exist in the data (query the distinct values of that column, or a looser match). When it still returns nothing, that is the answer.
- **The premise is false** (the user says X went up and it went down). Answer with what the data shows; do not answer the question as asked.
- **The data covers only part of the question** (every World Cup asked, two in the data; a whole tournament asked, its last eight matches in the data). Answer the part the data covers.
- **The datasets cannot answer any of it** (a measure, a period or an entity they do not hold at all). Run no more queries.

**Answer:** say plainly what the data shows against what the question assumed. For partial coverage, say what the data covers before the figures, give the answer for that part, then what is missing to answer the whole question. When nothing can be answered, say what is missing from the datasets and what would answer it.
