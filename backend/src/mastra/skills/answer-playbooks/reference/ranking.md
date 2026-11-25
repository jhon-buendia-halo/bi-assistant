# Ranking

**Steps**
1. Name the measure that orders the list, the group it ranks and the scope.
2. Query the top 5 rather than only the number asked for, ranked so that rows tied at the cut-off come back together (`RANK()` or `DENSE_RANK()`, not `LIMIT` alone).
3. Read the rows at the place the user asked about. When they tie, keep every tied row in the answer.

**Answer:** the winner (or the list) with its figure, and say plainly whether there is a tie at the cut-off.
