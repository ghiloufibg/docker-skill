#!/usr/bin/env python3
import argparse
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

from memory_common import (
    DEFAULT_MEMORY_DIR,
    INSTRUCTIONS_DIR,
    REFERENCES_DIR,
    SEVERITIES,
    estimate_tokens,
    load_threads,
    read_json,
    read_jsonl,
    thread_text_for_prompt,
    write_json,
    write_text,
)

MIN_MRS_PER_RULE = 3
MAX_RULES_PER_PROMPT = 15
EXAMPLES_PER_GROUP = 2
RECONCILE_REFERENCES = (
    "hexagonal-boundary-checklist.md",
    "naming-checklist.md",
    "java21-modern-idioms.md",
    "spring-boot3-practices.md",
    "test-quality-checklist.md",
    "no-comments-policy.md",
)
TEAM_RULES_FILE = "team-review-rules.md"
RECONCILE_BUCKETS = ("Confirmed", "New", "Conflict", "Unused")
_HEADING = re.compile(r"^## Check (T\?|T\d+) — (.+)$", re.M)
_FIELD = re.compile(
    r"^\*\*(Rule|Flag \((Critical|Important|Recommended)\)|Before / after|Finding template)\*\*:[ \t]*",
    re.M,
)
_REJECTED_KEY = re.compile(r"`([a-z0-9-]+\|[a-z0-9-]+\|[a-z]+)`")


def group_slug(key):
    return key.replace("|", "--")


def collect_groups(memory_dir):
    threads = {t["id"]: t for t in load_threads(memory_dir)}
    members = defaultdict(list)
    for label in read_jsonl(memory_dir / "labels.jsonl"):
        thread = threads.get(label["id"])
        if label["keep"] and thread:
            key = f"{label['forseti_check']}|{label['category']}|{thread['layer']}"
            members[key].append((label, thread))
    return members


def group_stats(items):
    severities = Counter(label["severity"] for label, _ in items)
    top = max(severities.values())
    severity = next(s for s in SEVERITIES if severities.get(s) == top)
    return {
        "threads": len(items),
        "mrs": len({(t["project"], t["mr_iid"]) for _, t in items}),
        "projects": len({t["project"] for _, t in items}),
        "reviewers": len({t["reviewer"] for _, t in items}),
        "addressed": sum(1 for _, t in items if t["addressed"]),
        "last_seen": max(t["merged_at"] for _, t in items),
        "severity": severity,
    }


def rejected_keys(memory_dir):
    path = memory_dir / "rules" / "rejected.md"
    return set(_REJECTED_KEY.findall(path.read_text(encoding="utf-8"))) if path.is_file() else set()


def pick_examples(items):
    ranked = sorted(items, key=lambda it: (not it[1]["addressed"], len(it[1]["code"]) + len(it[1]["comment"])))
    chosen = ranked[:1]
    other_project = next((it for it in ranked if it[1]["project"] != chosen[0][1]["project"]), None)
    for item in ([other_project] if other_project else []) + ranked[1:]:
        if len(chosen) == EXAMPLES_PER_GROUP:
            break
        if item not in chosen:
            chosen.append(item)
    return [thread for _, thread in chosen]


