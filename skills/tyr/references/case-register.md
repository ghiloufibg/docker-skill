# Case register

`SKILL.md` step 2 points here. The user's test cases become a numbered
register before anything else is designed.

## Entry per case

```
T1  <short title>
  User wording: "<verbatim>"
  Requirement:  <what the service must do, restated>
  Trigger:      <inbound call, consumed message or schedule, with the shape>
  Expected:     <the observable outcome>
  Source:       [U1]
```

## Observable outcomes

An outcome is observable if someone outside the service can see it:

- an API response (status, headers, body fields)
- stored state read back through the public API
- stored state read by a read-only query, only when the API does not expose it
- a message on an output topic or queue
- an outbound call received by a mock and verified (isolation)
- an email in a test inbox, an object in a bucket, a record in a search index
- a log line, only when the requirement itself is about logging

A case that names none of these ("works correctly", "handles errors well", "is
fast") is a doubt: propose a testable criterion and ask for it at the gate. If
the user gives several cases in one sentence, split them; one `T#` has one
trigger and one outcome.

## Rules

- Keep the user's wording verbatim; restate beside it, never instead of it.
- Do not add cases. Gaps you notice (an error path nobody listed) go in the
  plan's risks as "not covered", and are offered to the user as a suggestion at
  the gate, never added silently.
- Negative cases ("rejects an expired token") are ordinary cases.
- Cases that cannot run in the chosen mode are tagged, not removed
  (`references/modes.md`).
- Raw requirements text with no list of cases: propose a numbered list of
  cases derived from it, and confirm it with the user as a single question at
  the gate.
