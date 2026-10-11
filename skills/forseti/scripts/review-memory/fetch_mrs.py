#!/usr/bin/env python3
import argparse
import concurrent.futures
import heapq
import re
import shutil
import sys
import threading
import urllib.parse
from datetime import date
from pathlib import Path

from build_output import REVIEWED_EXTENSIONS, is_review_thread, write_output
from gitlab_client import GitlabClient, GitlabError, HostLimiter
from memory_common import DEFAULT_MEMORY_DIR, load_env, read_json, write_json

PROJECT_URLS = [
    "https://gitlab.example.com/team-a/order-service",
    "https://gitlab.example.com/team-a/payment-service",
    "https://gitlab.example.com/team-b/catalog-service",
]
MAX_MRS_PER_PROJECT = 200
OUTPUT_DIR = str(DEFAULT_MEMORY_DIR)

SCAN_FACTOR = 10
PLACEHOLDER_HOST = "gitlab.example.com"
PROGRESS_EVERY = 25

_print_lock = threading.Lock()


class ConfigError(Exception):
    pass


def log(message):
    with _print_lock:
        print(message, flush=True)


def parse_project_url(url):
    parts = urllib.parse.urlsplit(url.strip())
    if parts.scheme not in ("http", "https") or not parts.netloc:
        raise ConfigError(f"not a project URL: {url}")
    path = parts.path.split("/-/")[0].strip("/")
    if path.endswith(".git"):
        path = path[:-4]
    if "/" not in path:
        raise ConfigError(f"no group/project path in: {url}")
    return {
        "url": f"{parts.scheme}://{parts.netloc}/{path}",
        "host": parts.netloc,
        "api_base": f"{parts.scheme}://{parts.netloc}/api/v4",
        "path": path,
        "project_id": urllib.parse.quote(path, safe=""),
    }


def assign_slugs(specs):
    names = [spec["path"].rsplit("/", 1)[-1] for spec in specs]
    for spec, name in zip(specs, names):
        spec["slug"] = name if names.count(name) == 1 else spec["path"].replace("/", "__")
    return specs


def token_for(host, env):
    specific = "GITLAB_API_TOKEN_" + re.sub(r"\W", "_", host).upper()
    if env.get(specific):
        return env[specific]
    base_url = env.get("GITLAB_BASE_URL")
    if base_url and urllib.parse.urlsplit(base_url).netloc == host and env.get("GITLAB_API_TOKEN"):
        return env["GITLAB_API_TOKEN"]
    raise ConfigError(
        f"no token for host {host}: set GITLAB_BASE_URL and GITLAB_API_TOKEN for it, "
        f"or {specific}, in ~/.copilot/tools/.env"
    )


def read_cached(path, loader):
    cached = read_json(path)
    if cached is not None:
        return cached
    data = loader()
    write_json(path, data)
    return data


def prepare_mr_dir(mr_dir, mr):
    stored = read_json(mr_dir / "mr.json")
    if stored and stored.get("updated_at") != mr.get("updated_at"):
        shutil.rmtree(mr_dir)
    meta = {k: mr.get(k) for k in ("iid", "title", "state", "web_url", "author", "merged_at", "updated_at")}
    write_json(mr_dir / "mr.json", meta)


def trimmed_version(detail):
    return {
        "head_commit_sha": detail.get("head_commit_sha"),
        "created_at": detail.get("created_at"),
        "diffs": [
            {"old_path": d.get("old_path"), "new_path": d.get("new_path"), "diff": d.get("diff", "")}
            for d in detail.get("diffs", [])
            if (d.get("new_path") or d.get("old_path") or "").endswith(REVIEWED_EXTENSIONS)
        ],
    }


def fetch_versions(client, mr_path):
    listed, _ = client.get(f"{mr_path}/versions")
    listed.sort(key=lambda v: (v.get("created_at", ""), v.get("id", 0)))
    return [trimmed_version(client.get(f"{mr_path}/versions/{v['id']}")[0]) for v in listed]


def merged_stream(client, project_id):
    def stream(state):
        return client.get_all(
            f"/projects/{project_id}/merge_requests",
            {"state": state, "order_by": "updated_at", "sort": "desc"},
        )
    return heapq.merge(stream("merged"), stream("opened"),
                       key=lambda mr: mr.get("updated_at", ""), reverse=True)


