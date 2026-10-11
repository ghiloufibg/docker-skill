import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

import support  # noqa: F401
import distill
import label
from memory_common import read_json, read_jsonl, write_jsonl, write_text

RULE = "Never swallow an outbound gateway failure; surface it as a domain error."
CHECK_ANSWER = """## Check T? — Surface outbound gateway failures

**Rule**: an adapter calling an external gateway never swallows a failure.

**Flag (Critical)**: a `catch` around a gateway call that logs and continues.

**Before / after**:
```java
catch (Exception e) { log.warn("x"); }
```
```java
gateway.call();
```

**Finding template**: `<call> swallows the <gateway> failure; rethrow it as <DomainError>.`
"""


def thread(number, project="payment-service", addressed=True, kind="diff", layer="adapter"):
    return {
        "id": f"{project}!{number}#abcd", "project": project, "project_url": f"https://g.test/t/{project}",
        "mr_iid": number, "mr_url": f"https://g.test/t/{project}/-/merge_requests/{number}",
        "mr_title": "t", "mr_state": "merged", "merged_at": f"2026-03-{number:02d}", "kind": kind,
        "file_path": "src/main/java/com/x/adapter/Gateway.java" if kind == "diff" else None,
        "layer": layer, "line_range": [1, 1], "code": "+catch (Exception e) {}",
        "comment": f"This swallows the timeout {number}.", "replies": [], "reviewer": f"reviewer-0{number % 3 + 1}",
        "resolved": True, "addressed": addressed, "fix": "+rethrow" if addressed else None,
    }


def run(function, *args):
    out = io.StringIO()
    with redirect_stdout(out):
        code = function(*args)
    return code, out.getvalue()


