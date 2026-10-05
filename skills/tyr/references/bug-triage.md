# Bug triage

`execution.md` section 4 points here. A failing case is diagnosed before it is
reported. The aim is to report real bugs in the service and not blame the
service for the harness, or the harness for the service.

## Classes of failure

| Class | Meaning | Action |
|---|---|---|
| **Service bug** | the service's behavior violates the requirement the case states | report it; case stays `FAIL` |
| **Test defect** | the case, stub, seed, script, timeout or unit test is wrong | correct it, re-run (max 2 corrections) |
| **Environment problem** | a container, port, credential, network path, cluster or quota problem | fix the environment if it is ours (a health wait, a port), else `BLOCKED` |
| **Unclear requirement** | the requirement admits more than one reading or contradicts another | report as a finding, not a bug; keep the case `FAIL` or `BLOCKED` as appropriate, ask the user |

## How to decide

1. **Reproduce.** Re-run the case once. Same result: continue. Different result:
   flaky; record both outcomes and the likely cause (timing, ordering, shared
   state in dev/rec).
2. **Check the harness first.** Did the stubs load (`/__admin/mappings`)? Were
   the seeds applied? Did the service start with the override variables? Is the
   assertion the one the requirement states? Was the data the case expected
   present, and was the run marker applied (remote)? Any unmatched request?
3. **Read the evidence.** Service logs around the case window, the response, and
   mock/broker verification. An error in the service log with a stack trace is
   strong evidence; a 4xx for an input the requirement says is valid is evidence
   of a bug; a timeout with no log may be the environment.
4. **Compare with the requirement, not with what seems nice.** The case's
   expected outcome came from the user. If the observed behavior is reasonable
   but differs, it is an unclear requirement or a bug, not a test defect: say
   which and why.
5. **Check the code only to locate**, never to decide. Reading the code can
   point at the suspected area; the verdict rests on observed behavior.

## Severity

By impact on the requirement and the user, not by effort to find or fix:

| Severity | Meaning |
|---|---|
| blocker | a core requirement fails, or data is lost or corrupted, or a security control is bypassed |
| major | a requirement fails for a realistic input, no workaround |
| minor | a requirement fails for an edge case, or a workaround exists |
| trivial | cosmetic or wording differences in a response, no functional impact |

## Bug entry

```
B1  <short title>  [severity]  [confidence: high | medium | low]
  Cases:        T2, T5
  Requirement:  <the requirement violated> [U1]
  Expected:     <from the case>
  Actual:       <observed>
  Reproduce:    1. <step with the exact request / message / stub>   (PowerShell
                and shell forms where they differ)
  Evidence:     <response, log lines, mock verification>  (trimmed; no secrets)
  Suspected area: <file or class>, labelled "suspected" and why  [F#]
  Notes:        flaky? only in isolation? only in remote?
```

Rules:

- A bug needs evidence from the run. No evidence, no bug: it is a finding.
- Suspicion is labelled as suspicion. The confidence level reflects how
  reproducible and how clearly attributable the failure is.
- A bug seen in only one mode is reported with the mode; a difference between
  isolation and remote is itself a finding (configuration or contract drift).
- Group duplicate failures with one root cause under one bug.
- Do not include secrets, tokens or personal data in evidence.
- Never fix the bug, edit the service, or weaken the assertion.

## Unit-test failures

A failing unit test is the same question: is the test wrong, or does the class
violate the requirement? If the class is wrong, keep the test as written (the
user can see it fail), report the bug with the test class and method as the
reproduction, and mention that the test is failing in the unit-tests section of
the report so the user does not commit a red test by accident.
