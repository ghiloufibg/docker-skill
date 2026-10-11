# Design: review memory for `forseti`, learned from past GitLab merge requests

Status: design only (revision 1). Nothing is implemented yet. Working name
for the component: `muninn`, after the raven that flies over the world every
day and brings back to Odin what it remembers. The name is open (see
section 12).

## 1. Purpose and scope

`forseti` reviews Java 21 / Spring Boot 3.x code and plans against a fixed set
of checklists. Those checklists say what the skill's authors think matters.
They don't say what this team's reviewers actually ask for in merge requests.

This design adds a memory of past reviews, built from GitLab merge requests
(MRs) that real reviewers already reviewed. It has two outputs:

1. **Team rules.** Recurring reviewer feedback, turned into checks in the same
   format as forseti's existing checklists, approved by a person, and loaded
   on every review.
2. **Past examples.** One record per review thread, stored as plain files.
   During a review, forseti opens the records for the files in the diff, so it
   can catch an issue a reviewer already flagged on the same code once.

The goal: forseti raises what the team's reviewers would have raised, catches
repeats of issues that were missed before, and the team can see in the rules
what its reviewers expect.

Out of scope:
- Reviewing anything forseti doesn't review (non-Java stacks, build files).
- Replacing human review or posting comments on GitLab.
- Any database, server or installed dependency (section 2, decision D2).

## 2. Decisions already taken

| # | Decision | Why |
|---|---|---|
| D1 | The user runs the pull script on their own machine. | GitLab may only be reachable from the user's network, and the token stays on that machine. |
| D2 | No dependencies: no database, no `pip`/`npm` install. Data is stored as JSONL and plain files. | Nothing extra to install or maintain. Any agent (Copilot, Claude Code) can already read files. |
| D3 | The GitLab API calls go through the GitLab client from the `awesome-copilot` repo. | Reuse what exists instead of writing a new client. That repo wasn't reachable from the session where this design was written, so its interface is to be confirmed (section 12). |
| D4 | The AI steps (labeling threads, writing rules) run through the **Copilot CLI**. | It's the AI tool the team already uses. No separate API key. |
| D5 | Stages that don't need AI are plain scripts, and use **0 AI tokens**. | Token cost is a stated concern. AI only sees data that is already filtered and trimmed. |
| D6 | No rule enters forseti without a person approving it. | Rules shape every future review. A wrong rule produces noise on every MR. |
| D7 | Raw review data never goes into git. Only approved rules do. | Comments can contain internal names, links or secrets. |

## 3. Pipeline overview

```
 GitLab ──► 1. Pull ──► 2. Filter + store ──► 3. Label ──► 4. Distill + reconcile ──► 5. Approve ──► forseti
          (script)       (script)              (Copilot CLI)  (script + Copilot CLI)    (person)
          0 tokens       0 tokens              one-time       one-time, small
```

| Stage | Input | Output | Runs |
|---|---|---|---|
| 1. Pull | GitLab API | `raw/` cached JSON | script, user's machine |
| 2. Filter + store | `raw/` | `threads.jsonl`, `by-path/`, `index.json` | script |
| 3. Label | `threads.jsonl` | `labels.jsonl` | Copilot CLI, in batches |
| 4. Distill + reconcile | `labels.jsonl` + forseti references | `rules/candidates.md`, `rules/reconcile.md` | script groups, Copilot CLI writes |
| 5. Approve | `rules/*.md` | `skills/forseti/references/team-review-rules.md` | person |
| Review time | diff + rules + `by-path/` | forseti report | forseti (section 9) |

Every stage reads the previous stage's files and can be rerun on its own.
Stages 1–3 only process what's new since the last run.

## 4. Stage 1: pull from GitLab

### 4.1 Which MRs

An MR is pulled when **both** hold:

- It is **merged**, or it is **open and approved** (per the approvals API).
- It has **at least one review thread**, defined in 4.2.

Open, unapproved MRs are skipped: their review isn't settled and their code
is still changing. Open approved MRs are kept but marked
`mr_state: open_approved`, since their code can still change.

### 4.2 What counts as a review thread

