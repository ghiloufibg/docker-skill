import re
import shutil
from pathlib import Path

from diff_tools import analyze_position
from memory_common import (
    Aliases,
    clean_comment,
    is_chatter,
    layer_of,
    memory_file_name,
    read_json,
    scrub,
    write_json,
    write_jsonl,
    write_text,
)

REVIEWED_EXTENSIONS = (".java",)
BOT_USERNAME_PATTERNS = (r"(^|[-_])bot($|[-_])", r"^project_\d+_bot", r"^ghost$")
MIN_COMMENT_CHARS = 15
MAX_REPLIES = 3
ID_HASH_CHARS = 4


def is_bot(user):
    if user.get("bot"):
        return True
    name = (user.get("username") or "").lower()
    return any(re.search(pattern, name) for pattern in BOT_USERNAME_PATTERNS)


def is_review_thread(discussion, mr_author_id):
    notes = discussion.get("notes") or []
    if not notes or notes[0].get("system"):
        return False
    author = notes[0].get("author") or {}
    return not is_bot(author) and author.get("id") != mr_author_id


def position_of(note):
    position = note.get("original_position") or note.get("position")
    if position and (position.get("new_path") or position.get("old_path")):
        return position
    return None


def _normalized(text):
    return re.sub(r"\W+", "", text.lower())


def _private_text(text, aliases):
    return scrub(aliases.apply(clean_comment(text)))


def _is_resolved(notes):
    resolvable = [note for note in notes if note.get("resolvable")]
    return bool(resolvable) and all(note.get("resolved") for note in resolvable)


def build_thread_records(slug, project_url, mr, discussions, versions, aliases):
    mr_author_id = (mr.get("author") or {}).get("id")
    merged = bool(mr.get("merged_at")) or mr.get("state") == "merged"
    day = (mr.get("merged_at") or mr.get("updated_at") or "")[:10]
    records = []
    seen = set()
    used_ids = set()
    for discussion in discussions:
        if not is_review_thread(discussion, mr_author_id):
            continue
        notes = discussion["notes"]
        first = notes[0]
        position = position_of(first)
        path = None
        if position:
            path = position.get("new_path") or position.get("old_path")
            if not path.endswith(REVIEWED_EXTENSIONS):
                continue
        comment = _private_text(first.get("body", ""), aliases)
        if is_chatter(comment, MIN_COMMENT_CHARS):
            continue
        duplicate_key = (path, _normalized(comment))
        if duplicate_key in seen:
            continue
        seen.add(duplicate_key)
        replies = [
            text for text in (
                _private_text(note.get("body", ""), aliases)
                for note in notes[1:] if not note.get("system")
            ) if text
        ][:MAX_REPLIES]
        thread_id = f"{slug}!{mr['iid']}#{discussion['id'][:ID_HASH_CHARS]}"
        length = ID_HASH_CHARS
        while thread_id in used_ids:
            length += 2
            thread_id = f"{slug}!{mr['iid']}#{discussion['id'][:length]}"
        used_ids.add(thread_id)
        record = {
            "id": thread_id,
            "project": slug,
            "project_url": project_url,
            "mr_iid": mr["iid"],
            "mr_url": mr.get("web_url", ""),
            "mr_title": scrub(mr.get("title", "")),
            "mr_state": "merged" if merged else "open_approved",
            "merged_at": day,
            "kind": "diff" if position else "general",
            "file_path": path,
            "layer": layer_of(path) if path else "other",
            "line_range": None,
            "code": "",
            "comment": comment,
            "replies": replies,
            "reviewer": aliases.get((first.get("author") or {}).get("username", "unknown")),
            "resolved": _is_resolved(notes),
            "addressed": False,
            "fix": None,
        }
        if position:
            found = analyze_position(position, versions)
            record["line_range"] = found["line_range"]
            record["code"] = scrub(found["code"])
            record["addressed"] = found["addressed"]
            record["fix"] = scrub(found["fix"]) if found["fix"] else None
        records.append(record)
    return records


def _load_project_threads(raw_dir, slug, project_url, aliases):
    index = read_json(raw_dir / slug / "index.json")
    if not index:
        return []
    records = []
    for iid in index["kept"]:
        mr_dir = raw_dir / slug / str(iid)
        mr = read_json(mr_dir / "mr.json")
        discussions = read_json(mr_dir / "discussions.json", [])
        versions = read_json(mr_dir / "versions.json", [])
        records += build_thread_records(slug, project_url, mr, discussions, versions, aliases)
    records.sort(key=lambda r: (r["merged_at"], r["mr_iid"]), reverse=True)
    return records


def write_output(output_dir, projects, max_mrs, run_date):
    output_dir = Path(output_dir)
    raw_dir = output_dir / "raw"
    for generated in ("projects", "by-path"):
        shutil.rmtree(output_dir / generated, ignore_errors=True)
    aliases = Aliases(raw_dir / "aliases.json")
    state = read_json(output_dir / "state.json", {})
    summaries = []
    for project in projects:
        records = _load_project_threads(raw_dir, project["slug"], project["url"], aliases)
        write_jsonl(output_dir / "projects" / project["slug"] / "threads.jsonl", records)
        by_path = {}
        for record in records:
            if record["kind"] == "diff":
                by_path.setdefault(record["file_path"], []).append(record)
        for path, threads in by_path.items():
            write_jsonl(output_dir / "by-path" / project["slug"] / memory_file_name(path), threads)
        if project["status"] == "ok":
            state[project["slug"]] = run_date
        summaries.append({
            "slug": project["slug"],
            "url": project["url"],
            "status": project["status"],
            "error": project.get("error"),
            "mrs_scanned": project.get("scanned", 0),
            "mrs_kept": len(project.get("kept", [])),
            "scan_limit_reached": project.get("capped", False),
            "approvals_available": project.get("approvals_available"),
            "threads": len(records),
            "diff_threads": sum(1 for r in records if r["kind"] == "diff"),
            "general_threads": sum(1 for r in records if r["kind"] == "general"),
            "addressed_threads": sum(1 for r in records if r["addressed"]),
        })
    aliases.save()
    write_json(output_dir / "state.json", state)
    write_json(output_dir / "manifest.json", {
        "run_date": run_date,
        "max_mrs_per_project": max_mrs,
        "projects": summaries,
    })
    write_text(output_dir / "README.md", _readme(summaries, run_date))
    return summaries


def _readme(summaries, run_date):
    rows = "\n".join(
        f"| {s['slug']} | {s['status']} | {s['mrs_kept']} | {s['threads']} | {s['addressed_threads']} |"
        for s in summaries
    )
    return f"""# Review memory

Generated by `scripts/review-memory/fetch_mrs.py` on {run_date}. This folder
holds team review data and is gitignored; never commit it.

| Project | Status | MRs kept | Threads | Addressed |
|---|---|---|---|---|
{rows}

- `manifest.json`: projects, counts and run date.
- `projects/<project>/threads.jsonl`: every kept review thread, one per line.
- `by-path/<project>/<file>.jsonl`: the same diff threads split by Java file.
- `by-check/` and `labels.jsonl`: written by `label.py ingest`.
- `rules/`: written by `distill.py`.
- `raw/`: cached GitLab responses and reviewer aliases; not read by forseti.
"""
