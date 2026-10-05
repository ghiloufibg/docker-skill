# Report template

`SKILL.md` step 10 points here. Written to
`./.copilot/docs/qa/<service>-<slug>-test-report.md` and printed in the console
after teardown. It states what happened, with evidence, and nothing the run did
not establish.

## Front matter

```
---
plan-id: <service>-<slug>
plan-revision: r2
run-id: <run-id>
mode: isolation | remote
target: <environment, remote only>
date: <date>
verdict: <see below>
---
```

## Sections

1. **Summary**: mode, environment, plan id and revision, date, totals (`PASS`,
   `FAIL`, `BLOCKED`, `NOT RUN`), number of bugs by severity, verdict.

   Verdict, in plain words:
   - `All cases passed` (and every case has a result)
   - `Bugs found` (n)
   - `Incomplete` (cases `BLOCKED` or `NOT RUN`; say which and why)
   - `Failed to run` (the environment could not be brought up)

   Never call a run complete while a case is `BLOCKED` or `NOT RUN`.

2. **Coverage check**: every `T#` of the plan with its class, mode tag and
   result. Cases tagged for the other mode appear as "not run in this mode". The
   check passes only when every case in scope has a result.

   ```
   | T#  | Title           | Class | Result   | Bug |
   | T1  | Create order    | LIVE  | PASS     |     |
   | T2  | Partner timeout | LIVE  | FAIL     | B1  |
   | T3  | Rounding rule   | UNIT  | PASS     |     |
   | T4  | Refund to card  | LIVE  | BLOCKED  |     |   <- reason in section 3
   ```

3. **Results per case**: result and evidence (trimmed). For `BLOCKED` and `NOT
   RUN`, the reason. For `UNIT` cases, the test class, method and run result.
   Flaky cases show both outcomes.

4. **Bugs found**: one entry per bug in the format of `bug-triage.md`, ordered
   by severity. If there are none, say so in one line.

5. **Other findings (not bugs)**: unclear or contradictory requirements, test
   defects corrected along the way (and what was changed), environment problems,
   assumptions that proved wrong, differences between isolation and remote,
   dependencies that fell back to a mock or were disabled.

6. **Unit tests written**: path, what each covers, and the result of the new
   tests and of the module's unit suite. State that the files are unstaged and
   uncommitted. Flag any that fail on purpose because they expose a bug.

7. **Cleanup**: what was torn down, confirmation that nothing labelled with the
   run id remains, and anything left behind with the exact command to remove it.
   The working folder path (ephemeral, kept for inspection).

8. **Residual risks and limits**: what these tests do not prove (stubs not from
   a spec, emulator coverage, shared-environment effects, cases not run in this
   mode), and suggested next steps (cases to add, a remote run to complete an
   isolation run, or the reverse).

## Console summary

After writing the file, print a short summary: verdict, totals, the bug list
(id, severity, title), unit-test paths, and the report path. Do not stage or
commit anything; remind the user that the unit tests and the report are
working-tree files for them to review and commit if they find them useful.

## Honesty rules

- State what failed and what could not run, with the output that shows it.
- No bug without evidence; label suspicion as suspicion.
- A skipped step is reported as skipped, with the reason.
- Do not describe a run as successful if any case in scope lacks a passing
  result.