def fetch_project(spec, client, raw_dir, max_mrs, since):
    slug = spec["slug"]
    project_id = spec["project_id"]
    result = {"slug": slug, "url": spec["url"], "status": "ok", "scanned": 0,
              "kept": [], "capped": False, "approvals_available": None}
    scan_limit = SCAN_FACTOR * max_mrs
    try:
        for mr in merged_stream(client, project_id):
            if since and mr.get("updated_at", "")[:10] < since:
                break
            if result["scanned"] >= scan_limit:
                result["capped"] = True
                break
            result["scanned"] += 1
            if result["scanned"] % PROGRESS_EVERY == 0:
                log(f"[{slug}] {len(result['kept'])}/{max_mrs} MRs kept, {result['scanned']} scanned")
            if process_mr(client, project_id, mr, raw_dir / slug / str(mr["iid"]), result):
                result["kept"].append(mr["iid"])
                if len(result["kept"]) >= max_mrs:
                    break
        write_json(raw_dir / slug / "index.json", {
            "kept": result["kept"], "scanned": result["scanned"], "capped": result["capped"],
        })
    except (GitlabError, OSError) as error:
        result["status"] = "failed"
        result["error"] = str(error)
    log(f"[{slug}] {len(result['kept'])}/{max_mrs} MRs kept, {result['scanned']} scanned"
        + (" (scan limit reached)" if result["capped"] else "")
        + (f" - FAILED: {result['error']}" if result["status"] == "failed" else ""))
    return result


def process_mr(client, project_id, mr, mr_dir, result):
    prepare_mr_dir(mr_dir, mr)
    mr_path = f"/projects/{project_id}/merge_requests/{mr['iid']}"
    if mr.get("state") == "opened" and not is_approved(client, mr_path, mr_dir, result):
        return False
    discussions = read_cached(
        mr_dir / "discussions.json", lambda: list(client.get_all(f"{mr_path}/discussions")))
    author_id = (mr.get("author") or {}).get("id")
    threads = [d for d in discussions if is_review_thread(d, author_id)]
    if not threads:
        return False
    has_diff_thread = any(
        (d["notes"][0].get("original_position") or d["notes"][0].get("position")) for d in threads)
    if has_diff_thread:
        read_cached(mr_dir / "versions.json", lambda: fetch_versions(client, mr_path))
    return True


def is_approved(client, mr_path, mr_dir, result):
    if result["approvals_available"] is False:
        return False
    try:
        approvals = read_cached(mr_dir / "approvals.json", lambda: client.get(f"{mr_path}/approvals")[0])
    except GitlabError as error:
        if error.status in (403, 404):
            result["approvals_available"] = False
            return False
        raise
    result["approvals_available"] = True
    return bool(approvals.get("approved"))


def parse_args(argv):
    parser = argparse.ArgumentParser(
        description="Fetch reviewed GitLab merge requests and build the review-memory folder.")
    parser.add_argument("--projects", help="comma-separated project URLs (overrides PROJECT_URLS)")
    parser.add_argument("--projects-file", help="file with one project URL per line")
    parser.add_argument("--max-mrs", type=int, help="kept MRs per project (overrides MAX_MRS_PER_PROJECT)")
    parser.add_argument("--output", help="memory folder (overrides OUTPUT_DIR)")
    parser.add_argument("--since", help="ignore MRs last updated before YYYY-MM-DD")
    parser.add_argument("--max-parallel", type=int, help="cap on threads (default: one per project)")
    return parser.parse_args(argv)


def resolve_urls(args):
    if args.projects:
        return [u.strip() for u in args.projects.split(",") if u.strip()]
    if args.projects_file:
        lines = Path(args.projects_file).read_text(encoding="utf-8").splitlines()
        return [line.strip() for line in lines if line.strip() and not line.startswith("#")]
    return list(PROJECT_URLS)


def main(argv=None, env=None, http=None):
    args = parse_args(argv if argv is not None else sys.argv[1:])
    try:
        urls = resolve_urls(args)
        if not urls:
            raise ConfigError("no project URLs: edit PROJECT_URLS or pass --projects")
        if any(PLACEHOLDER_HOST in url for url in urls):
            raise ConfigError(f"project URLs still use the {PLACEHOLDER_HOST} placeholder: "
                              "edit PROJECT_URLS or pass --projects")
        specs = assign_slugs([parse_project_url(url) for url in urls])
        env = load_env() if env is None else env
        tokens = {spec["host"]: token_for(spec["host"], env) for spec in specs}
    except ConfigError as error:
        print(f"fetch_mrs: {error}", file=sys.stderr)
        return 2

    max_mrs = args.max_mrs or MAX_MRS_PER_PROJECT
    output_dir = Path(args.output or OUTPUT_DIR)
    raw_dir = output_dir / "raw"
    limiter = HostLimiter()
    client_args = {} if http is None else {"http": http}
    workers = min(args.max_parallel or len(specs), len(specs))

    def run(spec):
        client = GitlabClient(spec["api_base"], tokens[spec["host"]], spec["host"], limiter, **client_args)
        return fetch_project(spec, client, raw_dir, max_mrs, args.since)

    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(run, specs))

    summaries = write_output(output_dir, results, max_mrs, date.today().isoformat())
    failed = [s["slug"] for s in summaries if s["status"] != "ok"]
    for summary in summaries:
        log(f"[{summary['slug']}] {summary['threads']} threads "
            f"({summary['diff_threads']} diff, {summary['general_threads']} general, "
            f"{summary['addressed_threads']} addressed)")
        if summary["approvals_available"] is False:
            log(f"[{summary['slug']}] approvals API unavailable: only merged MRs were kept")
    if failed:
        print(f"fetch_mrs: failed projects: {', '.join(failed)}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
