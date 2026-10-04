#!/usr/bin/env python3
"""Acceptance checks for roadmap 0.2.2 (BA-90): links, Gherkin preservation, coverage."""
import os, re, sys, glob, subprocess

ROOT = subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip()
os.chdir(ROOT)
fail = 0

def report(ok, msg):
    global fail
    print(("PASS " if ok else "FAIL ") + msg)
    if not ok:
        fail += 1

# 1. Every file listed in specs/README.md exists
readme = open("specs/README.md").read()
listed = re.findall(r"\]\(((?:capabilities|epics)/[^)]+)\)", readme)
expected = ["product/vision.md", "product/glossary.md", "product/non-functional.md",
            "system/architecture.md", "system/tech-stack.md", "system/data-model.md",
            "system/api.md", "system/agents.md", "system/ui.md", "system/delivery.md"] + listed
missing = [f for f in expected if not os.path.isfile(os.path.join("specs", f))]
report(not missing, f"specs/README.md lists {len(expected)} files; missing: {missing}")

# 2. Every relative markdown link resolves
files = ["CLAUDE.md", "roadmap.md"] + glob.glob("specs/**/*.md", recursive=True)
broken = []
for f in files:
    text = open(f).read()
    text = re.sub(r"```.*?```|~~~.*?~~~", "", text, flags=re.S)  # skip code blocks
    text = re.sub(r"`[^`\n]*`", "", text)  # skip inline code (examples)
    for target in re.findall(r"\]\(([^)\s]+)\)", text):
        if re.match(r"[a-z]+:", target) or target.startswith("#"):
            continue
        path = target.split("#")[0]
        if not os.path.exists(os.path.normpath(os.path.join(os.path.dirname(f), path))):
            broken.append(f"{f} -> {target}")
report(not broken, f"relative links in {len(files)} files resolve" + ("".join("\n     " + b for b in broken)))

# 3. Every Gherkin scenario from the old gherkin.md is in exactly one capability spec, unchanged
# gherkin.md as it was before the move: the last commit that touched it, or its parent if that commit deleted it
last = subprocess.check_output(["git", "rev-list", "-n", "1", "HEAD", "--", "gherkin.md"], text=True).strip()
try:
    orig = subprocess.check_output(["git", "show", f"{last}:gherkin.md"], text=True, stderr=subprocess.DEVNULL)
except subprocess.CalledProcessError:
    orig = subprocess.check_output(["git", "show", f"{last}^:gherkin.md"], text=True)
caps = {f: open(f).read() for f in glob.glob("specs/capabilities/*/spec.md")}
blocks = re.findall(r"```gherkin\n(.*?)```", orig, flags=re.S)
for block in blocks:
    feature = re.search(r"Feature: (.*)", block).group(1)
    homes = [f for f, t in caps.items() if block.strip() in t]
    report(len(homes) == 1, f"Feature '{feature}' moved verbatim into exactly one capability spec: {homes}")
report(not os.path.exists("gherkin.md"), "gherkin.md removed from the repo root")

# 4. Every backend HTTP route appears in system/api.md
api = open("specs/system/api.md").read() if os.path.exists("specs/system/api.md") else ""
routes = []
for f in glob.glob("backend/src/**/*.controller.ts", recursive=True):
    src = open(f).read()
    base = re.search(r"@Controller\(\s*'([^']*)'", src)
    base = base.group(1) if base else ""
    for method, sub in re.findall(r"@(Get|Post|Put|Patch|Delete)\(\s*(?:'([^']*)')?", src):
        path = "/" + "/".join(p for p in (base, sub) if p)
        routes.append((method.upper(), path))
def norm(p):
    return re.sub(r":\w+", ":x", p)
api_norm = norm(api)
absent = [f"{m} {p}" for m, p in routes if norm(p) not in api_norm]
report(not absent, f"{len(routes)} backend routes appear in system/api.md; absent: {absent}")

# 5. Every collection appears in system/data-model.md
dm = open("specs/system/data-model.md").read() if os.path.exists("specs/system/data-model.md") else ""
tables = re.findall(r"table: '(\w+)' \}", open("backend/src/infrastructure/database/database.module.ts").read())
absent = [t for t in tables if t not in dm]
report(not absent, f"{len(tables)} collections appear in system/data-model.md; absent: {absent}")

# 6. Every registered agent appears in system/agents.md
ag = open("specs/system/agents.md").read() if os.path.exists("specs/system/agents.md") else ""
reg = re.search(r"agents: \{(.*?)\}", open("backend/src/mastra/index.ts").read(), flags=re.S).group(1)
agents = re.findall(r"'?([\w-]+)'?:", reg)
absent = [a for a in agents if a not in ag]
report(not absent, f"{len(agents)} registered agents appear in system/agents.md; absent: {absent}")

# 7. Every capability spec has the required sections
need = ["## Concepts", "## Rules", "## Edge cases and errors", "## Contracts", "## UI", "## Flows", "## Acceptance"]
for f, t in sorted(caps.items()):
    gaps = [h for h in need if h not in t]
    report(not gaps, f"{f} has all capability sections; missing: {gaps}")

print(f"\n{'ALL CHECKS PASSED' if not fail else f'{fail} CHECK(S) FAILED'}")
sys.exit(1 if fail else 0)
