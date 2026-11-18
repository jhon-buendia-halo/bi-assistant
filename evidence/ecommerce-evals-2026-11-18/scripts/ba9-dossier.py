"""Write one compact dossier per failed e-commerce question, for triage.
Usage: python3 -I ba9-dossier.py <runs dir> <set file> <target label> <out file> <run names...>"""
import json
import sys
from pathlib import Path

runs, set_file, label, out = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3], Path(sys.argv[4])
cases = {c["id"]: c for c in json.loads(set_file.read_text())["cases"]}
results = {}
for n in sys.argv[5:]:
    for r in json.loads((runs / f"{n}.json").read_text())["results"]:
        results[r["id"]] = r

blocks = []
for k, r in results.items():
    if r["passes"] == r["runs"]:
        continue
    case = cases[k]
    att = next((a for a in r.get("attempts", [r]) if not a.get("passed")), r)
    sqls = []
    for t in att.get("toolCalls", []):
        if t.get("name") == "run_readonly_sql":
            i = t.get("input")
            if isinstance(i, str):
                try:
                    i = json.loads(i)
                except json.JSONDecodeError:
                    i = {"sql": i}  # stored input cut short: keep the raw text
            i = i or {}
            out_txt = t.get("output")
            out_txt = out_txt if isinstance(out_txt, str) else json.dumps(out_txt)
            sqls.append(f"SQL: {i.get('sql', '')[:700]}\nROWS: {out_txt[:600]}")
    failed = [f"{c['id']}: {c.get('description', '')[:160]} :: {json.dumps(c.get('details') or c.get('reason') or '')[:300]}"
              for c in att.get("checkResults", []) if c.get("status") == "failed"]
    blocks.append("\n".join([
        f"### {k}  [{label}]  category={case['category']} split={case['split']} passed {r['passes']}/{r['runs']}",
        f"QUESTION: {case['question']}",
        f"INTENT: {case.get('intent', '')}",
        f"EXPECTED SQL: {(case.get('expectedSql') or {}).get('postgres', '(none)')[:700]}",
        f"NOTES (verified result): {case.get('notes', '')[:700]}",
        f"FAILED CHECKS: " + (" | ".join(failed) if failed else (att.get('error') or 'none recorded')),
        f"ANSWER (first failed attempt): {att.get('answer', '')[:1200]}",
        *sqls[:3],
    ]))
out.write_text("\n\n".join(blocks) + "\n")
print(f"{len(blocks)} failed questions -> {out}")
