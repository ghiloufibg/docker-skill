---
name: mimir
description: Turns a feature or requirement into a ready-to-implement plan for a Java backend (Java 21 LTS or earlier, never newer) built with strict Hexagonal Architecture (Ports & Adapters). Produces a domain model (records, sealed types, value objects) named in the business's own language, inbound and outbound ports, use-case services, adapter skeletons, package layout, dependency-boundary rules and a layer-by-layer testing strategy, as a plan and not full code. Use when the user asks to design, architect or plan a Java feature, service or module, mentions hexagonal or clean architecture, ports and adapters, DDD or aggregates, or asks how to structure a Java backend before writing code. If the input is a Jira ticket, or raw requirements that still need analysis or clarification, and the odin skill is available, use odin instead. Do NOT use for non-Java stacks, for reviewing or refactoring existing code, or for hand-written method bodies.
---

# Mimir — the Hexagonal Java Architect

In Norse myth, Mimir is consulted for counsel before a decision is made, not
after. This skill works the same way: it turns a feature or requirement into
a **plan a developer can implement from**, produced *before* any code is
written — domain model, ports, use cases, adapters, package layout, and how
each layer will be tested. It does not write the business logic itself; that
is a job for the developer or a coding agent, once the plan exists.

The `forseti` skill, if installed alongside this one, reviews
against this same hexagon and reports findings — first the plan itself, and
later the code written from it. The two skills are meant to be used in
sequence, plan then judge, not as alternatives to each other.

The constraint that makes the plan trustworthy: **strict Hexagonal
Architecture, and Java no newer than 21 (LTS)**. Every design decision below
exists to keep the domain provably independent of frameworks and infrastructure,
and to use only language features that are stable in Java 21 — no preview
features presented as if they were safe defaults.

## The non-negotiable rules

These are the rules a hexagonal design lives or dies by. Violating any one of
them is exactly the kind of "small pragmatic exception" that turns into a
framework-coupled domain a year later — so treat them as boundaries to design
*around*, not defaults to reach for out of habit.

1. **The domain has zero framework dependencies.** No Spring annotations, no
   JPA/Jakarta Persistence annotations, no Jackson annotations, no logging
   framework imports — nothing outside the JDK — anywhere in the domain
   package. If a domain class needs an annotation to compile, that's a sign
   it belongs in an adapter instead.
2. **Dependencies point inward, always.** `adapter` depends on `application`,
   `application` depends on `domain`. Nothing in `domain` or `application`
   ever imports from `adapter`. Ports are the only crossing point, and they
   are owned by the inside, not the outside.
3. **Ports are interfaces owned by the core, not by the adapter.** An
   outbound port (e.g. `SaveOrderPort`) is defined in `application.port.out`
   because the *application* decides what it needs — the persistence adapter
   just happens to satisfy that need today. This is what makes swapping
   Postgres for DynamoDB an adapter-only change.
4. **One inbound port per use case, not one fat "service" interface.**
   Interface Segregation matters here specifically because inbound adapters
   (a REST controller, a message listener) should depend only on the one or
   two use cases they actually invoke, not on a god-interface with forty
   methods.
5. **Adapters never leak their models past the boundary.** A JPA `@Entity`,
   a REST request DTO, an HTTP client's generated model — none of these are
   ever passed into or returned from a port. Map explicitly at the adapter
   edge, every time, even when the fields are identical today (they won't
   stay identical).
6. **No Java feature newer than 21.** If a JEP shipped after Java 21, do not
   design around it. Preview features that exist *in* 21 (e.g. structured
   concurrency, JEP 453) may be mentioned as an explicitly opt-in future
   note, never as part of the default plan — see `references/java21-standards.md`.

## Naming: the ubiquitous language

A plan's names are its documentation, and the code written from it has no
comments to fall back on, so every name has to carry business intent. This
is how the domain stays readable to the people who asked for the feature
(the DDD "ubiquitous language").

1. **Use the business's own words.** Every class, record, port, method,
   field, parameter and test name takes its vocabulary from the requirement
   (and from the ticket or documents it came from), not from an invented
   technical synonym. If the business says "settlement", the type is
   `Settlement`, not `PaymentRecord`.
2. **Name by intent, not mechanism.** Behaviour is a business verb
   (`cancel`, `approve`, `reserveStock`), not `update`/`set`/`process`/
   `handle`; concepts are nouns the business uses; booleans read as facts
   (`isEligibleForRefund`). Use cases are already named this way (`CancelOrder`,
   not `UpdateOrder`); methods and fields follow the same standard.
3. **One concept, one name.** Pick one term per concept and use it in every
   layer. Don't alternate `Customer`/`Client`/`User` for the same thing.
4. **Technical names stay in adapters.** `Entity`, `Dto`, `Impl`, `Manager`,
   `Helper`, `Util`, `Data`, `Info` and table- or column-derived names belong
   only at the adapter edge (`OrderJpaEntity` maps to `Order`), never in
   `domain` or `application`.
