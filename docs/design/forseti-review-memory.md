# Design: review memory for `forseti`, learned from past GitLab merge requests

Status: design only (revision 2). Nothing is implemented yet. Working name
for the component: `muninn`, after the raven that flies over the world every
day and brings back to Odin what it remembers. The name is open (section 13).

Revision 2: the fetch is our own script, modeled on the GitLab client in the
awesome-copilot repo instead of calling it. It takes a list of project URLs
and a number of MRs per project as input, with defaults written at the top of
the script, and fetches the projects in parallel, one thread per project. The
output is written next to the forseti skill and forseti reads it directly:
approved rules, plus real examples by checklist and by file. All hosts and
projects in this document are placeholders (`gitlab.example.com`).

## 1. Purpose and scope

`forseti` reviews Java 21 / Spring Boot 3.x code and plans against a fixed set
of checklists. Those checklists say what the skill's authors think matters.
They don't say what this team's reviewers actually ask for in merge requests.

This design adds a memory of past reviews, built from GitLab merge requests
(MRs) that real reviewers already reviewed, across several projects. Forseti
gets three things from it:

1. **Team rules.** Recurring reviewer feedback, turned into checks in the same
   format as forseti's existing checklists, approved by a person, and loaded
   on every review.
2. **Real examples per checklist.** For each forseti checklist, real review
   threads where a reviewer flagged that kind of issue, with the code before
   and after. Forseti uses them to calibrate what counts as a finding.
3. **Real examples per file.** For the project being reviewed, the past
   threads on each file, so forseti catches an issue a reviewer already
   flagged on the same code once.

Out of scope:
- Reviewing anything forseti doesn't review (non-Java stacks, build files).
- Replacing human review or posting comments on GitLab.
- Any database, server or installed dependency (decision D2).

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | The user runs the scripts on their own machine. | GitLab may only be reachable from the user's network, and the token stays on that machine. |
| D2 | No dependencies: Python 3 standard library only, no database, no `pip install`. Data is stored as JSONL and plain files. | Nothing to install or maintain. Any agent (Copilot, Claude Code) can read files. |
| D3 | The fetch script is **our own**, modeled on the GitLab client in the awesome-copilot repo. The user points to that repo, and we reuse its patterns (authentication, pagination, error handling, retries), not its code as a dependency. | Keeps the script standalone (D2) while following an approach the team already trusts. |
| D4 | The project URLs and the number of MRs to fetch are **inputs**: constants at the top of the script give the defaults, command-line options override them. | Edit once and run with no options, or override per run without editing the file. |
| D5 | Projects are fetched **in parallel, one thread per project**. | Most of the time is spent waiting on the network. Projects are independent, so they don't wait on each other. |
| D6 | The AI steps (labeling threads, writing rules) run through the **Copilot CLI**. | It's the AI tool the team already uses. No separate API key. |
| D7 | Steps that don't need AI use **0 AI tokens**. AI only sees data that is already filtered and trimmed. | Token cost is a stated concern. |
| D8 | No rule enters forseti without a person approving it. | Rules shape every future review. A wrong rule produces noise on every MR. |
| D9 | Real review data is never committed to this repo. Only approved rules are. The memory folder is gitignored. | Comments can contain internal names, links or secrets, and this repo holds the skill, not team data. |

## 3. Pipeline overview

```
 project URLs ─┐
 max MRs ──────┤
               ▼
        1. Fetch (one thread per project) ──► 2. Build output ──► 3. Label ──► 4. Distill + reconcile ──► 5. Approve ──► forseti
           script, 0 tokens                    script, 0 tokens    Copilot CLI   script + Copilot CLI      person
```

| Stage | Script | Input | Output |
|---|---|---|---|
| 1. Fetch | `fetch_mrs.py` | project URLs, max MRs, GitLab token | `raw/<project>/` cached JSON |
| 2. Build output | `fetch_mrs.py` (after all threads finish) | `raw/` | `projects/`, `by-path/`, `manifest.json` |
| 3. Label | `label.py` | `projects/*/threads.jsonl` | `labels.jsonl`, `by-check/` |
| 4. Distill + reconcile | `distill.py` | `labels.jsonl` + forseti references | `rules/candidates.md`, `rules/reconcile.md` |
| 5. Approve | person | `rules/*.md` | `references/team-review-rules.md` |
| Review time | forseti | diff + rules + memory folder | forseti report (section 10) |

The scripts live in the skill: `skills/forseti/scripts/muninn/`. Every stage
reads the previous stage's files and can be rerun on its own.

## 4. Stage 1: fetch, in parallel

