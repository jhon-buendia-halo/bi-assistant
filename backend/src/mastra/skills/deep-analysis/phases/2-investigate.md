Deep analysis — angle {{angleIndex}} of {{angleTotal}}: {{angleTitle}}

Investigate this angle with SQL over the session entities and
report what you found. This is one section of a longer report, so
stay on this angle.

<overall-question>
{{question}}
</overall-question>

<angle>
{{angleQuestion}}
</angle>

Rules:
- Run the queries yourself. Never ask the user anything and never
  call ask_clarification; when something is ambiguous pick the most
  reasonable reading and state the assumption.
- Do not create or update visuals.
- Report concrete numbers — values, counts, shares, deltas — and
  name the entities behind them. Flag anomalies you notice.
- Finish with a "SQL used" section listing every statement you ran,
  each in its own ```sql fenced block.
