# Presentation, validation and saving

`SKILL.md` step 8 points here. The plan is shown, revised with the user, and
only then saved. `validate` is the user's go-ahead to execute.

## Locations

- Plan: `./.copilot/docs/qa/<service>-<slug>-test-plan.md`
- Report: `./.copilot/docs/qa/<service>-<slug>-test-report.md`

Create the folder if it is missing. If the plan file exists, show its status and
ask: resume, revise (overwrite) or new name.

## Normal path (plan is not large)

Three blocks, in this order. Only the second is saved.

1. **Review header** (not saved): service, mode, target, status, the path, and
   counts: cases (by class), dependencies, containers to start, unit tests to
   write, assumptions, open questions, side-effecting cases (remote).
2. **The plan**: the whole document per `plan-template.md`, section by section.
   Do not summarise or elide sections. If it must be split across messages,
   label the parts ("part 1 of 2").
3. **Review panel** (not saved): what needs attention (accepted assumptions,
   contingent cases, missing images, side-effecting cases), then the options:

```
Review options
  validate        save as Validated and run the plan (live checks,
                  unit tests, report)
  save            write the plan only; nothing runs
  change <what>   e.g. change T3: classify as LIVE
  path <p>        save somewhere else
  show <section>  reprint one section
  discard         end without saving
```

Write the file only on `validate`, `save`, or a clear yes to "Save to <path>?".
Praise ("looks good") is not confirmation; ask once. Never save partway through
review. `discard`, or the session ending, writes nothing.

## Large path

The normal path is unreadable for a very large plan. **Large** means more than
12 test cases or more than about 400 lines of markdown, whichever comes first.

Write the plan straight to the output location with `Status: DRAFT — not yet
validated` as the first line after the front matter and `status: Draft (not
validated)` in it. The console then shows: the path, a summary (cases by class,
dependencies, containers, unit tests, assumptions, open questions), and the
options:

```
  validate   flip the status to Validated and run the plan
  change     edit the draft
  discard    delete the draft this run wrote (after confirming)
```

The skill never removes the DRAFT marker, and never executes, without an explicit
`validate`. The header records which path was used and why.

## Handling change requests

A change is a user decision. Apply the smallest edit that satisfies it, then keep
the document consistent: cases, triage, citations, the traceability matrix,
the execution contract, the status.

- A change to class or tag re-runs the triage rules for that case and updates
  sections 7 to 12 and 14.
- A change that alters a dependency route re-checks the images (preconditions).
- If a change contradicts a source, say so and apply it only if the user confirms;
  record it as a `[U#]` entry marked "review", with the date.
- Number revisions (r1, r2, ...). Reprint a short revision log and the changed
  sections in full; `show all` reprints everything. There is no cap on review
  rounds.
- Re-run the self-check at the end of `SKILL.md` on the changed sections.

## Validate

On `validate`:

1. State the path and revision, and confirm the status will be `Validated`.
2. Write the plan (or flip the draft's status). If the status is `Blocked on
   questions`, refuse: that plan cannot be validated.
3. Cases that are `Contingent` are not executed; say so.
4. Hand over to the execute phase (`execution.md`).

## Non-interactive runs

Print the plan and write nothing, run nothing, unless the invocation explicitly
asks to save (and, separately, to validate). A large plan is written as DRAFT
only on that same explicit instruction.
