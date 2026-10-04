#!/usr/bin/env python3
"""Fail when specs/ drifts from the code. Runs in CI (.github/workflows/spec-checks.yml).

See *Spec convention* in CLAUDE.md. Standard library only; run from anywhere in the repo:
    python3 scripts/check-specs.py
"""
import glob
import os
import re
import subprocess
import sys

ROOT = subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip()
os.chdir(ROOT)
failures = 0


def check(ok, message, details=()):
    global failures
    print(("PASS " if ok else "FAIL ") + message)
    for d in details:
        print("     " + d)
    if not ok:
        failures += 1


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def strip_code(text):
    text = re.sub(r"```.*?```|~~~.*?~~~", "", text, flags=re.S)
    return re.sub(r"`[^`\n]*`", "", text)


readme = read("specs/README.md")
capabilities = {os.path.basename(os.path.dirname(f)): read(f) for f in glob.glob("specs/capabilities/*/spec.md")}
epics = {os.path.basename(os.path.dirname(f)): read(f) for f in glob.glob("specs/epics/*/spec.md")}

# 1. The layout in specs/README.md matches the files on disk.
system_files = ["product/vision.md", "product/glossary.md", "product/non-functional.md",
                "system/architecture.md", "system/tech-stack.md", "system/data-model.md",
                "system/api.md", "system/agents.md", "system/ui.md", "system/delivery.md"]
missing = [f for f in system_files if not os.path.isfile(os.path.join("specs", f))]
check(not missing, "every product and system spec exists", missing)
listed_caps = set(re.findall(r"\]\(capabilities/([\w-]+)/spec\.md\)", readme))
listed_epics = set(re.findall(r"\]\(epics/([\w-]+)/spec\.md\)", readme))
check(listed_caps == set(capabilities), "specs/README.md lists exactly the capability specs on disk",
      [f"unlisted: {sorted(set(capabilities) - listed_caps)}", f"listed but missing: {sorted(listed_caps - set(capabilities))}"]
      if listed_caps != set(capabilities) else [])
check(listed_epics == set(epics), "specs/README.md lists exactly the epic specs on disk",
      [f"unlisted: {sorted(set(epics) - listed_epics)}", f"listed but missing: {sorted(listed_epics - set(epics))}"]
      if listed_epics != set(epics) else [])

# 2. Every relative link resolves.
# changelog.md and retrospective.md are excluded: past entries are never rewritten, so their links may point at moved files.
files = ["CLAUDE.md", "README.md", "roadmap.md"] + glob.glob("specs/**/*.md", recursive=True)
broken = []
for f in files:
    for target in re.findall(r"\]\(([^)\s]+)\)", strip_code(read(f))):
        if re.match(r"[a-z]+:", target) or target.startswith("#"):
            continue
        if not os.path.exists(os.path.normpath(os.path.join(os.path.dirname(f), target.split("#")[0]))):
            broken.append(f"{f} -> {target}")
check(not broken, f"relative links in {len(files)} files resolve", broken)

# 3. Every capability spec has the required sections.
sections = ["## Concepts", "## Rules", "## Edge cases and errors", "## Contracts", "## UI", "## Flows", "## Acceptance"]
gaps = [f"{c}: {[s for s in sections if s not in t]}" for c, t in sorted(capabilities.items()) if any(s not in t for s in sections)]
check(not gaps, "every capability spec has the required sections", gaps)

# 4. Every Playwright spec mirrors a Gherkin Feature in exactly one capability spec, and every E2E reference exists.
#    The owning Feature carries a line that starts with "E2E: `<path>`"; inline mentions elsewhere are cross-references.
e2e_files = sorted(glob.glob("frontend/e2e/*.spec.ts"))
problems = []
for path in e2e_files:
    homes = [c for c, t in capabilities.items() if re.search(r"^E2E: `" + re.escape(path) + "`", t, flags=re.M)]
    if len(homes) != 1:
        problems.append(f"{path} is the E2E reference of {len(homes)} capability specs {homes} (expected 1)")
for c, t in capabilities.items():
    for ref in re.findall(r"E2E: `([^`]+)`", t):
        if not os.path.isfile(ref):
            problems.append(f"{c} references missing E2E file {ref}")
check(not problems, f"{len(e2e_files)} Playwright specs each mirror a Feature in exactly one capability spec", problems)

# 5. Every backend HTTP route appears in system/api.md, written as `METHOD /path`.
api = re.sub(r":\w+", ":x", read("specs/system/api.md"))
routes = []
for f in sorted(glob.glob("backend/src/**/*.controller.ts", recursive=True)):
    src = read(f)
    base = re.search(r"@Controller\(\s*'([^']*)'", src)
    base = base.group(1) if base else ""
    for method, sub in re.findall(r"@(Get|Post|Put|Patch|Delete)\(\s*(?:'([^']*)')?", src):
        routes.append((method.upper(), "/" + "/".join(p for p in (base, sub) if p)))
absent = [f"{m} {p}" for m, p in routes if "`" + m + " " + re.sub(r":\w+", ":x", p) + "`" not in api]
check(routes and not absent, f"{len(routes)} backend routes appear in specs/system/api.md", absent)

# 6. Every persisted collection appears in system/data-model.md.
data_model = read("specs/system/data-model.md")
tables = re.findall(r"table: '(\w+)' \}", read("backend/src/infrastructure/database/database.module.ts"))
absent = [t for t in tables if f"`{t}`" not in data_model]
check(tables and not absent, f"{len(tables)} collections appear in specs/system/data-model.md", absent)

# 7. Every registered agent appears in system/agents.md.
agents_md = read("specs/system/agents.md")
registry = re.search(r"agents: \{(.*?)\}", read("backend/src/mastra/index.ts"), flags=re.S)
agents = re.findall(r"'?([\w-]+)'?\s*:", registry.group(1)) if registry else []
absent = [a for a in agents if f"`{a}`" not in agents_md]
check(agents and not absent, f"{len(agents)} registered agents appear in specs/system/agents.md", absent)

# 8. Epic gate: every epic linked from a roadmap milestone has a spec with a status.
roadmap_epics = set(re.findall(r"^### Milestone [\d.]+ — .*?\[(BA-\d+)\]", read("roadmap.md"), flags=re.M))
missing = sorted(roadmap_epics - set(epics))
check(not missing, f"{len(roadmap_epics)} roadmap milestone epics have a spec in specs/epics/", missing)
no_status = sorted(e for e, t in epics.items() if not re.search(r"\*\*Status:\*\* (Draft|Confirmed)", t))
check(not no_status, "every epic spec has a Status of Draft or Confirmed", no_status)

print("\n" + ("ALL CHECKS PASSED" if not failures else f"{failures} CHECK(S) FAILED"))
sys.exit(1 if failures else 0)
