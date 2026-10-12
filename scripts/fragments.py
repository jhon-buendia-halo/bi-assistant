#!/usr/bin/env python3
"""Changelog and retrospective fragments: validate them, and collect them on merge.

Each story adds changelog.d/<STORY>.md and retrospective.d/<STORY>.md instead of editing
changelog.md and retrospective.md, so branches built in parallel never conflict on them.
On every merge to main, version-on-merge.yml runs `collect`, which writes them into the two
files and deletes them. See *Logging convention* and *Retrospective convention* in CLAUDE.md.

    python3 scripts/fragments.py check                     # validate every fragment
    python3 scripts/fragments.py collect --version 0.30.0 [--date 2026-10-12] [--dry-run]

Standard library only. Run from anywhere in the repo.
"""
import argparse
import datetime
import glob
import os
import re
import subprocess
import sys

ROOT = subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip()
JIRA = "https://halo-powered.atlassian.net/browse/"
CHANGELOG_DIR, RETRO_DIR = "changelog.d", "retrospective.d"
TYPES = {"added": "Added", "changed": "Changed", "fixed": "Fixed", "removed": "Removed", "cut": "Cut"}
KEY = re.compile(r"^BA-\d+$")
NAME = re.compile(r"^(BA-\d+)(-[a-z0-9-]+)?\.md$")
ROADMAP_ID = re.compile(r"^\d+\.\d+\.\d+$")
RETRO_SECTIONS = ["### What went well", "### What went wrong", "### What to do differently"]


def fragment_paths(folder):
    return sorted(p for p in glob.glob(os.path.join(ROOT, folder, "*.md")) if os.path.basename(p) != "README.md")


def parse(path):
    """Front matter (`key: value` lines between --- fences, # comments allowed) and the body."""
    text = open(path, encoding="utf-8").read()
    m = re.match(r"---\n(.*?)\n---\n(.*)", text, flags=re.S)
    if not m:
        return None, text
    meta = {}
    for line in m.group(1).splitlines():
        line = re.sub(r"\s+#.*$", "", line).strip()
        if line:
            key, _, value = line.partition(":")
            meta[key.strip()] = value.strip()
    return meta, m.group(2).strip()


def links_in(body):
    return [t for t in re.findall(r"\]\(([^)\s]+)\)", re.sub(r"`[^`\n]*`", "", body))
            if not re.match(r"[a-z]+:", t) and not t.startswith("#")]


def validate(path, kind):
    """Problems with one fragment, as readable lines (empty when it is valid)."""
    rel = os.path.relpath(path, ROOT)
    name = NAME.match(os.path.basename(path))
    if not name:
        return [f"{rel}: name it <STORY>.md or <STORY>-<suffix>.md, e.g. BA-172.md"]
    meta, body = parse(path)
    if meta is None:
        return [f"{rel}: starts with a --- front matter block"]
    problems = []
    required = ["type", "story", "epic", "roadmap", "title", "evidence"] if kind == "changelog" else ["story", "roadmap", "title"]
    problems += [f"{rel}: missing `{k}:`" for k in required if not meta.get(k)]
    if meta.get("story") and meta["story"] != name.group(1):
        problems.append(f"{rel}: story {meta['story']} does not match the file name")
    for k in ("story", "epic"):
        if meta.get(k) and not KEY.match(meta[k]):
            problems.append(f"{rel}: {k} must be a BA key such as BA-172")
    if meta.get("roadmap") and not ROADMAP_ID.match(meta["roadmap"]):
        problems.append(f"{rel}: roadmap must be a feature ID such as 0.2.8")
    if kind == "changelog":
        if meta.get("type") and meta["type"] not in TYPES:
            problems.append(f"{rel}: type must be one of {', '.join(TYPES)}")
        ev = meta.get("evidence", "")
        if ev and not ev.startswith("none") and not os.path.exists(os.path.join(ROOT, ev)):
            problems.append(f"{rel}: evidence {ev} does not exist (or write `none: <why>`)")
    else:
        problems += [f"{rel}: missing `{s}`" for s in RETRO_SECTIONS if s not in body]
    if not body:
        problems.append(f"{rel}: the body is empty")
    problems += [f"{rel}: link {t} does not resolve from the repo root" for t in links_in(body)
                 if not os.path.exists(os.path.join(ROOT, t.split("#")[0]))]
    return problems