### 4.1 Inputs

At the top of `fetch_mrs.py`, the only part of the file a user is expected to
edit:

```python
PROJECT_URLS = [
    "https://gitlab.example.com/team-a/order-service",
    "https://gitlab.example.com/team-a/payment-service",
    "https://gitlab.example.com/team-b/catalog-service",
]
MAX_MRS_PER_PROJECT = 200
OUTPUT_DIR = "skills/forseti/memory"
```

Command-line options override them for one run:

```
python fetch_mrs.py \
  --projects https://gitlab.example.com/team-a/order-service,https://gitlab.example.com/team-b/catalog-service \
  --max-mrs 50 \
  --output skills/forseti/memory
```

| Option | Overrides | Notes |
|---|---|---|
| `--projects URL[,URL...]` | `PROJECT_URLS` | Comma-separated project URLs, as copied from the browser. |
| `--projects-file PATH` | `PROJECT_URLS` | One URL per line, for long lists. |
| `--max-mrs N` | `MAX_MRS_PER_PROJECT` | Per project. See 4.3 for what counts. |
| `--output PATH` | `OUTPUT_DIR` | Where the memory folder is written. |
| `--since YYYY-MM-DD` | none | Optional: ignore MRs last updated before this date. |
| `--max-parallel N` | none | Optional cap on the number of threads (default: one per project). |

The script refuses to start if the list of projects is empty or still
contains the `gitlab.example.com` placeholders.

### 4.2 From a project URL to API calls

Each URL is split into a host and a project path:
`https://gitlab.example.com/team-a/order-service` gives the API base
`https://gitlab.example.com/api/v4` and the project id `team-a%2Forder-service`
(GitLab accepts the URL-encoded path wherever it expects a project id). Projects
on different GitLab hosts are allowed in the same run.

Token: `GITLAB_TOKEN` environment variable, scope `read_api` only, never
written to disk or logs. If projects live on more than one host,
`GITLAB_TOKEN_<HOST>` (for example `GITLAB_TOKEN_GITLAB_EXAMPLE_COM`) takes
precedence for that host.

### 4.3 Which MRs, and what "max MRs" counts

An MR is **kept** when both hold:

- it is **merged**, or it is **open and approved** (per the approvals API);
- it has **at least one review thread** (4.4).

`MAX_MRS_PER_PROJECT` counts **kept** MRs, newest first. The script lists MRs
page by page from the most recently updated, keeps the ones that qualify, and
stops at the limit. So the result is the N most recent reviewed MRs, not the N
most recent MRs of which many have no comments. To avoid paging through a
whole project that has few reviews, it also stops after scanning 10 × N MRs,
and says so in the summary.

Open, unapproved MRs are skipped: their review isn't settled. Open approved
MRs are kept and marked `mr_state: open_approved`, since their code can still
change.

### 4.4 What counts as a review thread

A discussion on the MR whose first note:
- is not a system note (`system: false`),
- is not from a bot account (configurable list, plus GitLab's `bot` flag),
- is not from the MR's author (the author's replies inside someone else's
  thread are kept).

Both thread types are kept:
- **Diff threads** (they have a `position`): attached to a file and line.
  These feed code-mode reviews.
- **General threads** (no `position`): comments on the MR as a whole, kept if
  they pass the filters in 5.1. They feed plan-review mode.

### 4.5 API calls, per MR

| Call | Used for |
|---|---|
| `GET /projects/:id/merge_requests?state=merged&order_by=updated_at` and `?state=opened` | list candidate MRs, paginated |
| `GET .../merge_requests/:iid/approvals` | approval state of open MRs |
| `GET .../merge_requests/:iid/discussions` | threads, notes, `position`, `resolved` |
| `GET .../merge_requests/:iid/versions` | `diff_refs` of each version, to find the code a comment was on |
| `GET .../merge_requests/:iid/diffs` | the diff hunks |
| `GET .../merge_requests/:iid/commits` | commits after a comment, to find whether it led to a change |

### 4.6 Parallel execution

- One worker thread per project (`concurrent.futures.ThreadPoolExecutor`),
  capped by `--max-parallel` if given.
- Inside a project, requests are sequential. That keeps the load on each
  GitLab host predictable and makes rate limits easy to respect: on `429`
  the thread waits for `Retry-After` and continues. Projects on the same host
  share a small per-host limiter so many threads can't flood one server.
- Each thread writes only under `raw/<project-slug>/`, so threads never write
  to the same file and need no locking.
- A failure in one project (bad URL, no access, network error after retries)
  is recorded and doesn't stop the others. The run's exit code is non-zero if
  any project failed.
