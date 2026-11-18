"""BA-9 head-to-head (2026-11-18): Emily (assistant) vs the whole Answer a
Business Question workflow on the same 25 questions, from the saved run files.

Emily:    s1-branch-world-cup (held-out only) + s3-branch-ia-on-assistant
Workflow: s3-branch-wc-heldout-on-workflow    + s2-branch-insights-analyst
Same judge setting on both sides of each group (World Cup off, insights-analyst on).

Usage: python3 -I ba9-h2h.py <runs dir>  (prints Markdown)
"""
import json
import statistics
import sys
from pathlib import Path

runs = Path(sys.argv[1])


def results(name, split=None):
    data = json.loads((runs / f"{name}.json").read_text())
    rows = data["results"]
    if split:
        rows = [r for r in rows if r.get("split") == split]
    return {r["id"]: r for r in rows}


def attempts(r):
    return r.get("attempts") or [r]


GROUPS = [
    ("World Cup held-out (15)",
     results("s1-branch-world-cup", "held-out"),
     results("s3-branch-wc-heldout-on-workflow", "held-out")),
    ("insights-analyst (10)",
     results("s3-branch-ia-on-assistant"),
     results("s2-branch-insights-analyst")),
]


def side(rows):
    ats = [a for r in rows.values() for a in attempts(r)]
    secs = [a.get("durationMs", 0) / 1000 for a in ats]
    cost = [a.get("costUsd") or 0 for a in ats]
    return {
        "questions": len(rows),
        "all3": sum(1 for r in rows.values() if all(a.get("passed") for a in attempts(r))),
        "attempts": len(ats),
        "passed": sum(1 for a in ats if a.get("passed")),
        "errors": sum(1 for a in ats if a.get("status") == "error"),
        "median_s": statistics.median(secs) if secs else 0,
        "mean_s": statistics.mean(secs) if secs else 0,
        "cost_q": sum(cost) / len(ats) if ats else 0,
    }


def fmt(s):
    rate = 100 * s["passed"] / s["attempts"] if s["attempts"] else 0
    return (f"{s['all3']}/{s['questions']} | {s['passed']}/{s['attempts']} ({rate:.0f}%) | "
            f"{s['median_s']:.1f} | {s['mean_s']:.1f} | ${s['cost_q']:.4f} | {s['errors']}")


print("| Questions | Target | 3 of 3 | Attempts passed | Median s | Mean s | $ per attempt | Run errors |")
print("|---|---|---|---|---|---|---|---|")
total_e, total_w = {}, {}
for title, emily, flow in GROUPS:
    common = sorted(set(emily) & set(flow))
    e = {k: emily[k] for k in common}
    w = {k: flow[k] for k in common}
    print(f"| {title} | Emily | {fmt(side(e))} |")
    print(f"| {title} | Workflow | {fmt(side(w))} |")
    total_e.update(e)
    total_w.update(w)
print(f"| **All 25** | Emily | {fmt(side(total_e))} |")
print(f"| **All 25** | Workflow | {fmt(side(total_w))} |")

print("\nQuestions where the two differ (attempts passed of 3):\n")
for title, emily, flow in GROUPS:
    for k in sorted(set(emily) & set(flow)):
        pe = sum(1 for a in attempts(emily[k]) if a.get("passed"))
        pw = sum(1 for a in attempts(flow[k]) if a.get("passed"))
        if pe != pw:
            print(f"- `{k}`: Emily {pe}/3, workflow {pw}/3")
