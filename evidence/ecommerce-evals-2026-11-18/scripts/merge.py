"""Merge the four parts into backend/src/mastra/evals/sets/ecommerce.json.
Usage: python3 -I merge.py <out-file> <part dirs...>"""
import json
import sys
from pathlib import Path

out = Path(sys.argv[1])
cases = []
for d in sys.argv[2:]:
    part = Path(d).name[-1].lower()  # partA -> a
    for c in json.loads((Path(d) / "cases.json").read_text()):
        if not c["id"].startswith("ec-"):
            c["id"] = f"ec-{part}-{c['id']}"
        cases.append(c)
import re


def fold_checks(case):
    """Each check type may appear once per case: fold repeated includes/matches
    into one `matches` whose lookaheads require every part; keep the first of
    any other repeated type."""
    checks = case.get("checks") or []
    texty = [c for c in checks if c["type"] in ("includes", "matches")]
    others, seen = [], set()
    for c in checks:
        if c["type"] in ("includes", "matches"):
            continue
        if c["type"] in seen:
            print(f"  {case['id']}: dropped repeated {c['type']}")
            continue
        seen.add(c["type"])
        others.append(c)
    if len(texty) > 1:
        parts, flags = [], set()
        for c in texty:
            if c["type"] == "includes":
                parts.append(re.escape(c["args"]["text"]))
            else:
                parts.append(c["args"]["pattern"])
                flags |= set(c["args"].get("flags", ""))
        pattern = "".join(f"(?=[\\s\\S]*?(?:{p}))" for p in parts)
        merged = {"type": "matches", "args": {"pattern": pattern}, "criterion": texty[0].get("criterion", "G1")}
        if flags:
            merged["args"]["flags"] = "".join(sorted(flags))
        print(f"  {case['id']}: folded {len(texty)} text checks into one matches")
        texty = [merged]
    case["checks"] = others + texty


for c in cases:
    fold_checks(c)
ids = [c["id"] for c in cases]
dups = {i for i in ids if ids.count(i) > 1}
if dups:
    sys.exit(f"duplicate ids: {sorted(dups)}")
doc = {
    "variants": [
        {
            "id": "ecommerce",
            "name": "E-commerce (Edge Cases)",
            "description": (
                "100 harder questions over the bundled Edge Cases sample, a synthetic e-commerce store "
                "(orders, order lines, payments, shipments, returns, reviews, customers, products in a "
                "3-level category tree, inventory snapshots, legacy orders) full of planted data problems: "
                "duplicate spellings, NULLs and blanks, odd column names, an empty gift-card table. "
                "Select its PostgreSQL datasource with the saved dataset 'Edge Cases'; Settings, Testing "
                "Data loads both."
            ),
            "fixtureId": "edge-cases",
            "dialect": "postgres",
            "caseIdPrefix": "",
        }
    ],
    "cases": cases,
}
out.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n")
print(f"{len(cases)} cases -> {out}")
