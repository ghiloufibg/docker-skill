# Requirements analysis

The register, doubt triggers and type-specific additions below apply to
every requirements source. The first sections describe reading a **Jira
ticket**; "Raw requirements" at the end describes reading text from the
prompt.

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
| Source | `[J#]`, `[P#]`, `[C#]`, or `[U#]` |
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

## Raw requirements

When the requirements come from the prompt, there is no ticket to fetch.

**Evidence card.** One card for the prompt text, `[P1]`; a second prompt
message that adds requirements later gets `[P2]`:

```
[P1] Requirements provided in the prompt (<date>)
Facts: <the facts that matter, short>
Touches: R1, R3
Links: <Confluence links and Jira keys found in the text, or none>
```

The text itself is kept verbatim in the plan's requirements section, since
there is no ticket for a reader to open.

**Reading it.**
- Split the text into individual requirements and number them `R1…Rn`,
  quoting the sentence each comes from.
- Separate what is required from what is background, an example, or a
  preference; mark preferences as such.
- Written acceptance criteria are rare. For each requirement, propose one
  testable criterion and put the proposals into one grouped confirmation
  question at the gate, not one doubt per requirement.
- Non-functional requirements are usually missing entirely. Run the same
  deliberate pass as for a ticket (latency, volume, security, auditing,
  retention, availability, compatibility, observability) and record "none
  stated" or open a doubt where the feature plausibly needs one.
- The same doubt triggers apply, and thin text means more of them. A request
  too thin to model at all (a single vague sentence, no actor or outcome) is
  the one case to ask for more detail before the gate rather than inside it.

**Links.** Confluence links and Jira keys in the text are explicit links.
Read a referenced Jira issue as `[J#]`, read-only; follow Confluence links
per `confluence-discovery.md`. Don't go looking for a ticket the text never
mentions.

**Type.** Decide it from intent: feature, bug (something is wrong today),
or spike (the user wants options, not a build). Several independent
features in one text means one plan per feature; propose the split and ask
which to plan first.

**Plan identity.** There is no key, so name the plan with a short title and
its slug (kebab-case, about six words at most) and show both at
presentation, where the user can rename them.

## Type-specific additions

- **Bug**: reproduction steps, expected vs actual, root-cause hypotheses
  ranked with the evidence for each, and the regression test that would have
  caught it.
- **Spike**: the question being answered, the options considered with
  trade-offs, a recommendation, and what is still unknown. No hexagon
  design.
- **Epic**: list the children with their status and a proposed split; do
  not design.