def prepare(memory_dir):
    rejected = rejected_keys(memory_dir)
    groups = []
    prompts_dir = memory_dir / "prompts"
    for stale in prompts_dir.glob("rules-*.md"):
        stale.unlink()
    instructions = (INSTRUCTIONS_DIR / "rules.md").read_text(encoding="utf-8").strip()
    total_tokens = 0
    written = 0
    for key, items in sorted(collect_groups(memory_dir).items()):
        stats = group_stats(items)
        eligible = stats["mrs"] >= MIN_MRS_PER_RULE and key not in rejected
        groups.append({"key": key, "slug": group_slug(key), "eligible": eligible,
                       "rejected": key in rejected, **stats})
        if not eligible:
            continue
        rules = Counter(label["rule"] for label, _ in items).most_common(MAX_RULES_PER_PROMPT)
        examples = pick_examples(items)
        check, category, layer = key.split("|")
        body = "\n\n".join([
            instructions,
            f"## Group\n\nChecklist: {check}\nCategory: {category}\nLayer: {layer}\n"
            f"Severity to use in the Flag line: {stats['severity'].title()}\n"
            f"Evidence: {stats['threads']} threads on {stats['mrs']} MRs in {stats['projects']} "
            f"projects, {stats['reviewers']} reviewers, {stats['addressed']} addressed.",
            "## One-line rules from reviewers\n\n" + "\n".join(f"- ({n}x) {rule}" for rule, n in rules),
            "## Example threads\n\n" + "\n\n".join(thread_text_for_prompt(t) for t in examples),
            f"## Output\n\nReturn one Check block only. Save it as "
            f"`{memory_dir / 'answers' / ('rules-' + group_slug(key) + '.md')}` if you can write files; "
            "otherwise print it.",
        ]) + "\n"
        write_text(prompts_dir / f"rules-{group_slug(key)}.md", body)
        total_tokens += estimate_tokens(body)
        written += 1
    write_json(memory_dir / "rules" / "groups.json", groups)
    rare = [g for g in groups if g["mrs"] < MIN_MRS_PER_RULE]
    print(f"{len(groups)} groups: {written} prompts written, {len(rare)} seen once or twice, "
          f"{sum(1 for g in groups if g['rejected'])} rejected.")
    print(f"Estimated input size: about {total_tokens} tokens in total.")
    print("Run each prompt in Copilot CLI, save each answer as answers/rules-<group>.md, "
          "then run: distill.py ingest")
    return 0


def parse_check(text, project_slugs):
    heading = _HEADING.search(text)
    if not heading:
        return None, "missing heading '## Check T? — <title>'"
    fields = {}
    matches = list(_FIELD.finditer(text))
    for i, match in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        fields[match.group(1) if not match.group(2) else "Flag"] = (
            match.group(2), text[match.end():end].strip())
    for required in ("Rule", "Flag", "Before / after", "Finding template"):
        if required not in fields:
            return None, f"missing field {required}"
    for general_field in ("Rule", "Flag", "Finding template"):
        body = fields[general_field][1].lower()
        leaked = next((s for s in project_slugs if len(s) >= 3 and s.lower() in body), None)
        if leaked:
            return None, f"{general_field} names the project {leaked!r}; rules must be general"
    return {"title": heading.group(2).strip(), "fields": fields}, None


def allocate_id(ids, key):
    if key not in ids:
        ids[key] = max(ids.values(), default=0) + 1
    return ids[key]


def render_check(rule_id, parsed, group, examples):
    stats = group
    flag_severity, flag_text = parsed["fields"]["Flag"]
    where = "plan-review" if all(t["kind"] == "general" for t in examples) else group["key"].split("|")[0]
    scope = f"in {stats['projects']} projects" if stats["projects"] > 1 else (
        "in 1 project (confirm this is a team standard, not one codebase's habit)")
    evidence = (
        f"{stats['threads']} threads on {stats['mrs']} MRs {scope}, {stats['reviewers']} reviewers, "
        f"{stats['addressed']} addressed. Last seen {stats['last_seen']}. Examples: "
        + ", ".join(f"`{t['id']}`" for t in examples)
        + f" (full threads in `memory/by-check/{where}.jsonl`)."
    )
    return "\n\n".join([
        f"## Check T{rule_id} — {parsed['title']}",
        f"**Rule**: {parsed['fields']['Rule'][1]}",
        f"**Flag ({flag_severity})**: {flag_text}",
        f"**Evidence**: {evidence}",
        f"**Before / after**: {parsed['fields']['Before / after'][1]}",
        f"**Finding template**: {parsed['fields']['Finding template'][1]}",
        f"Group: `{group['key']}`",
    ])


