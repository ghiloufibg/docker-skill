# Execute phase

`SKILL.md` step 9 points here. Runs only for a plan whose status is
`Validated`, and does only what its execution contract (section 14) lists.
Contingent cases are skipped. Anything the plan does not list is not done.

## 0. Before anything starts

1. **Re-check preflight.** The mode and target; images still present
   (`docker image ls`); Docker and Compose reachable (isolation), or the
   environment gate again (remote: `gcloud auth list`, `kubectl config
   current-context`, class dev/rec). If anything differs from the plan, stop and
   report the difference. Never start on a stale plan, and never switch a
   context.
2. **Create the run identity** (`environment-design.md`) and the working folder.
3. **Keep an evidence log** and a cleanup list as you go: every container,
   network, volume, process, port-forward and, in remote mode, every created
   record, is added to the cleanup list at the moment it is created.

## 1. Bring up the environment

**Isolation**

1. Generate the Compose file from the plan into the working folder, and the
   stubs, seeds and scripts it lists.
2. `docker compose -p tyr-<service>-<run-id> up -d`; wait for every health check
   (bounded; on timeout, report the container logs and stop).
3. Initialise each dependency (schemas, topics, buckets, realms) per its profile.
4. Start the service with the override variables, log to the working folder, and
   wait for readiness (bounded).

**Remote**

1. Reach the service: the ingress URL, or `kubectl port-forward` on a free local
   port. Add the port-forward to the cleanup list.
2. Obtain any needed credentials by decrypting with `sops` to standard output
   into the checking process's environment only. Never to disk or a log.
3. Confirm the service is reachable (a health or a first read-only call).

If this step fails, every case is `BLOCKED` with the reason; go to teardown and
the report.

## 2. Run the LIVE cases

In plan order, one at a time:

1. **Reset** the dependencies the case touches (profile reset), then **seed**
   and **stub** per the plan (isolation), or create the case's data through the
   API with the run marker (remote).
2. **Trigger** exactly as the plan says.
3. **Assert** on the expected outcome, then **verify** mocks, messages, mail or
   storage per the profile. In isolation read WireMock's unmatched requests: any
   unmatched request is a failure signal.
4. **Capture evidence**: request, response (status, relevant headers and
   fields), the service log lines for the case window, and the verification
   results. Keep it small.
5. **Clean up** the case's data (remote) and record the result: `PASS` or
   `FAIL`.

A case whose precondition cannot be met is `BLOCKED` with the reason. A case not
reached (interruption) is `NOT RUN`.

## 3. Write and run the UNIT tests

1. Write each file at the proposed path, copying the neighbours' conventions
   (`unit-test-conventions.md`). Do not touch production code.
2. Check statically that no new file imports Testcontainers, a Spring test slice,
   `java.net` or JDBC.
3. Run the new test class(es) with the repo's build tool (wrapper if present;
   `.cmd` on Windows), then the module's unit suite. Capture the summary.
4. Leave the files unstaged. Never run `git add` or `git commit`.

A failing unit test follows section 4.

## 4. Diagnose failures

For every `FAIL`, apply `bug-triage.md`:

- Re-run a failing `LIVE` case once to rule out flakiness. A different result
  the second time is recorded as flaky, with both outcomes.
- Classify: service bug, test defect, environment problem, or unclear
  requirement.
- A test defect or environment problem may be corrected (the stub, the seed, the
  script, the timeout, the unit test) and the case re-run, at most twice per
  case. An assertion is never weakened or removed to get a pass.
- A service bug is recorded with its evidence. The case stays `FAIL`. The
  service is never edited.

## 5. Tear down (always)

Runs after success, failure or interruption, in this order:

1. Stop the service process, and any port-forward.
2. Remote: delete the data still on the cleanup list through the API, in reverse
   order of creation; retry once.
3. Isolation: `docker compose -p <project> down -v --remove-orphans`, then the
   label sweep (`tyr.run=<run-id>`) for containers, networks and volumes.
4. Verify nothing labelled with the run id remains.
5. Anything that could not be removed goes to the report with the exact command
   to remove it.

The working folder is kept, so the user can inspect the evidence; the report says
where it is and that it is ephemeral.

## 6. Hand over to the report

Write the report (`report-template.md`) from the evidence log. If the run was
interrupted, still write it from what was captured, marking unfinished cases
`NOT RUN`.