- Progress is printed per project: `[order-service] 120/200 MRs kept, 480 scanned`.
- Every response is cached under `raw/<project-slug>/<mr_iid>/`. A rerun reads
  the cache and only asks GitLab for MRs updated since the last run
  (`state.json`, one date per project).

Stage 2 starts only after all threads have finished. It is the only step
that writes shared files.

## 5. Stage 2: build the output

### 5.1 Filters (no AI)

A thread is **dropped** when:
- its first note is approval chatter: `LGTM`, `+1`, `👍`, `nice`, `thanks`, or
  shorter than a configurable minimum (default 15 characters after removing
  code and links);
- it is a diff thread on a file forseti doesn't review (anything other than
  `*.java`; the list is configurable);
- it is a near-duplicate of a thread already kept on the same MR (same file,
  same normalized text).

A thread is **kept but marked** with:
- `addressed: true` when a later commit in the same MR changed the lines the
  comment points at, or the thread was resolved and the author replied with a
  change. This is the strongest sign the comment was valid; stage 3 and
  forseti prefer these threads.
- `addressed: false` otherwise. A resolved thread with no code change can
  still be a valid "don't do this next time".

### 5.2 Cleaning

- Code context trimmed to about 10 lines around the commented lines.
- Comment text: GitLab markup removed, quoted earlier replies removed.
- Scrubbed: e-mail addresses, internal URLs, anything that looks like a token
  or password. Reviewer and author names are replaced by a stable alias
  (`reviewer-07`), with the mapping kept only in `raw/`.

### 5.3 Output layout

```
skills/forseti/memory/                     gitignored (D9)
  README.md          generated: what is here, counts, last run, how to read it
  manifest.json      projects, URLs, MR limit, run date, counts per project
  state.json         last sync date per project
  raw/               cached GitLab responses, never read by forseti
  projects/
    order-service/
      threads.jsonl  one review thread per line
    payment-service/
      threads.jsonl
  by-path/
    order-service/
      src__main__java__com__example__order__OrderService.java.jsonl
  by-check/          written by stage 3
    hexagonal-boundary.jsonl
    naming.jsonl
    java21-idioms.jsonl
    spring-boot3.jsonl
    test-quality.jsonl
    no-comments.jsonl
    team-rules.jsonl
  labels.jsonl       stage 3 output, one line per thread id
  rules/
    candidates.md    stage 4 output
    reconcile.md     stage 4 output, compared with forseti
    rejected.md      rules a person rejected, never proposed again
```

- `projects/` is the full data, one folder per project.
- `by-path/<project>/` holds the same threads split by file. The file name is
  the repo-relative path with `/` replaced by `__`. Forseti finds a file's
  history by opening one file, no grep needed. Forseti was made portable to
  Copilot by dropping Unix-only grep instructions, and this keeps it that way.
- `by-check/` holds, for each forseti checklist, the best real examples of that
  kind of issue across all projects (stage 3 picks them: addressed threads,
  short code, at most 20 per checklist). This is what forseti reads to see
  real data next to each rule.
- `manifest.json` lets forseti check that memory exists, which projects it
  covers and how old it is, without reading anything else.

### 5.4 Record format (one line of `threads.jsonl`)

```json
{
  "id": "payment-service!412#d81f",
  "project": "payment-service",
  "project_url": "https://gitlab.example.com/team-a/payment-service",
  "mr_iid": 412,
  "mr_url": "https://gitlab.example.com/team-a/payment-service/-/merge_requests/412",
  "mr_title": "Refund partial captures",
  "mr_state": "merged",
  "merged_at": "2026-03-04",
  "kind": "diff",
  "file_path": "src/main/java/com/example/payment/RefundService.java",
  "layer": "application",
  "line_range": [88, 94],
  "code": "...about 10 lines around the comment...",
  "comment": "This swallows the gateway timeout, the caller never knows the refund failed.",
  "replies": ["Good catch, now rethrown as RefundFailed."],
  "reviewer": "reviewer-07",
  "resolved": true,
  "addressed": true,
  "fix": "...the same lines after the follow-up commit..."
}
```

`layer` uses forseti's own classification (domain, application, adapter),
taken from the package path, so examples line up with forseti's checklists.

## 6. Stage 3: label threads (Copilot CLI)

Each thread gets a short label, written to `labels.jsonl`:

```json
{"id": "payment-service!412#d81f", "keep": true, "category": "error-handling",
 "forseti_check": "spring-boot3", "severity": "CRITICAL",
 "rule": "Never swallow an outbound gateway failure; surface it as a domain error."}
```

