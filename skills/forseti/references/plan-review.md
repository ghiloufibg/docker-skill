# Plan review mode

`SKILL.md` points here when the input is a design or implementation plan
(typically a `mimir` plan) instead of source code. The rules are the same
rules — a plan that would produce a boundary violation if implemented as
written is as wrong as the violation itself, and cheaper to fix now.

## Scope: review the design, not the prose around it

Review only the design content: domain model, use cases and ports, adapters
and mappers, package layout, testing strategy, build/dependency notes. If the
document wraps that design in other sections (requirements, context,
risks), leave those alone — except as noted under "Traceability" below.

Inventory still comes first: confirm the plan's scope, classify each planned
class as `domain`, `application`, or `adapter` by its planned package, and
check the build file for the toolchain actually in use. Then run the
Docker/CI reality check from `SKILL.md` step 1 whenever the plan's testing
strategy mentions Testcontainers or a real-database test.

## How each checklist applies to a plan

| Checklist | In plan mode |
|---|---|
| `hexagonal-boundary-checklist.md` (Checks 1–6) | Applies in full, to planned signatures, imports/annotations the plan assigns to a class, package layout, and mapper placement. A planned domain record annotated for JPA is Check 1; a planned port returning an adapter DTO is Check 5. |
| `java21-modern-idioms.md` | Applies to what a plan can show: `Optional` placement in planned signatures, records vs Lombok, mapper approach, builder vs large constructors, the Java 21 ceiling. **Skip** the magic-literal, `final`/`var`, and stream-vs-loop checks — there is no implementation code to judge. |
| `naming-checklist.md` | Applies to planned class, method and field names and to the plan's glossary: a technical or generic name in the plan will be copied into the code. |
| `spring-boot3-practices.md` | Applies to design decisions the plan states: where `@Transactional` sits, fetch strategy, error mapping, configuration binding, constructor injection. Flag a stated decision that breaks a rule; do not flag a topic the feature doesn't touch. |
| `test-quality-checklist.md` | Applies to the plan's testing strategy: a planned mock of a value object or record, a planned test type that doesn't match its layer, a persistence strategy the confirmed CI can't run. |
| `no-comments-policy.md` | **Does not apply.** Pseudocode and commented orchestration steps in a plan are documentation of intent, not code under review. |

## Read only the sections that apply

The checklist files are long and much of each is about implementation code.
In plan mode, find the section headings (grep for `^## `) and read only
these sections, not the whole file:

| File | Sections to read |
|---|---|
| `java21-modern-idioms.md` | Optional; Records instead of Lombok POJOs; MapStruct; Builder pattern; Sealed interfaces + pattern matching |
| `spring-boot3-practices.md` | Constructor injection only; ProblemDetail / RFC 7807; `@Transactional` correctness; JPA fetch strategy and N+1; `@ConfigurationProperties` over scattered `@Value` |
| `test-quality-checklist.md` | The core rule, Check 1, Check 2, Check 7 |
| `hexagonal-boundary-checklist.md` | All six checks |
| `naming-checklist.md` | All |

Read a spring section only if the plan touches that topic. Skip the
remaining sections; they judge implementation code a plan doesn't contain.

## Plan-specific checks

These have no code equivalent. Each finding names the plan section and
quotes the plan's own text.

1. **Every use case has an inbound port.** A use case described in prose
   with no named port and signature is incomplete — the implementer has to
   guess the shape.
2. **Every external dependency has an outbound port.** A database, queue,
   remote service, clock, or ID generator referenced by a use case but not
   given a port is a planned boundary leak.
3. **Signatures are real.** A port or record named without fields, parameter
   types, or return type is a restatement of the requirement, not a plan.
4. **The testing section names a boundary rule the build can enforce**
   (module-dependency or import-control rule), not just "keep the domain
   clean".
5. **Assumptions are explicit.** A design choice that depends on an
   unconfirmed fact (database engine behavior, an external contract) and is
   not listed as an assumption is a hidden guess.
6. **No unexplained post-Java-21 feature** (same ceiling as Check 6).

## Traceability (only if the plan has it)

If the plan carries a requirements list or a traceability section, also
flag: a requirement that maps to no component or test and is not marked out
of scope, and a component or test that traces to no requirement. If the
plan has no such section, do not demand one — that is outside this skill's
rules.

## Severity in plan mode

Same three tiers, judged by what happens if the plan is implemented as
written:

- **CRITICAL** — implementing it as written produces a hexagonal boundary
  violation or a correctness/security defect (a planned adapter model
  crossing a port, a use case with no outbound port for an external call, a
  planned test setup the CI cannot run).
- **IMPORTANT** — violates a hard rule or leaves an implementer guessing
  about one (a port with no signature, a hidden assumption, a planned
  mock of a record).
- **RECOMMENDED** — a judgment call (a split of a borderline use case, a
  builder for a borderline record).

## When another skill calls this review

If a calling skill (for example `odin`) asks for findings only, return a
compact inline list: severity, plan location, one-line reason, fix. Leave
out the summary table, the Strengths section and the code fences around
quoted plan text, and do not save a report file — the caller owns what gets
written.

## Location and fix format

There is no file and line. Use the plan's section heading (and the item's
name) as the location, quote the plan's text, and give the corrected plan
text or signature as the fix. See the plan-mode variant in
`output-template.md`.