def ingest(memory_dir):
    groups = read_json(memory_dir / "rules" / "groups.json")
    if groups is None:
        print("distill: run 'distill.py prepare' first.", file=sys.stderr)
        return 2
    members = collect_groups(memory_dir)
    project_slugs = sorted({t["project"] for items in members.values() for _, t in items})
    ids_path = memory_dir / "rules" / "ids.json"
    ids = read_json(ids_path, {})
    rejected = rejected_keys(memory_dir)
    blocks, waiting, problems = [], [], []
    for group in groups:
        if not group["eligible"] or group["key"] in rejected:
            continue
        answer = memory_dir / "answers" / f"rules-{group['slug']}.md"
        if not answer.is_file():
            waiting.append(group["slug"])
            continue
        parsed, error = parse_check(answer.read_text(encoding="utf-8"), project_slugs)
        if error:
            problems.append(f"{answer.name}: {error}")
            continue
        examples = pick_examples(members[group["key"]])
        blocks.append((allocate_id(ids, group["key"]), render_check(ids[group["key"]], parsed, group, examples)))
    write_json(ids_path, ids)
    blocks.sort(key=lambda item: item[0])
    rare = [g for g in groups if g["mrs"] < MIN_MRS_PER_RULE and not g["rejected"]]
    candidates = ["# Candidate team rules\n", *(block for _, block in blocks)]
    candidates.append("## Seen once or twice (no rule)\n\n" + (
        "\n".join(f"- `{g['key']}`: {g['threads']} threads on {g['mrs']} MRs" for g in rare) or "None."))
    write_text(memory_dir / "rules" / "candidates.md", "\n\n".join(candidates) + "\n")
    print(f"{len(blocks)} candidate rules written to rules/candidates.md, "
          f"{len(waiting)} groups still waiting for an answer, {len(problems)} answers rejected.")
    for problem in problems:
        print(f"  {problem}")
    status = 1 if problems else 0
    if blocks:
        status = max(status, reconcile_step(memory_dir))
    return status


def reconcile_step(memory_dir):
    answer = memory_dir / "answers" / "reconcile.md"
    if answer.is_file():
        text = answer.read_text(encoding="utf-8")
        missing = [b for b in RECONCILE_BUCKETS if not re.search(rf"^## {b}\b", text, re.M)]
        if missing:
            print(f"  reconcile.md: missing sections {', '.join(missing)}")
            return 1
        write_text(memory_dir / "rules" / "reconcile.md", text.strip() + "\n")
        print("rules/reconcile.md written. Review it, then paste the accepted checks from "
              f"rules/candidates.md into references/{TEAM_RULES_FILE}.")
        return 0
    parts = [
        (INSTRUCTIONS_DIR / "reconcile.md").read_text(encoding="utf-8").strip(),
        "## Candidate rules\n\n" + (memory_dir / "rules" / "candidates.md").read_text(encoding="utf-8"),
        "## Current team rules\n\n" + (REFERENCES_DIR / TEAM_RULES_FILE).read_text(encoding="utf-8"),
    ]
    for name in RECONCILE_REFERENCES:
        parts.append(f"## forseti reference: {name}\n\n" + (REFERENCES_DIR / name).read_text(encoding="utf-8"))
    parts.append(f"## Output\n\nSave the answer as `{answer}` if you can write files; otherwise print it.")
    body = "\n\n".join(parts) + "\n"
    write_text(memory_dir / "prompts" / "reconcile.md", body)
    print(f"prompts/reconcile.md written (about {estimate_tokens(body)} tokens). Run it in Copilot CLI, "
          "save the answer as answers/reconcile.md, then run: distill.py ingest")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description="Prepare rule-writing prompts and ingest the answers.")
    parser.add_argument("command", choices=("prepare", "ingest"))
    parser.add_argument("--memory", default=str(DEFAULT_MEMORY_DIR), help="memory folder")
    args = parser.parse_args(argv)
    memory_dir = Path(args.memory)
    return prepare(memory_dir) if args.command == "prepare" else ingest(memory_dir)


if __name__ == "__main__":
    sys.exit(main())