A discussion on the MR whose first note:
- is not a system note (`system: false`),
- is not from a bot account (configurable list, plus GitLab's `bot` flag),
- is not from the MR's author (the author's replies inside someone else's
  thread are kept).

Both thread types are kept:
- **Diff threads** (they have a `position`): attached to a file and line.
  These feed code-mode reviews.
- **General threads** (no `position`): comments on the MR as a whole. Kept
  only if they pass the filters in 5.1. They can feed plan-review mode.

### 4.3 API calls, per project

Through the awesome-copilot GitLab client (D3):

| Call | Used for |
|---|---|
| `GET /projects/:id/merge_requests?state=merged` and `?state=opened` | list the candidate MRs (paginated, `updated_after` on later runs) |
| `GET .../merge_requests/:iid/approvals` | approval state of open MRs |
| `GET .../merge_requests/:iid/discussions` | threads, notes, `position`, `resolved` |
| `GET .../merge_requests/:iid/versions` | `diff_refs` of each version, to find the code a comment was on |
| `GET .../merge_requests/:iid/diffs` | the diff hunks |
| `GET .../merge_requests/:iid/commits` | commits after a comment, to find whether it led to a change |

### 4.4 How it runs

- Token in an environment variable (`GITLAB_TOKEN`), scope `read_api` only.
  Never written to disk or logs.
- Configuration in one small file: GitLab host, list of projects or groups,
  how far back to go (`since`), bot accounts to ignore.
- Every response is cached under `raw/<project>/<mr_iid>/`. A rerun reads the
  cache, and only asks GitLab for MRs updated since the last run
  (`state.json` holds the last sync date per project).
- Respects GitLab's rate limit headers and backs off on `429`.
- Prints a summary at the end: MRs scanned, MRs kept, threads kept, by
  project.

## 5. Stage 2: filter and store

### 5.1 Filters (script, no AI)

A thread is **dropped** when:
- its first note is approval chatter: `LGTM`, `+1`, `👍`, `nice`, `thanks`, or
  shorter than a configurable minimum (default 15 characters after removing
  code and links);
- it is a diff thread on a file forseti doesn't review (anything other than
  `*.java`; the list is configurable);
- it is a near-duplicate of a thread already kept on the same MR (same
  file, same normalized text).

A thread is **kept but marked** with:
- `addressed: true` when a later commit in the same MR changed the lines the
  comment points at (from `position` + `versions` + `commits`), or the thread
  was resolved and the author replied with a change. This is the strongest
  sign the comment was valid, and stage 3 favors these threads.
- `addressed: false` otherwise. Not dropped: a resolved thread with no code
  change can still be a valid "don't do this next time".

### 5.2 Cleaning

- Code context trimmed to about 10 lines around the commented lines.
- Comment text: GitLab markup removed, quoted earlier replies removed.
- Scrubbed: e-mail addresses, URLs to internal hosts, anything that looks
  like a token or a password. Reviewer and author names are replaced by a
  stable alias (`reviewer-07`), with the mapping kept only in `raw/`.

### 5.3 Data layout

The data lives in the service repo being reviewed, next to forseti's own
reports, and is gitignored (D7):

```
.copilot/muninn/
  config.json            host, projects, since, bot list, filters
  state.json             last sync date per project
  raw/                   cached GitLab responses (never shared)
  threads.jsonl          one review thread per line, the main data
  by-path/
    src__main__java__com__acme__payment__RefundService.java.jsonl
  index.json             counts per file, folder, category; last sync date
  labels.jsonl           stage 3 output, one line per thread id
  rules/
    candidates.md        stage 4 output
    reconcile.md         stage 4 output, compared with forseti
```

`by-path/` holds the same threads as `threads.jsonl`, split by file. The file
name is the repo-relative path with `/` replaced by `__`. This lets forseti
find a file's history by opening one file, with no grep: forseti was made
portable to Copilot by dropping Unix-only grep instructions, and this keeps
it that way.

### 5.4 Record format (one line of `threads.jsonl`)

