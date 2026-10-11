#!/usr/bin/env python3
import argparse
import json
import os
import shutil
import sys
from pathlib import Path

from memory_common import (
    CATEGORIES,
    CHECKS,
    DEFAULT_MEMORY_DIR,
    INSTRUCTIONS_DIR,
    SEVERITIES,
    append_jsonl,
    estimate_tokens,
    load_threads,
    read_jsonl,
    thread_text_for_prompt,
    write_jsonl,
    write_text,
)

DEFAULT_BATCH_SIZE = 30
MIN_BATCH_SIZE = 20
MAX_BATCH_SIZE = 50
MAX_RULE_WORDS = 15
MAX_EXAMPLES_PER_CHECK = 20
PLAN_REVIEW_FILE = "plan-review"


def pending_threads(memory_dir):
    labeled = {label["id"] for label in read_jsonl(memory_dir / "labels.jsonl")}
    pending = [t for t in load_threads(memory_dir) if t["id"] not in labeled]
    pending.sort(key=lambda t: t["merged_at"], reverse=True)
    pending.sort(key=lambda t: not t["addressed"])
    return pending


def prepare(memory_dir, batch_size, max_threads):
    pending = pending_threads(memory_dir)
    if max_threads:
        pending = pending[:max_threads]
    prompts_dir = memory_dir / "prompts"
    for stale in prompts_dir.glob("label-*.md"):
        stale.unlink()
    if not pending:
        print("Nothing to label: every thread already has a label.")
        return 0
    instructions = (INSTRUCTIONS_DIR / "label.md").read_text(encoding="utf-8")
    total_tokens = 0
    batches = [pending[i:i + batch_size] for i in range(0, len(pending), batch_size)]
    for number, batch in enumerate(batches, 1):
        name = f"label-{number:03d}"
        body = "\n\n".join([
            instructions.strip(),
            f"## Threads ({len(batch)})",
            "\n\n".join(thread_text_for_prompt(t) for t in batch),
            f"## Output\n\nReturn exactly {len(batch)} JSON lines, one per thread above, "
            f"and nothing else. Save them as `{memory_dir / 'answers' / (name + '.jsonl')}` "
            "if you can write files; otherwise print them.",
        ]) + "\n"
        write_text(prompts_dir / f"{name}.md", body)
        total_tokens += estimate_tokens(body)
    print(f"{len(pending)} threads in {len(batches)} prompt files in {prompts_dir}")
    print(f"Estimated input size: about {total_tokens} tokens in total.")
    print("Run each prompt in Copilot CLI, save each answer as answers/label-NNN.jsonl, "
          "then run: label.py ingest")
    return 0


def validate_label(text, known_ids, done_ids):
    try:
        label = json.loads(text)
    except ValueError:
        return None, "not valid JSON"
    if not isinstance(label, dict):
        return None, "not a JSON object"
    thread_id = label.get("id")
    if thread_id not in known_ids:
        return None, f"unknown thread id {thread_id!r}"
    if thread_id in done_ids:
        return None, f"{thread_id} is already labeled"
    keep = label.get("keep")
    if not isinstance(keep, bool):
        return None, f"{thread_id}: keep must be true or false"
    if not keep:
        return {"id": thread_id, "keep": False}, None
    severity = str(label.get("severity", "")).upper()
    rule = label.get("rule")
    if label.get("category") not in CATEGORIES:
        return None, f"{thread_id}: unknown category {label.get('category')!r}"
    if label.get("forseti_check") not in CHECKS:
        return None, f"{thread_id}: unknown forseti_check {label.get('forseti_check')!r}"
    if severity not in SEVERITIES:
        return None, f"{thread_id}: unknown severity {label.get('severity')!r}"
    if not isinstance(rule, str) or not rule.strip():
        return None, f"{thread_id}: rule is empty"
    if len(rule.split()) > MAX_RULE_WORDS:
        return None, f"{thread_id}: rule is longer than {MAX_RULE_WORDS} words"
    return {
        "id": thread_id, "keep": True, "category": label["category"],
        "forseti_check": label["forseti_check"], "severity": severity, "rule": rule.strip(),
    }, None


def ingest(memory_dir):
    threads = {t["id"]: t for t in load_threads(memory_dir)}
    labels_path = memory_dir / "labels.jsonl"
    done = {label["id"] for label in read_jsonl(labels_path)}
    answers_dir = memory_dir / "answers"
    accepted_total = 0
    problems = []
    for answer in sorted(answers_dir.glob("label-*.jsonl")):
        accepted = []
        for number, line in enumerate(answer.read_text(encoding="utf-8").splitlines(), 1):
            text = line.strip()
            if not text or text.startswith("```"):
                continue
            label, error = validate_label(text, threads, done)
            if error:
                problems.append(f"{answer.name}:{number}: {error}")
                continue
            accepted.append(label)
            done.add(label["id"])
        append_jsonl(labels_path, accepted)
        accepted_total += len(accepted)
        ingested_dir = answers_dir / "ingested"
        ingested_dir.mkdir(exist_ok=True)
        os.replace(answer, ingested_dir / answer.name)
    rebuild_by_check(memory_dir, threads)
    remaining = len(threads) - len(done & set(threads))
    print(f"{accepted_total} labels accepted, {len(problems)} lines rejected, {remaining} threads still unlabeled.")
    for problem in problems:
        print(f"  {problem}")
    if remaining:
        print("Run label.py prepare again to get prompts for the unlabeled threads.")
    return 1 if problems else 0


def rebuild_by_check(memory_dir, threads):
    by_check_dir = memory_dir / "by-check"
    shutil.rmtree(by_check_dir, ignore_errors=True)
    grouped = {}
    for label in read_jsonl(memory_dir / "labels.jsonl"):
        thread = threads.get(label["id"])
        if not label["keep"] or not thread:
            continue
        entry = {**thread, **{k: label[k] for k in ("category", "forseti_check", "severity", "rule")}}
        name = PLAN_REVIEW_FILE if thread["kind"] == "general" else label["forseti_check"]
        grouped.setdefault(name, []).append(entry)
    for name, entries in grouped.items():
        entries.sort(key=lambda e: (not e["addressed"], len(e["code"]) + len(e["comment"]), e["id"]))
        write_jsonl(by_check_dir / f"{name}.jsonl", entries[:MAX_EXAMPLES_PER_CHECK])


def main(argv=None):
    parser = argparse.ArgumentParser(description="Prepare labeling prompts and ingest the answers.")
    parser.add_argument("command", choices=("prepare", "ingest"))
    parser.add_argument("--memory", default=str(DEFAULT_MEMORY_DIR), help="memory folder")
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE,
                        help=f"threads per prompt ({MIN_BATCH_SIZE}-{MAX_BATCH_SIZE})")
    parser.add_argument("--max-threads", type=int, help="cap on threads in this run (pilot: 100)")
    args = parser.parse_args(argv)
    if not MIN_BATCH_SIZE <= args.batch_size <= MAX_BATCH_SIZE:
        print(f"label: --batch-size must be {MIN_BATCH_SIZE}-{MAX_BATCH_SIZE}", file=sys.stderr)
        return 2
    memory_dir = Path(args.memory)
    if args.command == "prepare":
        return prepare(memory_dir, args.batch_size, args.max_threads)
    return ingest(memory_dir)


if __name__ == "__main__":
    sys.exit(main())
