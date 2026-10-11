# Review memory scripts

Build a memory of real reviewer feedback from past GitLab merge requests, so
`forseti` can calibrate its findings and apply your team's own rules. Python 3,
standard library only: nothing to install.

The scripts never call an AI. They prepare prompt files; you run them in
Copilot CLI and save the answers; the scripts validate the answers and continue.

Run every command from this folder (`skills/forseti/scripts/review-memory/`).
Output goes to `skills/forseti/memory/`, which is gitignored: it holds team
review data, never commit it.

## 1. Setup

Create `~/.copilot/tools/.env` (the same file the supercopilot GitLab tool uses):

```
GITLAB_BASE_URL=https://gitlab.yourcompany.com
GITLAB_API_TOKEN=<personal access token, scope read_api>
```

Environment variables with the same names win over the file. Projects on a
different host need their own token, named after the host:
`GITLAB_API_TOKEN_GITLAB_OTHER_COM` for `gitlab.other.com`.

## 2. Fetch the merge requests

```
python fetch_mrs.py --projects https://gitlab.yourcompany.com/team-a/order-service,https://gitlab.yourcompany.com/team-b/catalog-service --max-mrs 20
```

Start small (`--max-mrs 20`), check the output, then raise it.

To avoid typing the URLs, edit `PROJECT_URLS` and `MAX_MRS_PER_PROJECT` at the
top of `fetch_mrs.py`, or put one URL per line in a file and pass
`--projects-file urls.txt`.

| Option | Meaning |
|---|---|
| `--projects URL[,URL...]` | project URLs as copied from the browser |
| `--projects-file PATH` | one URL per line; lines starting with `#` are ignored |
| `--max-mrs N` | reviewed MRs to keep per project (default 200); MRs without review threads don't count |
| `--since YYYY-MM-DD` | ignore MRs last updated before this date |
| `--max-parallel N` | cap on threads (default: one per project) |
| `--output PATH` | memory folder (default `skills/forseti/memory`) |

Kept MRs are merged ones, plus open ones that are approved when your GitLab
has the approvals API (Premium/Ultimate). Only Java files and MR-level comments
are kept. Rerunning is cheap: unchanged MRs are read from `memory/raw/`.

Result: `memory/projects/<project>/threads.jsonl` (all threads),
`memory/by-path/` (threads per Java file), `manifest.json`, `README.md`. Exit
code 1 means at least one project failed; the others are still written.

## 3. Label the threads

```
python label.py prepare --max-threads 100
```

This writes `memory/prompts/label-001.md`, `label-002.md`, ... and prints the
estimated tokens. The first run is a pilot: 100 threads.

For each prompt file, run it in Copilot CLI and save the answer as the matching
file in `memory/answers/`: `prompts/label-001.md` gives `answers/label-001.jsonl`.
The answer must be one JSON line per thread; code fences around it are fine.

```
python label.py ingest
```

It validates each line, appends the good ones to `memory/labels.jsonl`, rebuilds
`memory/by-check/`, and lists the rejected lines with the reason. Rejected
threads stay unlabeled: run `python label.py prepare` again and it writes prompts
for just those, and for any threads not yet labeled. Repeat until it says
`Nothing to label`.

`--batch-size N` sets threads per prompt (20-50, default 30).

## 4. Write the rules

```
python distill.py prepare
```

It groups the labels and writes `memory/prompts/rules-<group>.md`, one per group
backed by at least 3 merge requests. Run each in Copilot CLI and save the
answer as `memory/answers/rules-<group>.md` (same `<group>` as the prompt).

```
python distill.py ingest
```

It checks each answer, adds the evidence line and a stable `T` number, and
writes `memory/rules/candidates.md`. It then writes `memory/prompts/reconcile.md`
(candidates compared with forseti's current checklists). Run it in Copilot CLI,
save the answer as `memory/answers/reconcile.md`, and run
`python distill.py ingest` once more to get `memory/rules/reconcile.md`.

## 5. Approve

Read `memory/rules/reconcile.md`. Paste the checks you accept from
`memory/rules/candidates.md` into `skills/forseti/references/team-review-rules.md`
and commit that file only.

To reject a rule for good, add its `Group:` key in backticks (for example
`` `spring-boot3|error-handling|adapter` ``) on a line in `memory/rules/rejected.md`.
It is never proposed again.

## Refreshing

Rerun steps 2-4 (monthly is reasonable). Only new threads are labeled, and
existing `T` numbers don't change.

## Troubleshooting

| Message | Cause |
|---|---|
| `project URLs still use the gitlab.example.com placeholder` | pass `--projects` or edit `PROJECT_URLS` |
| `no token for host ...` | the URL's host differs from `GITLAB_BASE_URL`; add `GITLAB_API_TOKEN_<HOST>` |
| `responded 401` | token missing, expired or wrong scope |
| `responded 403/404` on a project | no access, or the URL is wrong; other projects still run |
| `approvals API unavailable: only merged MRs were kept` | your GitLab has no approvals API; expected on Community Edition |
| `scan limit reached` | the project has few reviewed MRs; only 10 times `--max-mrs` were scanned |
| `unknown category` / `unknown forseti_check` / `longer than 15 words` | the AI answer broke the format; rerun `label.py prepare` for those threads |
| `names the project ...` | a generated rule mentions a project; rerun that prompt and ask for a general rule |
| `missing sections ...` | `reconcile.md` needs all four sections: Confirmed, New, Conflict, Unused |

## Tests

```
python -m unittest discover -s tests
```

They run against a fake GitLab server and need no network or token.
