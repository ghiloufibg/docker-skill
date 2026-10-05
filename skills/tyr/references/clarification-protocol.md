# Clarification protocol: the open-question gate

`SKILL.md` step 5 points here. The gate runs once, after the scan and triage
(steps 1 to 4) and before any design. Nothing is designed on a guess.

## What counts as open

A question is **open** if the user's cases, the code, the config, the manifests
and the specs could not answer it. Questions answered from a source are
resolved with their citation and are not asked.

Each open question carries: the question and the case(s) it affects (`T#`),
what was searched, **blocking** or **non-blocking**, and 2 to 3 options with one
recommended default (so "accept" is always possible).

**Blocking** = it changes what can be tested, redirected or run: a target that
cannot be redirected, a missing schema source, no way into the service, an
unclassified environment, two conflicting expected outcomes. Everything else is
non-blocking.

## Typical doubts

- an external base URL is hard-coded or not overridable (blocking)
- auth to an external API cannot be bypassed or stubbed (blocking)
- a dependency matches nothing in the catalog and the fallback offers more than
  one route; or it has no usable local image; or it is a managed cloud service
  with no emulator
- no schema source (no migrations) or no definition for a message or object
  format; a broker or topic setup unclear (schema registry, serializers, DLT)
- an expected outcome is not observable, or a case is vague
- the triage: a case whose class or tag could not be decided
- (remote) the environment's class is unclear, or the active kubectl context
  differs from the named target
- (remote) no ingress and the Service cannot be port-forwarded
- (remote) a case needs data that exists only in a real dependency and the API
  cannot create it
- the plan's gaps: an obvious error path no case covers (offered as a suggested
  case, never added silently)

## The batch

If nothing is open, say so in one line and continue. Otherwise present
everything in one batch, with the triage table first, blocking questions next:

```
Before I design this, <N> questions are open after reading <n> files and the
service config.

TRIAGE (confirm or move a case)
  <table from triage.md>

BLOCKING
Q1 (T2) <question>
    Searched: <where>: no answer.
    a) <option>  [recommended: <reason>]
    b) <option>
NON-BLOCKING
Q2 (T4) <question>
    a) <option>  [recommended: <reason>]  b) Other: ___

Reply per question, or: "defaults" (accept every recommendation),
"defer Q1" (leave it open), or "stop" (show the partial plan, no design).
```

More than about 8 questions: ask the blocking ones first and show the rest as
proposed assumptions for approval in bulk.

## The user's options

Per question: answer, accept the default, or defer. Globally: `defaults` or
`stop`.

- Deferring a blocking question needs explicit confirmation, with a warning that
  the affected cases become `Contingent`, are flagged, and are not executed.
- Deferring a non-blocking question needs no warning; it is an open item.
- A stakeholder is needed: draft the question as text for the user to send. Never
  send or post it.

## Rounds

After the answers, re-check: answers can change the triage or raise new doubts.
If new questions appear, run one more round, same format. Two rounds in total.
After that anything still open can only be deferred or default-accepted by the
user's explicit choice.

## Recording

Every answer becomes a `[U#]` entry: the question, the decision (answered,
default accepted, deferred), the round and the date. Every accepted default
also becomes an assumption `A#` with the risk if it is wrong. Plan section 4
records the gate outcome: how many were answered, defaulted or deferred, and in
which round.

## Stop and resume

- **Stop**: produce the partial plan (cases, triage, service profile,
  clarifications, resources appendix) with status `Blocked on questions`. Present
  it like any plan. Offer to save it, and say that resuming later reads the saved
  file.
- **Resume**: find the plan by a path the user names, then by `plan-id` in the
  front matter of the files under `.copilot/docs/qa/`. Reuse the recorded `[U#]`
  answers and the case register; never ask again what is recorded. Re-scan, and
  ask only about what changed or is still open.

## Non-interactive runs

With no way to prompt, do not produce a full plan. Print the `Blocked on
questions` partial plan and stop, writing no file unless the invocation
explicitly asks to save. The gate is skipped only when the invocation
explicitly says to proceed with defaults; then every default is recorded as an
assumption and the status is `Draft (assumptions accepted)`. Execution is never
started by a non-interactive run unless the invocation also explicitly says to
validate.
