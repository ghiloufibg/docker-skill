# Ticket analysis

`SKILL.md` steps 1 and 2 point here.

## What to read

From the ticket, and from each linked issue worth following (parent epic,
blockers, "relates to", subtasks — one hop, no crawling):

- Type, key, summary, status, last-updated timestamp
- Description and acceptance criteria
- All comments (decisions and clarifications often live here, not in the
  description)
- Linked issues, parent epic, subtasks
- Labels, components, fix version
- Every Confluence link anywhere in the above, including remote links

**Fetch discipline.** Fetch only the fields above. Never fetch attachments,
images, screenshots, or change history unless a requirement explicitly
depends on one (then say which and why). For a long comment thread, read
all of it but record only the decisions, clarifications and open points on
the card, not the conversation.

Record the ticket's last-updated timestamp; the plan header carries it so a
reader can tell whether the ticket changed after the plan was written.

## Evidence card format

One per source, written as soon as the source is read, so the raw text need
not stay in context:

```
[J1] PROJ-123 — <summary> (<type>, <status>, updated <ts>)
Facts: <the facts that matter, short>
Touches: R1, R3
Confluence links: <list or none>
```

Linked issues get their own ids (`[J2]`…) with the same fields.

## Requirement register

| Field | Meaning |
|---|---|
| ID | `R1…Rn`, stable for the whole plan |
| Type | functional, non-functional, constraint |
| Text | acceptance criteria verbatim, then a one-line restatement |
| Source | `[J#]`, `[C#]`, or `[U#]` |
| Testable | yes / no — if no, say what would make it testable |

Non-functional requirements deserve a deliberate pass: latency, volume,
security, auditing, retention, availability, compatibility, observability.
Many tickets state none; record "none stated" rather than inventing
numbers, and make the missing ones doubts where the feature plausibly needs
them.

## Doubt triggers

Open a doubt for: a vague word with no number ("quickly", "large",
"similar to"), an acceptance criterion that contradicts the description or a
comment, a term used two ways, a missing actor or permission rule, an
external system or contract named but not described, behaviour on failure
not stated, data lifecycle (create/update/delete/retention) not stated, and
anything the ticket says "TBD" or "to be confirmed" about.

## Type-specific additions

- **Bug**: reproduction steps, expected vs actual, root-cause hypotheses
  ranked with the evidence for each, and the regression test that would have
  caught it.
- **Spike**: the question being answered, the options considered with
  trade-offs, a recommendation, and what is still unknown. No hexagon
  design.
- **Epic**: list the children with their status and a proposed split; do
  not design.
