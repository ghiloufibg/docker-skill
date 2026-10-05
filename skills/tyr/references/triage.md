# Triage: live check, unit test or not testable

`SKILL.md` step 3 points here. Every case gets one class and one mode tag. The
table is confirmed by the user at the gate, and the user can move a case.

## Classes

| Class | Use when | Output |
|---|---|---|
| `LIVE` | the default. The case can be validated by calling the running service and observing the outcome | live-check steps, ephemeral |
| `UNIT` | isolation mode only, and only when a live check cannot reach the path even with the containers and mocks | a designed JUnit unit test, left uncommitted for the user |
| `NOT-TESTABLE` | neither is possible from outside as specified | a doubt: change the case, expose a hook, or drop it |

## Decision procedure

For each case, in this order:

1. Can a request, message or schedule trigger it and an outcome be observed from
   outside? Then it is `LIVE`. In isolation mode the local containers make
   these reachable by a live check: a stubbed 500 or timeout from a partner, a
   malformed response, a seeded database row, a message on a topic, an empty
   result, a duplicate delivery.
2. If not, is the path inside the service reachable by no external input?
   Examples: a defensive branch that cannot be triggered from outside, a rule
   with too many input permutations to run by hand, logic that depends on the
   clock or on concurrency, a mapping between two internal models. In
   isolation mode and testable without infrastructure, it is `UNIT`.
3. If the path would need infrastructure to exercise (a database, a broker, a
   Spring context, the network), it is not a unit test. If a live check can
   reach it, it is `LIVE`; otherwise it is `NOT-TESTABLE`.
4. In remote mode there is no `UNIT` class. A case that needs failure
   injection is `isolation-only` and is not run in remote mode.

When both a live check and a unit test would work, choose `LIVE`. The unit test
exists only for what a live check cannot reach, and the plan states why.

## Triage table (shown at the gate)

```
| T#  | Title            | Class | Tag            | Why                                  |
| T1  | Create order     | LIVE  | both           | Observable through POST /orders      |
| T2  | Partner timeout  | LIVE  | isolation-only | Needs a stubbed timeout              |
| T3  | Rounding rule    | UNIT  | isolation-only | 40 input combinations, pure function |
```

## Live-check format (per `LIVE` case)

```
T2  Partner timeout -> order stays PENDING
  Mode / tag:   isolation, isolation-only
  Preconditions: stack up; service ready (GET /actuator/health = UP)
  Stubs:        partner POST /v1/charge -> fixedDelay 6000 ms (profile http-wiremock, mapping t2-timeout)
  Seeds:        customer C-100 (relational-db seed t2.sql)
  Steps:        1. POST /orders {customerId: C-100, amount: 40}
                2. wait for the response
  Expect:       201 with status PENDING; no retry beyond 2 attempts
  Verify:       WireMock request count for /v1/charge = 2; GET /orders/{id} = PENDING
  If it fails:  service log lines around "charge" ; WireMock unmatched list
  Cleanup:      reset stubs; truncate orders
```

Give each command in PowerShell and POSIX shell form when they differ. The
steps live in the plan. At execution they may become scripts in
`.copilot/qa-run/<service>-<slug>/`, which stay ephemeral.

## Unit-test candidates

For each `UNIT` case state: why no live check reaches the path, the class under
test, its ports to be replaced by doubles, the inputs, and the expected result.
Details in `unit-test-conventions.md`.