```json
{
  "id": "acme-payments!412#d81f",
  "project": "acme/payments",
  "mr_iid": 412,
  "mr_title": "Refund partial captures",
  "mr_state": "merged",
  "merged_at": "2026-03-04",
  "kind": "diff",
  "file_path": "src/main/java/com/acme/payment/RefundService.java",
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
taken from the package path, so examples and rules line up with forseti's
checklists.

## 6. Stage 3: label threads (Copilot CLI)

Each thread gets a short label, written to `labels.jsonl`:

```json
{"id": "acme-payments!412#d81f", "keep": true, "category": "error-handling",
 "forseti_check": "spring-boot3-practices", "severity": "CRITICAL",
 "rule": "Never swallow an outbound gateway failure; surface it as a domain error."}
```

- `keep`: false when the comment only matters for that one MR (a typo, a
  question, a product decision).
- `category`: from a fixed list (boundary, naming, java-idioms, spring,
  tests, comments, error-handling, security, performance, other), so stage 4
  can group without AI.
- `forseti_check`: the forseti reference file the comment fits, or `none`.
- `severity`: proposed, on forseti's scale (CRITICAL / IMPORTANT /
  RECOMMENDED). A person confirms it in stage 5.
- `rule`: a one-line rule of 15 words or fewer.

How it runs:
- A script builds batches of 20–50 threads. It sends only `id`, `file_path`,
  `layer`, `code`, `comment`, the first reply and `fix`, never the whole MR.
- Each batch goes to the Copilot CLI in non-interactive mode with one fixed
  prompt file (`prompts/label.md`) and asks for JSONL back. The exact CLI
  flags (prompt, model choice) are to be checked against the installed
  version.
- The script validates each answer (valid JSON, known category, known
  severity). A batch that fails is retried once, then logged and skipped.
- Thread ids already in `labels.jsonl` are never sent again.
- `--dry-run` prints the number of batches and estimated tokens (characters
  ÷ 4) without calling anything. `--max-threads N` caps a run.

## 7. Stage 4: distill rules and reconcile with forseti

### 7.1 Group (script, no AI)

Keep labels with `keep: true`. Group them by `forseti_check` + `category` +
top-level package. Inside a group, count threads, count distinct MRs and
reviewers, and count how many were `addressed`. Groups backed by fewer than 3
MRs are listed separately as "seen once or twice" and don't become rules.

### 7.2 Write rules (Copilot CLI)

One call per group. The input is the group's one-line rules plus 2 example
threads (the shortest addressed ones). Raw threads are not sent. The output
is written in forseti's checklist format, so an approved rule can be pasted
in as is:

```markdown
## Check T7 — Surface outbound gateway failures

**Rule**: an adapter calling an external gateway never swallows a failure; it
rethrows it as a domain error the use case can handle.

**Flag (Critical)**: a `catch` around a gateway client call that logs and
continues, or returns `null`/`Optional.empty()`.

**Evidence**: 9 threads on 7 MRs, 4 reviewers, 8 addressed. Last seen
2026-08-19. Examples: acme/payments!412, acme/payments!455.

**Before / after**: <the trimmed code and fix from one example>