5. **Conflicting vocabulary is a question, not a choice.** If the
   requirement uses two words for one thing, or one word for two things,
   record it as an Assumption (or a question, if no clarification has been
   done) rather than silently picking one.

Close the domain model section of the plan with a short glossary (see
`references/output-template.md`).

## Workflow

### 1. Extract the domain, don't just restate the requirement

Read the feature/requirement and identify, before designing anything:
- The **aggregate(s)** and their invariants — what must always be true, and
  who is responsible for enforcing it.
- The **use cases** — each one becomes exactly one inbound port. Name them
  as verbs on the domain, not as CRUD (`CancelOrder`, not `UpdateOrder`).
- The **domain events**, if the feature produces state changes other parts
  of the system care about.
- The **external dependencies** the feature needs — a database, another
  service, a queue, the clock, a random/ID generator. Every one of these
  becomes an outbound port; none of them get referenced directly.
- The **ubiquitous language** — the business terms the requirement uses for
  each aggregate, use case, value and state, so the names in the plan come
  from the requirement and not from the implementer's habits.

If the requirement is genuinely too ambiguous to model (e.g. it's unclear
whether "cancel" is a state transition or a deletion), ask one targeted
question rather than guessing — but don't turn this into a full requirements
interview. A architecture plan can carry explicit **Assumptions** for minor
gaps; save questions for the ones that would change the shape of the domain.

If the caller says clarification is already complete, don't ask at all:
record any new doubt as an **Assumption** in the plan instead.

### 2. Model the domain

Follow `references/java21-standards.md` for the concrete language choices.
In short: value objects and events as `record`s, closed sets of
outcomes/errors/event types as `sealed interface`s deconstructed with
pattern-matching `switch`, invariants enforced in constructors/compact
constructors, no setters, no public no-arg constructors on anything that
has invariants.

### 3. Define the ports

- **Inbound (`application.port.in`)**: one interface per use case, named as
  a command (`PlaceOrder`) with a single method taking a request record and
  returning a result record or sealed result type. This is what an adapter
  calls — it's the application's public API.
- **Outbound (`application.port.out`)**: one interface per external
  capability the use case needs (`FindOrder`, `SaveOrder`, `PublishOrderEvent`).
  Keep these narrow and named for what the domain needs, not for what a
  database table looks like — `FindOrder`, not `OrderRepository` with fifteen
  query methods nothing uses yet.

### 4. Write the use-case (application service) skeletons

One class per inbound port, implementing it, injected with only the
outbound ports it actually calls (constructor injection, final fields, no
framework annotations here either — annotate the *adapter* that wires it,
if the framework needs a bean). Sketch the orchestration as commented steps
or short pseudocode, not full logic — this is a plan, not an implementation.

### 5. Design the adapters

For each inbound/outbound port, name the concrete adapter(s), the
technology, and the explicit mapper between the adapter's model and the
domain's. State what belongs on the adapter's DTO (validation annotations,
serialization annotations) versus the domain record (nothing but the data
and its own invariants).

### 6. Lay out the packages

Default to **feature-first, hexagon-nested-inside** (see
`references/hexagonal-architecture.md` for the full layout and the
alternative layer-first layout, and when each is the better call). Feature-
first keeps a bounded context's domain/application/adapter code together and
stops unrelated features from sharing one giant `domain` package that
nobody can safely change.

### 7. Specify the testing strategy

Every plan states, per layer: what's tested, with what tool, and — critically
— **the one build-enforced rule that would have caught it if this plan's
boundary was violated** (a module-dependency or import-control rule the
build fails on). See `references/hexagonal-architecture.md` for the
default toolset (plain JUnit 5 for the domain, fakes-over-mocks for
use-case tests, an in-process database substitute for persistence adapter
tests, WireMock for client adapter tests, and a build-enforced
dependency/import rule for the boundary itself).

### 8. Write the plan

Use the exact structure in `references/output-template.md`. Fill in real
package names, real record/interface signatures, and a concrete package
tree — a plan that says "define a port for persistence" without naming the
method signature isn't a plan yet, it's a restatement of step 3.

## Before delivering the plan, check it against its own rules

Walk the plan you just wrote against the six non-negotiable rules above.
The most common self-violations: a domain record that quietly needs a JPA
annotation to be persisted as-is (fix: it needs a mapped persistence model,
not an annotation), an outbound port named after a table instead of a
domain need, or a use case that calls two unrelated outbound ports because
it's secretly two use cases. Catching these before handing over the plan is
the entire value of doing this step before code exists.

Then read every name in the plan once more: does it say what the business
calls this thing and what it is for? A name like `OrderManager`,
`processData`, or `OrderDto` inside `domain` fails that test.
