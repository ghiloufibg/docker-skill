# Plan presentation and confirmation

`SKILL.md` steps 9 and 10 point here. The plan is shown in the console and
revised with the user first; the file is written only when the user
explicitly confirms. What the user reviews is exactly what gets saved.

## Layout of the console output

Three blocks, in this order. Only the second block is saved.

1. **Review header** (not saved): one compact block with the source (the
   ticket, or the plan title and slug in raw mode, which the user can
   rename), the status, the path the plan would be saved to, and the counts that tell the
   user what they are about to read: requirements, implementation slices,
   assumptions, design-review findings (fixed / accepted / open), open
   questions.
2. **The plan** (this is the file content): the full document per
   `plan-template.md`, as markdown, section by section, ending with the
   Resources appendix. Print all of it in order. Do not summarise, truncate,
   or elide sections ("..."): the user cannot validate what they cannot see.
   If it must be split across messages, label the parts ("part 1 of 2").
3. **Review panel** (not saved): what needs the user's attention (accepted
   assumptions, contingent design parts, the top risks), then the options:

```
Review options
  save            write to docs/plans/PROJ-123-order-cancellation.md
                  (raw mode: docs/plans/order-cancellation.md)
  change <what>   e.g. change 5: split CancelOrder into two use cases
  path <p>        save somewhere else
  show <section>  reprint one section
  discard         end without saving
```

Plain text, no decoration beyond what markdown needs.

## Handling change requests

A change request is a user decision. Apply it with the smallest edit that
satisfies it, then keep the document consistent:

- Update every place the change touches: citations, the requirements
  register, the glossary, the traceability matrix, the implementation
  slices, and the status if it changes.
- Re-run the `forseti` plan review only when the change touches the design
  (domain model, ports, use cases, adapters, package layout, testing
  strategy, naming), and then on the changed design sections only, with
  findings returned inline. A wording, ordering or formatting change skips
  the review. Always re-run the traceability check on the whole plan; it is
  cheap. Fix anything the change broke.
- If the change needs facts from Jira or Confluence, read them (read-only)
  and add evidence cards.
- If a change contradicts a source, say so and apply it only if the user
  confirms; record it as a `[U#]` entry marked "review".
- A change that resolves or alters a requirement or assumption is recorded
  in section 4 as a `[U#]` entry marked "review", dated.
- Number revisions (r1, r2, …). Reprint a short revision log (what changed,
  in which sections) and the changed sections in full; `show all` reprints
  everything. There is no cap on review rounds — they are the user's, unlike
  the gate's two.

## Saving

- **Only on an explicit instruction**: `save`, or a clear yes to "Save to
  <path>?". Praise or acceptance that isn't a save instruction ("looks
  good", "ok") is not one — ask once: "Save to <path>?". Never infer
  confirmation, and never save partway through review.
- Before writing, state the path and the revision being saved. If the file
  already exists, show its status and source (with the ticket timestamp, in ticket mode) and ask whether to
  overwrite or use another name. Create the target directory if it is
  missing.
- Write exactly the approved plan body — not the review header, not the
  review panel.
- After writing, confirm the path and the status in one or two lines, and
  suggest the first implementation slice as the next step.
- `discard` (or ending the session) writes nothing.

## Partial plan (stop path)

The partial plan goes through the same presentation, shorter. Offer to save
it explicitly, and say why it matters: resuming later reads the saved file,
so an unsaved partial plan loses the recorded answers.

## Non-interactive runs

With no way to prompt, print the plan (or partial plan) to the output and
do not write a file. The only exception is an invocation that explicitly
asks to save, with or without a path; that is the user's confirmation.