- `keep`: false when the comment only matters for that one MR (a typo, a
  question, a product decision).
- `category`: from a fixed list (boundary, naming, java-idioms, spring, tests,
  comments, error-handling, security, performance, other), so stage 4 can
  group without AI.
- `forseti_check`: the forseti checklist it fits (`hexagonal-boundary`,
  `naming`, `java21-idioms`, `spring-boot3`, `test-quality`, `no-comments`),
  or `team-rules` when it fits none of them.
- `severity`: proposed, on forseti's scale (CRITICAL / IMPORTANT /
  RECOMMENDED). A person confirms it in stage 5.
- `rule`: a one-line rule of 15 words or fewer.

How it runs:
- Batches of 20–50 threads. Only `id`, `file_path`, `layer`, `code`, `comment`,
  the first reply and `fix` are sent, never the whole MR.
- Each batch goes to the Copilot CLI in non-interactive mode with one fixed
  prompt file (`prompts/label.md`) and must come back as JSONL. The exact CLI
  flags (prompt, model choice) are to be checked against the installed version.
- Each answer is validated (valid JSON, known category, check and severity).
  A failed batch is retried once, then logged and skipped.
- Thread ids already in `labels.jsonl` are never sent again.
- `--dry-run` prints the number of batches and estimated tokens (characters ÷ 4)
  without calling anything. `--max-threads N` caps a run.
- At the end, the script rebuilds `by-check/` from the labels (no AI).

## 7. Stage 4: distill rules and reconcile with forseti

### 7.1 Group (no AI)

Keep labels with `keep: true`. Group them by `forseti_check` + `category` +
top-level package. Inside a group, count threads, distinct MRs, distinct
projects and reviewers, and how many were `addressed`. Groups backed by fewer
than 3 MRs are listed as "seen once or twice" and don't become rules.

### 7.2 Write rules (Copilot CLI)

One call per group. The input is the group's one-line rules plus 2 example
threads (the shortest addressed ones), never all the raw threads. The output
uses forseti's checklist format, so an approved rule can be pasted in as is:

```markdown
## Check T7 — Surface outbound gateway failures

**Rule**: an adapter calling an external gateway never swallows a failure; it
rethrows it as a domain error the use case can handle.

**Flag (Critical)**: a `catch` around a gateway client call that logs and
continues, or returns `null`/`Optional.empty()`.

**Evidence**: 9 threads on 7 MRs in 3 projects, 4 reviewers, 8 addressed. Last
seen 2026-08-19. Examples: `payment-service!412#d81f`, `order-service!88#a03c`
(full threads in `memory/by-check/spring-boot3.jsonl`).

**Before / after**: <the trimmed code and fix from one example>

