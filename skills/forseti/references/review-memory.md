# Review memory

`SKILL.md` points here. Review memory is real reviewer feedback from past GitLab
merge requests, stored in `memory/` next to this skill. It is built on the
reviewer's machine and is gitignored; if `memory/manifest.json` does not
exist, skip everything in this file except the team rules.

A past reviewer comment is **evidence, not a rule**. It calibrates judgment and
supports a finding; it never creates a finding on its own, and a comment that does
not apply to the current code is not reported.

## What is in `memory/`

| Path | Use |
|---|---|
| `manifest.json` | Which projects are covered (`slug`, `url`) and the run date. Read first. |
| `by-check/<check>.jsonl` | Best real examples for one checklist. Checks: `hexagonal-boundary`, `naming`, `java21-idioms`, `spring-boot3`, `test-quality`, `no-comments`, `team-rules`. |
| `by-check/plan-review.jsonl` | Examples from MR-level comments, for plan review. |
| `by-path/<project>/<file>.jsonl` | Past threads on one Java file. |
| `projects/<project>/threads.jsonl` | Every thread. Never load it in full; open it only to find an example id cited by a team rule. |

## Limits

- At most 5 examples from `by-check/<check>.jsonl` while walking that checklist,
  `addressed: true` first.
- At most 3 threads from a file's `by-path` file, most recent `addressed: true`
  first. Plan review: at most 3 from `plan-review.jsonl`, chosen by the plan's layers.
- Never read `raw/`.

## Finding the project and the file

Match the reviewed repo's git remote URL (`git remote get-url origin`, ignoring a
trailing `.git`, and ignoring `ssh`/`https` differences) against `url` in
`manifest.json`. If none matches, skip the per-file history.

The by-path file name is the repo-relative path with everything up to and
including `src/main/java/` removed, `/` replaced by `__`, and `.jsonl` appended.
For `src/test/java/` the prefix `test/` is kept before the replacement (so it
becomes `test__...`). Names longer than 120 characters before `.jsonl` keep only
their last 120 characters.
Example: `order-service/src/main/java/com/example/order/OrderService.java` becomes
`by-path/order-service/com__example__order__OrderService.java.jsonl`.

## Record fields

`id`, `project`, `mr_url`, `kind` (`diff` or `general`), `file_path`, `layer`,
`line_range`, `code` (diff lines, prefixed `+`, `-` or space), `comment`,
`replies`, `resolved`, `addressed` (the code at that spot changed in a later
version of the MR), `fix`. In `by-check` files, also `category`, `severity` and
`rule`.

When citing a past thread as supporting evidence, quote its `mr_url`.

## Building and refreshing it

Scripts live in `scripts/review-memory/` (Python 3, standard library only).
`GITLAB_BASE_URL` and `GITLAB_API_TOKEN` (scope `read_api`) are read from
`~/.copilot/tools/.env`.

1. `python fetch_mrs.py --projects <url>[,<url>...] --max-mrs 200`
2. `python label.py prepare --max-threads 100`, run each `memory/prompts/label-*.md`
   in Copilot CLI, save each answer as `memory/answers/label-NNN.jsonl`,
   then `python label.py ingest`. Repeat until nothing is unlabeled.
3. `python distill.py prepare`, run each `memory/prompts/rules-*.md`, save each
   answer as `memory/answers/rules-<group>.md`, then `python distill.py ingest`.
   It writes `memory/rules/candidates.md` and `memory/prompts/reconcile.md`; run
   that prompt, save the answer as `memory/answers/reconcile.md`, and run
   `python distill.py ingest` again.
4. Read `memory/rules/reconcile.md`. Paste accepted checks from
   `memory/rules/candidates.md` into `team-review-rules.md`. To reject a rule,
   add its `Group:` key in backticks to `memory/rules/rejected.md`.
5. Commit `team-review-rules.md` only. Never commit `memory/`.
