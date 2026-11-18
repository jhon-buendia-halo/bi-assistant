"""E-commerce report: Emily vs the workflow on the 100 Edge Cases questions.
Usage: python3 -I ba9-ecom-report.py <runs dir>   (prints Markdown + writes ecom-failures.json)"""
import collections
import json
import statistics
import sys
from pathlib import Path

runs = Path(sys.argv[1])


def load(names):
    out = {}
    for n in names:
        for r in json.loads((runs / f"{n}.json").read_text())["results"]:
            out[r["id"]] = r
    return out


emily = load(["ecom-emily"])
flow = load(["ecom-workflow-1", "ecom-workflow-2", "ecom-workflow-3"])
cost = {}
for name, files in (("Emily", ["ecom-emily"]), ("Workflow", ["ecom-workflow-1", "ecom-workflow-2", "ecom-workflow-3"])):
    cost[name] = sum(json.loads((runs / f"{f}.json").read_text()).get("costUsd") or 0 for f in files)


def atts(r):
    return r.get("attempts") or [r]


def summary(rows, name):
    ats = [a for r in rows.values() for a in atts(r)]
    secs = sorted(a.get("durationMs", 0) / 1000 for a in ats)
    by_split = collections.Counter((r.get("split"), r["passes"] == r["runs"]) for r in rows.values())
    return {
        "name": name,
        "questions": len(rows),
        "all3": sum(1 for r in rows.values() if r["passes"] == r["runs"]),
        "flaky": sum(1 for r in rows.values() if 0 < r["passes"] < r["runs"]),
        "none": sum(1 for r in rows.values() if r["passes"] == 0),
        "dev": f"{by_split[('dev', True)]}/{by_split[('dev', True)] + by_split[('dev', False)]}",
        "held": f"{by_split[('held-out', True)]}/{by_split[('held-out', True)] + by_split[('held-out', False)]}",
        "attempts": f"{sum(1 for a in ats if a.get('passed'))}/{len(ats)}",
        "errors": sum(1 for a in ats if a.get("status") == "error" or a.get("error")),
        "median_s": statistics.median(secs) if secs else 0,
        "cost": cost[name],
        "cost_q": cost[name] / len(rows) if rows else 0,
    }


print("| Target | 3 of 3 | flaky | 0 of 3 | dev | held-out | attempts | run errors | median s | total $ | $ per question |")
print("|---|---|---|---|---|---|---|---|---|---|---|")
for s in (summary(emily, "Emily"), summary(flow, "Workflow")):
    print(f"| {s['name']} | {s['all3']}/{s['questions']} | {s['flaky']} | {s['none']} | {s['dev']} | {s['held']} | {s['attempts']} | {s['errors']} | {s['median_s']:.1f} | ${s['cost']:.2f} | ${s['cost_q']:.4f} |")

print("\n| Category | Questions | Emily 3 of 3 | Workflow 3 of 3 |")
print("|---|---|---|---|")
cats = collections.OrderedDict()
for k, r in emily.items():
    cats.setdefault(r.get("category", "?"), []).append(k)
for c, ids in cats.items():
    e = sum(1 for k in ids if emily[k]["passes"] == emily[k]["runs"])
    w = sum(1 for k in ids if k in flow and flow[k]["passes"] == flow[k]["runs"])
    print(f"| {c} | {len(ids)} | {e} | {w} |")

# Failures grouped by the check that failed (over every failed attempt).
fail = {}
for name, rows in (("Emily", emily), ("Workflow", flow)):
    groups = collections.defaultdict(lambda: {"attempts": 0, "questions": set()})
    for k, r in rows.items():
        for a in atts(r):
            if a.get("passed"):
                continue
            failed = [c["id"] for c in a.get("checkResults", []) if c.get("status") == "failed"]
            if a.get("error") or a.get("status") == "error":
                failed = failed or ["run-error"]
            for c in failed or ["no-check-recorded"]:
                groups[c]["attempts"] += 1
                groups[c]["questions"].add(k)
    print(f"\n{name}: failed attempts by check")
    for c, g in sorted(groups.items(), key=lambda x: -x[1]["attempts"]):
        print(f"- {c}: {g['attempts']} attempts, {len(g['questions'])} questions: {', '.join(sorted(g['questions'])[:6])}{' …' if len(g['questions']) > 6 else ''}")
    fail[name] = {c: sorted(g["questions"]) for c, g in groups.items()}

print("\nQuestions failing on both (0 of 3 on each):")
both = [k for k in emily if emily[k]["passes"] == 0 and k in flow and flow[k]["passes"] == 0]
for k in both:
    print(f"- `{k}` ({emily[k].get('category')}): {emily[k]['question'][:110]}")
(runs / "ecom-failures.json").write_text(json.dumps({"groups": fail, "both_zero": both}, indent=1))