**Finding template**: `<call> swallows the <gateway> failure; rethrow it as
<DomainError> so the caller knows the operation failed.`
```

Example ids point into the memory folder, so forseti (and a person) can open
the full thread.

### 7.3 Reconcile with forseti's existing rules

The Copilot CLI gets the candidate rules and forseti's reference files
(`hexagonal-boundary-checklist.md`, `naming-checklist.md`,
`java21-modern-idioms.md`, `spring-boot3-practices.md`,
`test-quality-checklist.md`, `no-comments-policy.md`). It puts every rule in
one bucket in `rules/reconcile.md`:

| Bucket | Meaning | Default action |
|---|---|---|
| **Confirmed** | forseti already has this rule, and reviewers enforce it. | Add the evidence line to the existing check. No new rule. |
| **New** | reviewers enforce it, forseti doesn't have it. | Proposed as a new `T` check. |
| **Conflict** | reviewers ask for the opposite of a forseti rule. | Flagged for a person. Never applied automatically. |
| **Unused** | a forseti rule no reviewer ever raised. | Reported only. Nothing removed: absence of comments may mean the rule already works. |

## 8. Stage 5: approve

A person reads `rules/reconcile.md` and accepts or rejects each New and
Conflict entry, and each evidence line added to an existing check. Accepted
rules go into `skills/forseti/references/team-review-rules.md`. That file is
the only output committed to git, and it contains only rules and trimmed,
scrubbed before/after snippets, never full threads. Rejected rules go to
`rules/rejected.md` so they aren't proposed again.

## 9. What forseti references

| Element | Path (relative to the skill) | Committed | Read by forseti |
|---|---|---|---|
| Team rules | `references/team-review-rules.md` | yes | always, as a checklist |
| How to use the memory | `references/review-memory.md` (new) | yes | when `memory/manifest.json` exists |
| Memory overview | `memory/manifest.json` | no | first, to know what exists |
| Examples per checklist | `memory/by-check/<check>.jsonl` | no | while walking that checklist |
| Examples per file | `memory/by-path/<project>/<file>.jsonl` | no | for each file in review scope |
| Full threads | `memory/projects/<project>/threads.jsonl` | no | only to open an example id cited by a rule |

`references/review-memory.md` explains the record format, the limits below and
the evidence rule, so `SKILL.md` only needs a short pointer.

## 10. How forseti uses it

Changes to `skills/forseti/SKILL.md`:

1. **Inventory (step 1) gains one check.** Look for `memory/manifest.json`. If
   it exists, note which projects it covers and its date, and find which
   project is under review by matching the reviewed repo's git remote URL
   against `project_url` in the manifest. If no project matches, per-file
   examples are skipped; per-checklist examples and team rules still apply.
2. **Each checklist step (2–6) can read real examples.** While walking a
   checklist, open `memory/by-check/<that check>.jsonl` and read at most 5
   examples, addressed first. They show what this team's reviewers flag under
   that check and at what severity. They calibrate judgment; they never add a
   finding by themselves.
3. **A new step after step 5: team rules.** Walk
   `references/team-review-rules.md` like any other checklist: same severity
   scale, same evidence rule, same report structure. A finding cites the `T`
   check it breaks.
4. **Per-file history.** For each file in review scope, open
   `memory/by-path/<project>/<file>.jsonl` and read at most the 3 most recent
   addressed threads. If a past comment applies to the current code, report it
   under the matching check and cite the past MR (`mr_url`) as supporting
   evidence.
5. **Self-check unchanged.** A past reviewer comment is evidence, not a rule.
   If it doesn't apply to the current code, it isn't reported.

If the `memory/` folder doesn't exist, forseti skips items 1, 2 and 4 without
comment and works as it does today; team rules (item 3) still apply.

Plan-review mode reads team rules the same way, and reads past examples only
from general threads (`kind: general`), at most 3, chosen by the plan's
packages.

## 11. Token budget

| Where | Cost | How it's kept down |
|---|---|---|
| Stages 1–2 | 0 | Plain scripts (D7). |
| Stage 3, labeling | one-time, the largest | Filters first (5.1), short records (about 200–400 tokens each), batches of 20–50, cheapest Copilot model, nothing labeled twice, `--dry-run` estimate first. |
| Stage 4, rules | one-time, small | Grouped by script first. AI sees one-line rules and 2 examples per group. One reconcile call over the rules list. |
| Each review | recurring, the one that matters | Team rules under 2k tokens. At most 5 examples per checklist actually walked, at most 3 past threads per file in scope, all already trimmed. `projects/*/threads.jsonl` is never loaded in full. |

Rough scale: 3 projects × 200 MRs, about 2,000 threads after filtering ×
about 350 tokens is roughly 700k input tokens for labeling, once. Later runs
only label new threads. The first labeling run is a pilot (`--max-threads 100`)
to compare measured usage with the estimate.

## 12. Checking that it works

- **Replay:** hold back the 20–30 most recent reviewed MRs. Run forseti on each
  MR's first version with and without the memory. Measure how many of the human
  reviewers' comments forseti also raised (recall), and how many of forseti's
  findings a reviewer would accept (precision).
- **Size watch:** if the team rules file grows past its target, merge or drop
  the weakest rules rather than raising the target.
- **Refresh:** rerun stages 1–4 on a schedule (for example monthly). Rules whose
  evidence stops growing are proposed for removal in `reconcile.md`.

## 13. Open questions

1. **The awesome-copilot GitLab client:** the user will give the repo. Its
   patterns are to be read before writing `fetch_mrs.py`.
2. **Copilot CLI:** the version installed, its non-interactive flags, and which
   models are available for the cheap labeling pass.
3. **Shared or per-project rules:** one `team-review-rules.md` for all
   projects, or a shared file plus project-specific additions.
4. **Name:** `muninn`, or another name.

## 14. Staged plan

| Stage | Delivers | Done when |
|---|---|---|
| A | `fetch_mrs.py` (stages 1–2) | The user runs it on 2–3 projects in parallel and gets `projects/`, `by-path/`, `manifest.json` and a per-project summary. |
| B | `label.py`, pilot | 100 threads labeled, `by-check/` built, measured tokens compared with the estimate. |
| C | Full labeling, `distill.py` | `rules/candidates.md` and `rules/reconcile.md` produced. |
| D | Approval and forseti integration (sections 9–10) | `team-review-rules.md` and `review-memory.md` committed, `SKILL.md` updated, `memory/` gitignored, replay run once. |
