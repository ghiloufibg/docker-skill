import tempfile
import unittest
from pathlib import Path

import support  # noqa: F401
from diff_tools import analyze_position, parse_diff
from gitlab_client import GitlabClient, GitlabError, HostLimiter
from memory_common import (
    Aliases,
    clean_comment,
    is_chatter,
    layer_of,
    memory_file_name,
    parse_env_file,
    scrub,
)


class ScrubTest(unittest.TestCase):
    def test_removes_email_url_and_tokens(self):
        text = "mail bob@corp.example.com see https://git.corp/x/y token=abc123 glpat-abcdefghij12345"
        result = scrub(text)
        self.assertNotIn("bob@", result)
        self.assertNotIn("git.corp", result)
        self.assertNotIn("abc123", result)
        self.assertNotIn("glpat", result)

    def test_keeps_long_identifiers_without_digits(self):
        name = "shouldReturnRefundFailedWhenGatewayTimesOutAfterRetry"
        self.assertEqual(name, scrub(name))

    def test_redacts_opaque_strings_with_digits(self):
        self.assertIn("<redacted>", scrub("key AbCd1234AbCd1234AbCd1234AbCd1234AbCd"))


class CommentTest(unittest.TestCase):
    def test_clean_comment_drops_quotes_and_links(self):
        cleaned = clean_comment("> earlier reply\nsee [the doc](https://x.y/z)\n\n\n\nok")
        self.assertEqual("see the doc\n\nok", cleaned)

    def test_chatter(self):
        self.assertTrue(is_chatter("LGTM", 15))
        self.assertTrue(is_chatter("looks good, nice, thanks!", 5))
        self.assertTrue(is_chatter("👍", 1))
        self.assertFalse(is_chatter("This swallows the gateway timeout.", 15))

    def test_code_and_links_do_not_count_toward_length(self):
        self.assertTrue(is_chatter("ok ```java\nlong code here that is longer than limit\n```", 15))


class PathTest(unittest.TestCase):
    def test_layer(self):
        self.assertEqual("domain", layer_of("src/main/java/com/x/domain/Order.java"))
        self.assertEqual("application", layer_of("a/application/usecase/Pay.java"))
        self.assertEqual("adapter", layer_of("a/adapter/out/db/Repo.java"))
        self.assertEqual("other", layer_of("a/util/Strings.java"))

    def test_memory_file_name(self):
        self.assertEqual(
            "com__example__order__OrderService.java.jsonl",
            memory_file_name("svc/src/main/java/com/example/order/OrderService.java"),
        )
        self.assertEqual(
            "test__com__example__OrderTest.java.jsonl",
            memory_file_name("src/test/java/com/example/OrderTest.java"),
        )

    def test_long_names_keep_the_tail(self):
        name = memory_file_name("src/main/java/" + "/".join(["pkg"] * 80) + "/Order.java")
        self.assertEqual(120 + len(".jsonl"), len(name))
        self.assertTrue(name.endswith("Order.java.jsonl"))


class EnvAndAliasTest(unittest.TestCase):
    def test_parse_env_file(self):
        values = parse_env_file('# c\nGITLAB_BASE_URL="https://g.test"\nGITLAB_API_TOKEN=abc\n\nbad line\n')
        self.assertEqual({"GITLAB_BASE_URL": "https://g.test", "GITLAB_API_TOKEN": "abc"}, values)

    def test_aliases_are_stable_and_replace_mentions(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "aliases.json"
            aliases = Aliases(path)
            self.assertEqual("reviewer-01", aliases.get("alice"))
            self.assertEqual("hi @reviewer-02 and @reviewer-01", aliases.apply("hi @bob and @alice"))
            aliases.save()
            self.assertEqual("reviewer-02", Aliases(path).get("bob"))


class DiffToolsTest(unittest.TestCase):
    def test_parse_diff_numbers_lines(self):
        lines = parse_diff("@@ -3,2 +3,3 @@\n ctx\n-old\n+new\n+more\n")
        self.assertEqual([(3, 3, "="), (4, None, "-"), (None, 4, "+"), (None, 5, "+")],
                         [(l.old, l.new, l.kind) for l in lines])

    def test_unchanged_line_is_not_addressed(self):
        v1 = {"head_commit_sha": "h1", "diffs": [{"new_path": "A.java", "diff": support.DIFF_V1}]}
        v2 = {"head_commit_sha": "h2", "diffs": [{"new_path": "A.java", "diff": support.DIFF_V1}]}
        pos = support.position(path="A.java")
        self.assertFalse(analyze_position(pos, [v1, v2])["addressed"])

    def test_changed_line_is_addressed_and_has_fix(self):
        v1 = {"head_commit_sha": "h1", "diffs": [{"new_path": "A.java", "diff": support.DIFF_V1}]}
        v2 = {"head_commit_sha": "h2", "diffs": [{"new_path": "A.java", "diff": support.DIFF_V2}]}
        found = analyze_position(support.position(path="A.java"), [v1, v2])
        self.assertTrue(found["addressed"])
        self.assertIn("gateway.call(); }", found["fix"])
        self.assertIn("catch (Exception e)", found["code"])

    def test_latest_version_is_never_addressed(self):
        v1 = {"head_commit_sha": "h1", "diffs": [{"new_path": "A.java", "diff": support.DIFF_V1}]}
        self.assertFalse(analyze_position(support.position(path="A.java"), [v1])["addressed"])

    def test_file_dropped_from_next_version_is_addressed(self):
        v1 = {"head_commit_sha": "h1", "diffs": [{"new_path": "A.java", "diff": support.DIFF_V1}]}
        v2 = {"head_commit_sha": "h2", "diffs": []}
        self.assertTrue(analyze_position(support.position(path="A.java"), [v1, v2])["addressed"])


class ClientTest(unittest.TestCase):
    def make(self, responses, sleeps):
        iterator = iter(responses)

        def http(url, headers):
            response = next(iterator)
            if isinstance(response, Exception):
                raise response
            return response

        return GitlabClient("https://g.test/api/v4", "secret-token", "g.test", HostLimiter(),
                            http=http, sleep=sleeps.append)

    def test_retries_server_errors_and_network_errors(self):
        sleeps = []
        client = self.make([(500, {}, b""), OSError("boom"), (200, {}, b'{"ok": true}')], sleeps)
        data, _ = client.get("/x")
        self.assertEqual({"ok": True}, data)
        self.assertEqual([1, 2], sleeps)

    def test_rate_limit_waits_for_retry_after(self):
        sleeps = []
        client = self.make([(429, {"retry-after": "7"}, b""), (200, {}, b"[]")], sleeps)
        client.get("/x")
        self.assertEqual([7], sleeps)

    def test_client_error_is_not_retried_and_hides_token(self):
        client = self.make([(403, {}, b"")], [])
        with self.assertRaises(GitlabError) as caught:
            client.get("/x")
        self.assertEqual(403, caught.exception.status)
        self.assertNotIn("secret-token", str(caught.exception))

    def test_gives_up_after_max_attempts(self):
        client = self.make([(503, {}, b"")] * 4, [])
        with self.assertRaises(GitlabError):
            client.get("/x")

    def test_get_all_follows_next_page(self):
        client = self.make([(200, {"x-next-page": "2"}, b"[1]"), (200, {"x-next-page": ""}, b"[2]")], [])
        self.assertEqual([1, 2], list(client.get_all("/x")))


if __name__ == "__main__":
    unittest.main()
