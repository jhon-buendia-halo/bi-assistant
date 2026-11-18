"""Apply the check fixes to ecommerce.json.
Usage: python3 -I apply-fixes.py <set file> <fix files...>
- replaces each case named in the fix files with its fixed version;
- makes every text check ignore letter case: `matches` gets flag i, an
  `includes` becomes a case-insensitive `matches` of the escaped text."""
import json
import re
import sys
from pathlib import Path

set_file = Path(sys.argv[1])
doc = json.loads(set_file.read_text())
fixes = {}
for f in sys.argv[2:]:
    p = Path(f)
    if p.exists():
        fixes.update(json.loads(p.read_text()))
replaced = 0
for i, case in enumerate(doc["cases"]):
    if case["id"] in fixes:
        doc["cases"][i] = fixes[case["id"]]
        replaced += 1
unknown = set(fixes) - {c["id"] for c in doc["cases"]}
if unknown:
    sys.exit(f"fixes for unknown ids: {sorted(unknown)}")

texty = 0
for case in doc["cases"]:
    checks = case.get("checks") or []
    out, has_matches = [], any(c["type"] == "matches" for c in checks)
    for c in checks:
        if c["type"] == "matches":
            flags = set(c["args"].get("flags", "")) | {"i"}
            c["args"]["flags"] = "".join(sorted(flags))
            texty += 1
        elif c["type"] == "includes" and not has_matches:
            c = {"type": "matches", "args": {"pattern": re.escape(c["args"]["text"]), "flags": "i"},
                 "criterion": c.get("criterion", "G1")}
            texty += 1
        out.append(c)
    case["checks"] = out
set_file.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n")
print(f"replaced {replaced} cases; {texty} text checks now ignore letter case")