def check_all():
    return [p for f in fragment_paths(CHANGELOG_DIR) for p in validate(f, "changelog")] + \
           [p for f in fragment_paths(RETRO_DIR) for p in validate(f, "retrospective")]


def roadmap_key(meta):
    return tuple(int(n) for n in meta["roadmap"].split(".")), meta["story"]


def render_change(meta, body):
    refs = f"roadmap {meta['roadmap']}, [{meta['story']}]({JIRA}{meta['story']})"
    if meta["epic"] != meta["story"]:
        refs += f", epic [{meta['epic']}]({JIRA}{meta['epic']})"
    ev = meta["evidence"]
    evidence = f"Evidence: {ev[4:].lstrip(' :—-')}" if ev.startswith("none") else f"Evidence: [{ev}]({ev})."
    head = f"- **{meta['title']}** ({refs}):"
    if any(line.startswith("- ") for line in body.splitlines()):
        lines = [f"  {line}" if line else line for line in body.splitlines()]
        return "\n".join([head, *lines, f"  - {evidence}"])
    return f"{head} {' '.join(body.split())} {evidence}"


def insert_after(text, marker_line, block):
    """Insert block after the first line equal to marker_line (or before the first `## ` heading)."""
    lines = text.split("\n")
    if marker_line is not None and marker_line in lines:
        i = lines.index(marker_line) + 1
    else:
        i = next((n for n, line in enumerate(lines) if line.startswith("## ")), len(lines))
    while i < len(lines) and lines[i] == "":
        i += 1
    return "\n".join(lines[:i] + block.rstrip("\n").split("\n") + [""] + lines[i:])


def collect(version, date, dry_run):
    problems = check_all()
    if problems:
        sys.exit("Fragments are not valid:\n  " + "\n  ".join(problems))
    changes = [(*parse(p), p) for p in fragment_paths(CHANGELOG_DIR)]
    retros = [(*parse(p), p) for p in fragment_paths(RETRO_DIR)]
    if not changes and not retros:
        print("No fragments to collect.")
        return
    out = []
    if changes:
        section = [f"## {date} — v{version}", ""]
        for t, heading in TYPES.items():
            items = sorted((m for m in changes if m[0]["type"] == t), key=lambda m: roadmap_key(m[0]))
            if items:
                section += [f"### {heading}", *[render_change(m, b) for m, b, _ in items], ""]
        block = "\n".join(section)
        out.append(("changelog.md", None, block))
    if retros:
        entries = [f"## {date} — {m['roadmap']} {m['title']} ({m['story']})\n\n{b}\n"
                   for m, b, _ in sorted(retros, key=lambda r: roadmap_key(r[0]), reverse=True)]
        out.append(("retrospective.md", "---", "\n".join(entries)))
    for name, marker, block in out:
        path = os.path.join(ROOT, name)
        if dry_run:
            print(f"===== {name} =====\n{block}")
            continue
        text = open(path, encoding="utf-8").read()
        open(path, "w", encoding="utf-8").write(insert_after(text, marker, block))
    if not dry_run:
        for _, _, p in changes + retros:
            os.remove(p)
        print(f"Collected {len(changes)} changelog and {len(retros)} retrospective fragments into v{version}.")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("check", help="validate every fragment")
    c = sub.add_parser("collect", help="write fragments into changelog.md and retrospective.md, then delete them")
    c.add_argument("--version", required=True, help="the version being released, e.g. 0.30.0")
    c.add_argument("--date", default=datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d"))
    c.add_argument("--dry-run", action="store_true", help="print what would be written; change nothing")
    args = ap.parse_args()
    if args.cmd == "check":
        problems = check_all()
        print("\n".join(problems) if problems else "All fragments are valid.")
        sys.exit(1 if problems else 0)
    collect(args.version.lstrip("v"), args.date, args.dry_run)


if __name__ == "__main__":
    main()
