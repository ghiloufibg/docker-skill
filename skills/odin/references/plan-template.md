# Plan template

`SKILL.md` step 9 says to use this structure. The document below is shown
to the user in full before anything is saved (`plan-presentation.md`); what
they approve is exactly what is written to the file. Fill every section with the
requirements' real content; a section that only repeats generic advice means
the plan isn't finished. Cite sources inline with
`[J#] [P#] [C#] [F#] [U#] [A#]`.

```markdown
# <KEY>: <title> — Technical Implementation Plan
(raw mode has no key: `# <title> — Technical Implementation Plan`)

Plan id: <KEY | slug>
Status: <Ready | Draft (assumptions accepted) | Contingent | Blocked on questions>
Source: <Jira <KEY>, last updated <timestamp> | requirements provided in the prompt>
Generated: <date> · Skills: odin, mimir, forseti

## 1. Requirements Understanding
Goal in one paragraph. Scope in / scope out. Actors. [J#] or [P#]

## 2. Requirements Register
In raw mode, first quote the prompt text verbatim as [P1] (there is no
ticket to open). Then:

| ID | Type | Requirement | Source | Testable |
|----|------|-------------|--------|----------|

## 3. Context from Confluence
Distilled facts per page, cited. Contradictions and stale pages called out.
If nothing relevant was found, say so.

## 4. Clarifications
- **Gate outcome**: <N> asked in round <r>: <a> answered, <b> default accepted,
  <c> deferred.
- **Resolved**: question → answer, with citation [U#]/[J#]/[P#]/[C#]/[F#].
- **Assumptions**: A1… each with the default chosen and the risk if wrong,
  marked "raised during design" where applicable.
- **Open**: deferred questions; blocking ones name the design parts that
  are contingent on them.

## 5. Architecture & Design
Impact on existing code first ([F#]: modules affected, reusable parts,
existing violations not to copy). Then the mimir plan, section by section
(domain model, use cases & ports, application services, adapters, package
layout, testing strategy, concurrency notes if relevant, build/dependency
notes). Sections stay as mimir produced them; its own "Assumptions & Open
Questions" is merged into section 4, not repeated here.

## 6. Design Review
forseti plan-mode findings by severity: fixed in this revision / accepted
with reason / open. Omit empty severities.

## 7. Traceability
| Requirement | Component(s) | Test(s) |
|-------------|--------------|---------|
Every R# appears once; out-of-scope requirements say so and why.

## 8. Implementation Slices
Ordered slices, each: what it delivers, depends on, definition of done.
Small enough to implement and review on its own.

## 9. Risks, Dependencies, Rollout
Risks with the mitigation; external dependencies and who owns them;
migrations, feature flags, Kubernetes or native-image impact where the
design touches them. Omit a subsection the requirements don't touch.

## 10. Resources
(see references/resources-appendix.md)
```

## Sizing

Match the plan to the requirements. A one-use-case plan gets short sections 5–9;
inflating them with invented detail is worse than a short honest plan.
Section 10 is never shortened.

## Partial plan (stop path)

Sections 1–4 plus the Resources appendix (section 10), status
`Blocked on questions`. Section 4's Open list is the point of the document:
it should be usable as-is to send to the person who can answer. Sections
5–9 are omitted, not left empty.

## Spike variant

Same header and sections 1–4. Then, in this order and with these numbers:

- 5. Question — what the spike must answer, and what a good answer lets
  the team decide.
- 6. Options — a table: option, how it works, benefits, drawbacks, cost or
  effort if known, evidence `[J#] [P#] [C#] [F#]`. At least two options.
- 7. Recommendation — one option, and why, in terms of the requirements.
- 8. What remains unknown — questions the spike could not close, and what
  would close each.
- 9. Risks and Next Steps — risks of the recommendation, and the follow-up
  work (typically: "plan this feature" with the chosen option as input).
- 10. Resources.

A spike has no hexagon design, review section, traceability matrix or
implementation slices.

## Bug variant

Same header and the same ten sections as a feature plan, with these
additions:

- Section 1 states the symptom, the expected behaviour and the reproduction
  steps (marked "not provided" when absent).
- Section 5 opens with **5.0 Root-cause analysis**: hypotheses ranked by
  likelihood, each with the evidence for and against `[F#] [J#] [C#]`, and
  the check that would confirm it.
- Section 8's first slice is the failing regression test that reproduces
  the bug; the fix slices follow it.
- Section 7 traces the bug's requirements (expected behaviour) to that
  test.