**Finding template**: `<call> swallows the <gateway> failure; rethrow it as
<DomainError> so the caller knows the operation failed.`
```

### 7.3 Reconcile with forseti's existing rules

The Copilot CLI gets the candidate rules and forseti's reference files
(`hexagonal-boundary-checklist.md`, `naming-checklist.md`,
`java21-modern-idioms.md`, `spring-boot3-practices.md`,
`test-quality-checklist.md`, `no-comments-policy.md`). It puts every rule in
one bucket in `rules/reconcile.md`:

| Bucket | Meaning | Default action |
|---|---|---|
| **Confirmed** | forseti already has this rule, and reviewers enforce it. | Add the evidence count to the existing check. No new rule. |
| **New** | reviewers enforce it, forseti doesn't have it. | Proposed as a new `T` check. |
| **Conflict** | reviewers ask for the opposite of a forseti rule. | Flagged for a person. Never applied automatically. |
| **Unused** | a forseti rule no reviewer ever raised. | Reported only. Nothing removed: absence of comments may mean the rule already works. |

## 8. Stage 5: approve

A person reads `rules/reconcile.md` and accepts or rejects each New and
Conflict entry. Accepted rules go into
`skills/forseti/references/team-review-rules.md`. That file and the evidence
counts are the only outputs committed to git. Rejected rules are recorded in
`rules/rejected.md` so they aren't proposed again on the next run.

If the team works on several services with different conventions, the rules
can instead go into the service repo
(`.copilot/muninn/team-review-rules.md`, committed). Which one is open
(section 12).

## 9. How forseti uses it

Two changes to `skills/forseti/SKILL.md`:

1. **A new checklist step**, after step 5 (test quality) and before the
   zero-comments policy: walk `references/team-review-rules.md` like any
   other checklist. Same severity scale, same evidence rule, same report
   structure. A finding cites the `T` check it breaks.
2. **Past examples, optional.** If `.copilot/muninn/by-path/` exists in the
   reviewed repo, then for each file in the review scope, open its
   `by-path/` file and read at most the 3 most recent addressed threads. If a
   past comment applies to the current code, report it under the matching
   check, and cite the past MR as supporting evidence. If the folder doesn't
   exist, skip this without comment: forseti keeps working the same way
   without the memory.

The self-check at the end of forseti's workflow applies unchanged: a past
reviewer comment is evidence, not a rule by itself. If it doesn't apply to
the current code, it isn't reported.

Plan-review mode uses the team rules the same way. It reads past examples
only from general threads (`kind: general`) in `threads.jsonl`, at most 3,
chosen by the plan's packages.

## 10. Token budget

| Where | Cost | How it's kept down |
|---|---|---|
| Stages 1–2 | 0 | Plain scripts (D5). |
| Stage 3, labeling | one-time, the largest | Filters first (5.1), short records (about 200–400 tokens each), batches of 20–50, cheapest Copilot model, nothing labeled twice, `--dry-run` estimate first. |
| Stage 4, rules | one-time, small | Grouped by script first. AI sees one-line rules and 2 examples per group, never raw threads. One reconcile call over the rules list. |
| Each review | recurring, the one that matters | Team rules file kept short (target: under 2k tokens). At most 3 past threads per file in scope, already trimmed. `threads.jsonl` is never loaded in full. |

Rough scale: 2,000 threads after filtering × about 350 tokens is roughly
700k input tokens for labeling, once. Later runs only label new threads.

The first run is a pilot: `--max-threads 100`, then compare the measured
usage with the estimate before labeling everything.

## 11. Checking that it works

- **Replay:** hold back the 20–30 most recent MRs that have reviewer threads.
  Run forseti on each MR's first version with and without the memory.
  Measure:
  - how many of the human reviewers' comments forseti also raised (recall),
  - how many of forseti's findings a reviewer would accept (precision).
- **Size watch:** if the team rules file grows past its target, merge or
  drop the weakest rules rather than raising the target.
- **Refresh:** rerun stages 1–4 on a schedule (for example monthly). Rules
  whose evidence stops growing for a long time are proposed for removal in
  `reconcile.md`.

## 12. Open questions

1. **The awesome-copilot GitLab client:** which repo exactly (owner/name),
   what language, and what it already covers (pagination, rate limits,
   discussions, versions).
2. **Scope of the pull:** GitLab host, which groups or projects, and how far
   back.
3. **Language of the scripts:** follows the awesome-copilot client. If it's
   Node, the scripts are Node 18+ with no packages; if Python, standard library
   only.
4. **Copilot CLI:** the version installed, its non-interactive flags, and
   which models are available for the cheap labeling pass.
5. **Where approved rules live:** in forseti (shared by all services) or in
   each service repo, or both (shared base plus service-specific rules).
6. **Name:** `muninn`, or another name.

## 13. Staged plan

| Stage | Delivers | Done when |
|---|---|---|
| A | Pull + filter + store scripts (stages 1–2) | The user runs it on one project and gets `threads.jsonl`, `by-path/`, and a summary of what was kept. |
| B | Labeling (stage 3), pilot | 100 threads labeled; measured token usage compared with the estimate. |
| C | Full labeling, distill and reconcile (stage 4) | `rules/candidates.md` and `rules/reconcile.md` produced for one project. |
| D | Approval and forseti integration (stage 5, section 9) | `team-review-rules.md` committed, forseti `SKILL.md` updated, replay (section 11) run once. |
