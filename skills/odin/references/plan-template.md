# Plan template

`SKILL.md` step 9 says to use this structure. The document below is shown
to the user in full before anything is saved (`plan-presentation.md`); what
they approve is exactly what is written to the file. Fill every section with the
ticket's real content; a section that only repeats generic advice means the
plan isn't finished. Cite sources inline with `[J#] [C#] [F#] [U#] [A#]`.

```markdown
# <KEY>: <title> — Technical Implementation Plan

Status: <Ready | Draft (assumptions accepted) | Contingent | Blocked on questions>
Generated: <date> · Ticket last updated: <timestamp> · Skills: odin, mimir, forseti

## 1. Ticket Understanding
Goal in one paragraph. Scope in / scope out. Actors. [J#]

## 2. Requirements Register
| ID | Type | Requirement | Source | Testable |
|----|------|-------------|--------|----------|

## 3. Context from Confluence
Distilled facts per page, cited. Contradictions and stale pages called out.
If nothing relevant was found, say so.

## 4. Clarifications
- **Gate outcome**: <N> asked in round <r>: <a> answered, <b> default accepted,
  <c> deferred.
- **Resolved**: question → answer, with citation [U#]/[J#]/[C#]/[F#].
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
design touches them. Omit a subsection the ticket doesn't touch.

## 10. Resources
(see references/resources-appendix.md)
```

## Sizing

Match the plan to the ticket. A one-use-case ticket gets short sections 5–9;
inflating them with invented detail is worse than a short honest plan.
Section 10 is never shortened.

## Partial plan (stop path)

Sections 1–4 and 10 only, status `Blocked on questions`, with section 4's
Open list as the point of the document: it should be usable as-is to send
to the person who can answer.

## Spike variant

Replace sections 5–8 with: Question, Options with trade-offs, Recommendation,
What remains unknown. Keep 1–4, 9 and 10.

## Bug variant

Add to section 5: root-cause hypotheses ranked with evidence, and the
regression test that would have caught it.