class PipelineBase(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.memory = Path(self.folder.name)
        self.threads = [thread(n, project="payment-service" if n % 2 else "order-service") for n in range(1, 5)]
        write_jsonl(self.memory / "projects" / "payment-service" / "threads.jsonl",
                    [t for t in self.threads if t["project"] == "payment-service"])
        write_jsonl(self.memory / "projects" / "order-service" / "threads.jsonl",
                    [t for t in self.threads if t["project"] == "order-service"])

    def tearDown(self):
        self.folder.cleanup()

    def answer_labels(self, name, mutate=None):
        lines = []
        for item in self.threads:
            entry = {"id": item["id"], "keep": True, "category": "error-handling",
                     "forseti_check": "spring-boot3", "severity": "critical", "rule": RULE}
            lines.append(mutate(entry) if mutate else entry)
        write_text(self.memory / "answers" / name,
                   "```\n" + "\n".join(json.dumps(line) for line in lines) + "\n```\n")


class LabelTest(PipelineBase):
    def test_prepare_writes_batched_prompts_and_skips_labeled(self):
        write_jsonl(self.memory / "labels.jsonl", [{"id": self.threads[0]["id"], "keep": False}])
        code, out = run(label.prepare, self.memory, 2, None)
        self.assertEqual(0, code)
        prompts = sorted((self.memory / "prompts").glob("label-*.md"))
        self.assertEqual(2, len(prompts))
        text = prompts[0].read_text(encoding="utf-8")
        self.assertIn("Return exactly 2 JSON lines", text)
        self.assertNotIn(self.threads[0]["id"], "".join(p.read_text(encoding="utf-8") for p in prompts))
        self.assertIn("3 threads in 2 prompt files", out)

    def test_prepare_respects_max_threads(self):
        run(label.prepare, self.memory, 20, 2)
        text = (self.memory / "prompts" / "label-001.md").read_text(encoding="utf-8")
        self.assertIn("Threads (2)", text)

    def test_ingest_accepts_valid_lines_and_builds_by_check(self):
        self.answer_labels("label-001.jsonl")
        code, out = run(label.ingest, self.memory)
        self.assertEqual(0, code, out)
        labels = read_jsonl(self.memory / "labels.jsonl")
        self.assertEqual(4, len(labels))
        self.assertEqual("CRITICAL", labels[0]["severity"])
        examples = read_jsonl(self.memory / "by-check" / "spring-boot3.jsonl")
        self.assertEqual(4, len(examples))
        self.assertEqual(RULE, examples[0]["rule"])
        self.assertTrue((self.memory / "answers" / "ingested" / "label-001.jsonl").is_file())

    def test_ingest_rejects_bad_lines_and_keeps_threads_unlabeled(self):
        def bad(entry):
            if entry["id"].endswith("!1#abcd"):
                entry["category"] = "nonsense"
            if entry["id"].endswith("!2#abcd"):
                entry["rule"] = "word " * 20
            if entry["id"].endswith("!3#abcd"):
                entry["id"] = "unknown!9#zzzz"
            return entry

        self.answer_labels("label-001.jsonl", bad)
        code, out = run(label.ingest, self.memory)
        self.assertEqual(1, code)
        self.assertIn("unknown category", out)
        self.assertIn("longer than 15 words", out)
        self.assertIn("unknown thread id", out)
        self.assertEqual(1, len(read_jsonl(self.memory / "labels.jsonl")))
        code, out = run(label.prepare, self.memory, 20, None)
        self.assertIn("3 threads in 1 prompt files", out)

    def test_ingest_is_idempotent_and_general_threads_go_to_plan_review(self):
        self.threads.append(thread(5, kind="general", layer="other"))
        write_jsonl(self.memory / "projects" / "payment-service" / "threads.jsonl",
                    [t for t in self.threads if t["project"] == "payment-service"])
        self.answer_labels("label-001.jsonl")
        run(label.ingest, self.memory)
        self.answer_labels("label-001.jsonl")
        run(label.ingest, self.memory)
        self.assertEqual(5, len(read_jsonl(self.memory / "labels.jsonl")))
        self.assertEqual(1, len(read_jsonl(self.memory / "by-check" / "plan-review.jsonl")))
        self.assertEqual(4, len(read_jsonl(self.memory / "by-check" / "spring-boot3.jsonl")))

    def test_by_check_prefers_addressed_and_caps_examples(self):
        self.threads = [thread(n, addressed=n > 25) for n in range(1, 31)]
        write_jsonl(self.memory / "projects" / "payment-service" / "threads.jsonl", self.threads)
        write_jsonl(self.memory / "projects" / "order-service" / "threads.jsonl", [])
        self.answer_labels("label-001.jsonl")
        run(label.ingest, self.memory)
        examples = read_jsonl(self.memory / "by-check" / "spring-boot3.jsonl")
        self.assertEqual(20, len(examples))
        self.assertEqual(5, sum(1 for e in examples if e["addressed"]))
        self.assertTrue(all(e["addressed"] for e in examples[:5]))


class DistillTest(PipelineBase):
    def setUp(self):
        super().setUp()
        self.answer_labels("label-001.jsonl")
        run(label.ingest, self.memory)
        self.key = "spring-boot3|error-handling|adapter"
        self.slug = "spring-boot3--error-handling--adapter"

    def test_prepare_groups_and_writes_prompt(self):
        code, out = run(distill.prepare, self.memory)
        self.assertEqual(0, code)
        groups = read_json(self.memory / "rules" / "groups.json")
        self.assertEqual(1, len(groups))
        self.assertEqual({"key": self.key, "mrs": 4, "projects": 2, "eligible": True, "severity": "CRITICAL"},
                         {k: groups[0][k] for k in ("key", "mrs", "projects", "eligible", "severity")})
        prompt = (self.memory / "prompts" / f"rules-{self.slug}.md").read_text(encoding="utf-8")
        self.assertIn("(4x) " + RULE, prompt)
        self.assertIn("Severity to use in the Flag line: Critical", prompt)
        self.assertEqual(2, prompt.count("### id:"))

    def test_groups_with_fewer_than_three_mrs_get_no_prompt(self):
        write_jsonl(self.memory / "labels.jsonl", read_jsonl(self.memory / "labels.jsonl")[:2])
        run(distill.prepare, self.memory)
        self.assertEqual([], list((self.memory / "prompts").glob("rules-*.md")))
        self.assertFalse(read_json(self.memory / "rules" / "groups.json")[0]["eligible"])

    def test_rejected_group_is_not_proposed_again(self):
        write_text(self.memory / "rules" / "rejected.md", f"- `{self.key}`\n")
        run(distill.prepare, self.memory)
        self.assertEqual([], list((self.memory / "prompts").glob("rules-*.md")))

    def test_ingest_builds_candidate_with_evidence_and_stable_id(self):
        run(distill.prepare, self.memory)
        write_text(self.memory / "answers" / f"rules-{self.slug}.md", CHECK_ANSWER)
        code, out = run(distill.ingest, self.memory)
        self.assertEqual(0, code, out)
        candidates = (self.memory / "rules" / "candidates.md").read_text(encoding="utf-8")
        self.assertIn("## Check T1 — Surface outbound gateway failures", candidates)
        self.assertIn("**Flag (Critical)**", candidates)
        self.assertIn("4 threads on 4 MRs in 2 projects", candidates)
        self.assertIn(f"Group: `{self.key}`", candidates)
        self.assertEqual({self.key: 1}, read_json(self.memory / "rules" / "ids.json"))
        run(distill.ingest, self.memory)
        self.assertEqual({self.key: 1}, read_json(self.memory / "rules" / "ids.json"))

    def test_ingest_rejects_rule_naming_a_project_or_missing_fields(self):
        run(distill.prepare, self.memory)
        leaking = CHECK_ANSWER.replace("an adapter calling", "payment-service calling")
        write_text(self.memory / "answers" / f"rules-{self.slug}.md", leaking)
        code, out = run(distill.ingest, self.memory)
        self.assertEqual(1, code)
        self.assertIn("names the project 'payment-service'", out)
        write_text(self.memory / "answers" / f"rules-{self.slug}.md", "just prose")
        code, out = run(distill.ingest, self.memory)
        self.assertIn("missing heading", out)

    def test_reconcile_prompt_then_answer(self):
        run(distill.prepare, self.memory)
        write_text(self.memory / "answers" / f"rules-{self.slug}.md", CHECK_ANSWER)
        run(distill.ingest, self.memory)
        prompt = (self.memory / "prompts" / "reconcile.md").read_text(encoding="utf-8")
        self.assertIn("## Candidate rules", prompt)
        self.assertIn("## forseti reference: naming-checklist.md", prompt)
        self.assertIn("## Current team rules", prompt)
        write_text(self.memory / "answers" / "reconcile.md", "## Confirmed\nNone.\n## New\n- T1\n")
        code, out = run(distill.ingest, self.memory)
        self.assertEqual(1, code)
        self.assertIn("missing sections Conflict, Unused", out)
        write_text(self.memory / "answers" / "reconcile.md",
                   "## Confirmed\nNone.\n## New\n- T1\n## Conflict\nNone.\n## Unused\nNone.\n")
        code, _ = run(distill.ingest, self.memory)
        self.assertEqual(0, code)
        self.assertIn("## New", (self.memory / "rules" / "reconcile.md").read_text(encoding="utf-8"))

    def test_ingest_before_prepare_fails(self):
        (self.memory / "rules" / "groups.json").unlink(missing_ok=True)
        self.assertEqual(2, distill.ingest(self.memory))


if __name__ == "__main__":
    unittest.main()
