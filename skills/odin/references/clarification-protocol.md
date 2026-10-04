# Clarification protocol — the open-question gate

`SKILL.md` steps 4–6 and the gate point here. The gate runs once, after the
first reading pass (steps 1–5) and before `mimir` is invoked.

## What counts as open

A question is **open** if the requirements source, the Confluence cards and the code
could not answer it. Questions answered from a source are resolved, with
their citation, and are not asked.

Each open question carries:

- the question, and the requirement(s) it affects (`R#`)
- what was searched, so the user knows it wasn't skipped
- **blocking** or **non-blocking**
- 2–3 options, one marked as the recommended default (every question has
  one, so "accept" is always possible)

**Blocking** = it would change the domain shape, the scope, or an external
contract, or two acceptance criteria conflict. Everything else is
non-blocking.

## The batch

If nothing is open, say so in one line and continue.

Otherwise present everything in **one batch**, blocking first:

```
Before I design this, <N> questions are still open after reading <source>,
<n> Confluence pages and <module>.

BLOCKING
Q1 (R2) <question>
    Searched: <where>: no answer.
    a) <option>  [recommended: <reason>]
    b) <option>
NON-BLOCKING
Q2 (R4) <question>
    a) <option>  [recommended: <reason>]  b) Other: ___

Reply per question, or: "defaults" (accept every recommendation),
"defer Q1" (leave it open), or "stop" (show the partial plan, no design).
```

If there are more than about 8, ask the blocking ones first and show the
rest as proposed assumptions for approval in bulk.

## The user's options

Per question: answer it, accept the default, or defer it. Globally:
`defaults` or `stop`.

- **Deferring a blocking question** needs explicit confirmation. Warn that
  the affected design will be contingent and flagged as such in the plan.
- **Deferring a non-blocking question** needs no warning; it is recorded as
  an open item.
- **A stakeholder is needed**: offer to draft the question as text for the
  user to send (a Jira comment in ticket mode, a message in raw mode). Never
  post or send it. Then the user normally chooses `stop`.
- **Raw mode: criteria confirmation.** Where requirements have no written
  acceptance criteria, ask them as one grouped, non-blocking question: the
  proposed criterion per requirement, with `defaults` meaning "accept all".

## Rounds

After the answers, re-check: answers can invalidate a requirement or raise
new doubts. If new questions appear, run **one more round**, same format.
Two rounds in total. After that, anything still open can only be deferred
or default-accepted by the user's explicit choice — do not ask again.

## Recording

Every answer becomes a `[U#]` entry: the question, the answer or decision
(answered, default accepted, deferred), the gate round, and the date. Every
accepted default also becomes an assumption `A#` with the risk if it is
wrong. Plan section 4 records the **gate outcome**: how many questions were
answered, accepted by default, or deferred, and in which round.

## Stop and resume

- **Stop**: produce the partial plan — sections 1–4 plus the Resources
  appendix (requirements understanding, requirements, Confluence context,
  clarifications) with
  status `Blocked on questions` — and present it in the console like any
  plan (`plan-presentation.md`). There is no architecture section; it is not
  an implementation plan. Offer to save it, and say that resuming later
  reads the saved file, so an unsaved partial plan loses the recorded
  answers. Save only on confirmation; if the file exists, ask before
  overwriting.
- **Resume**: find the saved plan by, in order: a path the user names; the
  `Plan id` (ticket key or slug) in the headers of the files under the plan
  folder (`docs/plans/` by default), not just the file name, so renaming the
  file doesn't break it; then, in raw mode, a plan whose verbatim `[P1]`
  matches the requirements the user supplies now. If several match, ask
  which. When found, read its section 4 and reuse the recorded `[U#]`
  answers. Never ask for answers that are already recorded. In ticket mode, re-fetch
  the ticket; a ticket updated after the plan's recorded timestamp may
  invalidate earlier answers — say so. In raw mode, ask the user to supply
  the requirements again or confirm they are unchanged, and treat any
  difference from the verbatim `[P1]` in section 2 as a change. Then ask
  only about what is still open or has changed.

## Non-interactive runs

If there is no way to prompt the user (scripted or headless), do not
generate a full plan. Print the `Blocked on questions` partial plan and
stop; write no file unless the invocation explicitly asks to save. The only way to skip the gate is the invocation explicitly saying to
proceed with defaults; then record every default as an assumption and set
the status to `Draft (assumptions accepted)`.

## Questions raised during design

`mimir` and the `forseti` pass never prompt the user. A doubt they surface
that would change the domain shape returns to the gate once. Smaller doubts
are recorded as assumptions marked "raised during design" and listed in the
delivery summary.
