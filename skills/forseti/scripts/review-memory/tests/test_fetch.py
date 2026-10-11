import io
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

import support
from fetch_mrs import main, parse_project_url, token_for, ConfigError
from memory_common import read_json, read_jsonl

ORDER = f"https://{support.HOST}/team-a/order-service"
CATALOG = f"https://{support.HOST}/team-b/catalog-service"
BROKEN = f"https://{support.HOST}/team-b/broken"


def run(args, fake):
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        code = main(args, env=support.ENV, http=fake)
    return code, out.getvalue(), err.getvalue()


class ParseTest(unittest.TestCase):
    def test_project_url_forms(self):
        spec = parse_project_url("https://g.test/team-a/sub/order-service.git/-/merge_requests")
        self.assertEqual("team-a/sub/order-service", spec["path"])
        self.assertEqual("team-a%2Fsub%2Forder-service", spec["project_id"])
        self.assertEqual("https://g.test/api/v4", spec["api_base"])

    def test_bad_url(self):
        with self.assertRaises(ConfigError):
            parse_project_url("https://g.test/just-a-group")

    def test_token_for_other_host_needs_its_own_variable(self):
        with self.assertRaises(ConfigError):
            token_for("other.test", support.ENV)
        self.assertEqual("x", token_for("other.test", {**support.ENV, "GITLAB_API_TOKEN_OTHER_TEST": "x"}))


class FetchTest(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.output = Path(self.folder.name)
        self.fake = support.FakeGitlab()

    def tearDown(self):
        self.folder.cleanup()

    def fetch(self, *urls, extra=()):
        return run(["--projects", ",".join(urls), "--output", str(self.output), *extra], self.fake)

    def test_refuses_placeholder_urls(self):
        code, _, err = run(["--projects", "https://gitlab.example.com/a/b", "--output", str(self.output)], self.fake)
        self.assertEqual(2, code)
        self.assertIn("placeholder", err)

    def test_refuses_unknown_host_without_token(self):
        code, _, err = run(["--projects", "https://other.test/a/b", "--output", str(self.output)], self.fake)
        self.assertEqual(2, code)
        self.assertIn("no token for host other.test", err)

    def test_builds_threads_and_outputs(self):
        code, out, _ = self.fetch(ORDER, CATALOG)
        self.assertEqual(0, code, out)
        threads = read_jsonl(self.output / "projects" / "order-service" / "threads.jsonl")
        by_kind = {t["kind"]: t for t in threads}
        self.assertEqual(2, len(threads), [t["comment"] for t in threads])
        diff = by_kind["diff"]
        self.assertEqual("order-service!1#d81f", diff["id"])
        self.assertEqual("domain", diff["layer"])
        self.assertTrue(diff["addressed"])
        self.assertTrue(diff["resolved"])
        self.assertEqual("merged", diff["mr_state"])
        self.assertEqual("reviewer-01", diff["reviewer"])
        self.assertEqual(["Good catch, rethrown now."], diff["replies"])
        self.assertEqual("general", by_kind["general"]["kind"])
        by_path = self.output / "by-path" / "order-service" / "com__example__order__domain__Order.java.jsonl"
        self.assertEqual(1, len(read_jsonl(by_path)))
        manifest = read_json(self.output / "manifest.json")
        self.assertEqual({"order-service", "catalog-service"}, {p["slug"] for p in manifest["projects"]})
        order = next(p for p in manifest["projects"] if p["slug"] == "order-service")
        self.assertEqual(1, order["mrs_kept"])
        self.assertFalse(order["approvals_available"])
        self.assertIn("approvals API unavailable", out)
        self.assertIsNotNone(read_json(self.output / "state.json")["order-service"])
        self.assertTrue((self.output / "README.md").is_file())

    def test_open_approved_mr_is_kept_when_approvals_exist(self):
        self.fake.approvals_status = 200
        original = self.fake.__call__

        def approving(url, headers):
            if url.split("?")[0].endswith("/merge_requests/3/approvals"):
                return 200, {}, b'{"approved": true}'
            return original(url, headers)

        code, _, _ = run(["--projects", ORDER, "--output", str(self.output)], approving)
        self.assertEqual(0, code)
        states = {t["mr_iid"]: t["mr_state"] for t in
                  read_jsonl(self.output / "projects" / "order-service" / "threads.jsonl")}
        self.assertEqual("open_approved", states[3])

    def test_unapproved_open_mr_is_skipped(self):
        self.fake.approvals_status = 200
        original = self.fake.__call__
        run(["--projects", ORDER, "--output", str(self.output)],
            lambda url, h: (200, {}, b'{"approved": false}') if url.split("?")[0].endswith("/approvals")
            else original(url, h))
        iids = {t["mr_iid"] for t in read_jsonl(self.output / "projects" / "order-service" / "threads.jsonl")}
        self.assertEqual({1}, iids)

    def test_max_mrs_counts_kept_mrs_only(self):
        self.fetch(ORDER, extra=["--max-mrs", "1"])
        manifest = read_json(self.output / "manifest.json")
        self.assertEqual(1, manifest["projects"][0]["mrs_kept"])
        self.assertEqual(1, manifest["projects"][0]["mrs_scanned"])

    def test_failed_project_does_not_stop_the_others(self):
        code, _, err = self.fetch(ORDER, BROKEN)
        self.assertEqual(1, code)
        self.assertIn("broken", err)
        manifest = read_json(self.output / "manifest.json")
        status = {p["slug"]: p["status"] for p in manifest["projects"]}
        self.assertEqual({"order-service": "ok", "broken": "failed"}, status)
        self.assertEqual(2, len(read_jsonl(self.output / "projects" / "order-service" / "threads.jsonl")))

    def test_rerun_uses_the_cache(self):
        self.fetch(ORDER)
        detail_calls = lambda: [c for c in self.fake.calls if "/discussions" in c or "/versions" in c]
        first = len(detail_calls())
        self.fetch(ORDER)
        self.assertEqual(first, len(detail_calls()))

    def test_since_stops_old_merge_requests(self):
        self.fetch(ORDER, extra=["--since", "2026-03-02"])
        manifest = read_json(self.output / "manifest.json")
        self.assertEqual(1, manifest["projects"][0]["mrs_kept"])
        self.assertEqual(2, manifest["projects"][0]["mrs_scanned"])

    def test_no_secrets_in_output(self):
        self.fetch(ORDER)
        for path in self.output.rglob("*"):
            if path.is_file():
                self.assertNotIn("test-token", path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
