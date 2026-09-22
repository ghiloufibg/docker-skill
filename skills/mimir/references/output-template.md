# Output template

`SKILL.md` step 8 says to use this structure exactly. Fill every section with
the specific feature's real names — a section that just repeats generic
advice from the reference docs instead of naming actual records/interfaces
means the plan isn't finished yet.

```markdown
# Implementation Plan: <Feature Name>

## 1. Summary
One paragraph: what this feature does, and which bounded context it lives in.

## 2. Assumptions & Open Questions
- Assumptions made to fill gaps in the requirement (state each one plainly —
  don't bury a guess inside a design decision).
- Questions worth confirming before implementation starts, if any remain.

## 3. Domain Model
For each aggregate/entity/value object:
- Name, and whether it's an aggregate root, entity, or value object.
- Its record/class signature (real fields and types, not placeholders).
- Its invariants, and where they're enforced (compact constructor, factory
  method, domain service).

For domain events and errors: the sealed interface + its permitted records.

## 4. Use Cases & Ports

### Inbound ports (application.port.in)
For each use case:
- Interface name and method signature (request record in, result type out).
- The sealed result type's variants and what triggers each one.

### Outbound ports (application.port.out)
For each external need:
- Interface name, method signature, and *why the use case needs it* (not
  "because the database has this table" — because the use case needs to
  find/save/notify something).

## 5. Application Services (application.usecase)
For each inbound port's implementation:
- Class name, constructor dependencies (which outbound ports).
- Orchestration steps as a short numbered list or pseudocode — not full
  method bodies.

## 6. Adapters
For each port, its adapter(s):
- Adapter name, technology (e.g. Spring MVC controller, Spring Data JPA
  repository, Testcontainers-verified Postgres adapter, WireMock-verified
  REST client).
- The explicit mapper between the adapter's model and the domain record —
  name both sides.
- Anything adapter-specific worth flagging (validation annotations on the
  DTO, retry/timeout policy on an HTTP client, idempotency key on a
  publisher).

## 7. Package Layout
The concrete package tree for this feature, following
`references/hexagonal-architecture.md` (feature-first by default — say so
explicitly if this plan instead uses layer-first, and why).

## 8. Testing Strategy
One line per layer (domain, use case, each adapter, the ArchUnit boundary
rule), following the table in `references/hexagonal-architecture.md`, made
specific to this feature's classes and failure modes.

## 9. Concurrency & Performance Notes
Only if relevant: which adapters are I/O-bound and could run on virtual
threads, any downstream connection-pool sizing implication, and whether
structured concurrency is flagged as a future preview-gated option (see
`references/java21-standards.md`). Omit this section entirely if the
feature has nothing concurrency-relevant to say — don't pad the plan.

## 10. Build/Dependency Notes
Target Java version (21 or lower — state which), and which new third-party
dependencies (if any) this plan introduces, scoped to which module
(domain must introduce none).
```

## Sizing the plan to the feature

A small feature (a single use case, one aggregate, no new external
integration) doesn't need every subsection padded out — sections 5, 6, and 8
might be two or three lines each. A feature spanning several use cases and
a new external integration earns a longer plan. Match the plan's length to
the feature's actual complexity; a two-line CRUD-ish use case forced into
the full template with invented detail is worse than a shorter, honest plan.
