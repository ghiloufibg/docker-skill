import json
import sys
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

HOST = "gitlab.test"
ENV = {"GITLAB_BASE_URL": f"https://{HOST}", "GITLAB_API_TOKEN": "test-token"}
DOMAIN_PATH = "src/main/java/com/example/order/domain/Order.java"

DIFF_V1 = (
    "@@ -0,0 +1,5 @@\n"
    "+package com.example.order.domain;\n"
    "+\n"
    "+class Order {\n"
    "+    void pay() { try { gateway.call(); } catch (Exception e) { log.warn(\"x\"); } }\n"
    "+}\n"
)
DIFF_V2 = (
    "@@ -0,0 +1,5 @@\n"
    "+package com.example.order.domain;\n"
    "+\n"
    "+class Order {\n"
    "+    void pay() { gateway.call(); }\n"
    "+}\n"
)


def note(body, author_id=2, username="alice", **extra):
    base = {"body": body, "system": False, "author": {"id": author_id, "username": username},
            "resolvable": True, "resolved": True}
    base.update(extra)
    return base


def position(path=DOMAIN_PATH, line=4, head_sha="h1"):
    return {"head_sha": head_sha, "new_path": path, "old_path": path, "new_line": line, "old_line": None}


def diff_discussion(disc_id, body, path=DOMAIN_PATH, **note_extra):
    return {"id": disc_id, "notes": [note(body, original_position=position(path), **note_extra),
                                     note("Good catch, rethrown now.", author_id=1, username="author")]}


def mr(iid, state="merged", updated="2026-03-04T10:00:00Z"):
    return {"iid": iid, "title": f"MR {iid}", "state": state, "updated_at": updated,
            "merged_at": updated if state == "merged" else None,
            "web_url": f"https://{HOST}/team-a/order-service/-/merge_requests/{iid}",
            "author": {"id": 1, "username": "author"}}


class FakeGitlab:
    def __init__(self):
        self.calls = []
        self.fail_projects = set()
        self.order_service = {
            "merged": [mr(1), mr(2, updated="2026-03-01T10:00:00Z")],
            "opened": [mr(3, state="opened", updated="2026-03-03T10:00:00Z")],
        }
        self.discussions = {
            1: [
                diff_discussion("d81f" + "0" * 36, "This swallows the gateway timeout, rethrow it as a domain error."),
                diff_discussion("aaaa" + "0" * 36, "LGTM"),
                diff_discussion("bbbb" + "0" * 36, "Rename this class to match the business term, please.",
                                path="src/main/resources/schema.sql"),
                {"id": "cccc" + "0" * 36, "notes": [note("added 1 commit", system=True)]},
                {"id": "dddd" + "0" * 36, "notes": [note("Pipeline failed, please check the build output.",
                                                         username="project_7_bot")]},
                {"id": "eeee" + "0" * 36, "notes": [note("Please describe the rollout plan for this change.")]},
            ],
            2: [],
            3: [diff_discussion("ffff" + "0" * 36, "Same remark but on an unapproved open merge request.")],
        }
        self.versions = {
            11: {"id": 11, "created_at": "2026-03-01T10:00:00Z", "head_commit_sha": "h1",
                 "diffs": [{"old_path": DOMAIN_PATH, "new_path": DOMAIN_PATH, "diff": DIFF_V1}]},
            12: {"id": 12, "created_at": "2026-03-02T10:00:00Z", "head_commit_sha": "h2",
                 "diffs": [{"old_path": DOMAIN_PATH, "new_path": DOMAIN_PATH, "diff": DIFF_V2}]},
        }
        self.approvals_status = 404

    def __call__(self, url, headers):
        self.calls.append(url)
        parts = urllib.parse.urlsplit(url)
        query = urllib.parse.parse_qs(parts.query)
        path = parts.path
        if "broken" in path and path.endswith("/merge_requests"):
            return 403, {}, b"{}"
        if "order-service" not in path:
            return self._ok([])
        if path.endswith("/merge_requests"):
            return self._ok(self.order_service[query["state"][0]])
        if path.endswith("/approvals"):
            return self.approvals_status, {}, b"{}"
        iid = int(path.split("/merge_requests/")[1].split("/")[0])
        if path.endswith("/discussions"):
            return self._ok(self.discussions[iid])
        if path.endswith("/versions"):
            return self._ok([{"id": v["id"], "created_at": v["created_at"],
                              "head_commit_sha": v["head_commit_sha"]} for v in self.versions.values()])
        if "/versions/" in path:
            return self._ok(self.versions[int(path.rsplit("/", 1)[1])])
        return 404, {}, b"{}"

    @staticmethod
    def _ok(data):
        return 200, {"x-next-page": ""}, json.dumps(data).encode("utf-8")
