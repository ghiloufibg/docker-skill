# Hexagonal Architecture reference

Deep-dive reference for the package layout, layer responsibilities, and
testing toolset `SKILL.md` points here for. Read this when writing step 6
(package layout) or step 7 (testing strategy) of a plan.

## Package layout: feature-first (default)

Nest the hexagon *inside* each bounded context/feature, rather than putting
every feature's domain code into one shared `domain` package. This is the
default because the failure mode of layer-first layout — one `domain`
package containing every aggregate in the system — makes it nearly
impossible to tell which classes belong to which feature, and it invites
accidental coupling between unrelated aggregates that happen to sit in the
same package.

```
com.acme.orders/                         # bounded context / feature
├── domain/                              # zero framework dependencies
│   ├── model/                           # Entities, value objects, aggregates
│   ├── event/                           # Sealed domain event hierarchy
│   ├── error/                           # Sealed domain error/result hierarchy
│   └── service/                         # Pure domain services (stateless policy logic)
├── application/                         # orchestration; still framework-agnostic
│   ├── port/
│   │   ├── in/                          # Inbound ports = use-case interfaces
│   │   └── out/                         # Outbound ports = what the app needs externally
│   └── usecase/                         # Use-case implementations (application services)
└── adapter/
    ├── in/
    │   ├── web/                         # REST controllers, request/response DTOs, mappers
    │   └── messaging/                   # Queue/event consumers, if applicable
    └── out/
        ├── persistence/                 # Repository adapters, JPA entities, mappers
        ├── client/                      # Outbound HTTP/gRPC clients to other services
        └── messaging/                   # Event publishers
```

A thin `bootstrap`/`config` package (or the framework's own configuration
class, e.g. a Spring `@Configuration`) is the **only** place allowed to know
about both a concrete adapter and the DI container — it wires adapters to
ports. Nothing inside `domain` or `application` ever references it.

## When layer-first is the better call

If the system is genuinely a single small bounded context (not a modular
monolith with several features), a flatter layer-first layout
(`domain/`, `application/`, `adapter/` at the top level, each containing all
the feature's classes) is simpler and loses nothing, since there's only one
feature to separate from itself. Don't impose feature-first ceremony on a
service that only ever has one feature — name this explicitly as a decision
in the plan's Assumptions section rather than defaulting silently.

## Naming ports for what the domain needs, not for infrastructure

A common early mistake: naming an outbound port `OrderRepository` and giving
it every query method a Spring Data repository interface would have,
"because we'll probably need them." This inverts the dependency rule in
spirit even if not in code — the port's shape is now driven by what's
convenient for the adapter (Spring Data) rather than what the use case
actually calls. Prefer one narrow port per actual need (`FindOrderById`,
`SaveOrder`) unless several use cases genuinely share the exact same query.

## Testing strategy per layer

| Layer | What's tested | Tooling | Key property |
|---|---|---|---|
| `domain` | Invariants, value object validation, domain services, event/error construction | Plain JUnit 5, no mocks, no Spring context | Runs in milliseconds; a domain test that needs a mock has a domain that needs an outbound port instead |
| `application`/`usecase` | Orchestration: which outbound ports get called, in what order, with what data, on success and on each failure branch | JUnit 5 + hand-written in-memory fakes of outbound ports (preferred over mocking frameworks when the port is simple — a `Map`-backed `FakeOrderRepository` catches more real bugs than a Mockito stub because it behaves like real state) | Every branch of the use case's sealed result type has at least one test |
| `adapter/out` (persistence) | The adapter's mapping and query correctness against a real engine | Testcontainers running the real database (not H2-in-memory — engine-specific SQL/constraint behavior diverges) | Adapter tests never touch domain invariants; they test mapping + persistence mechanics only |
| `adapter/out` (client) | Request/response mapping, error translation, timeout/retry behavior | WireMock or MockWebServer stubbing the real wire protocol | Assert on what's actually sent over the wire, not just on the mapper function in isolation |
| `adapter/in` (web) | Request validation, status codes, response shape, error mapping | Slice test (e.g. `@WebMvcTest` if using Spring) with the use-case port mocked | Only tests the adapter's own responsibility — HTTP concerns — not the use case's logic |
| Boundary itself | The dependency rule from the non-negotiable rules list | ArchUnit rule, one per boundary: `classes().that().resideInAPackage("..domain..").should().onlyDependOnClassesThat().resideOutsideOfPackage("..adapter..")` (and a matching rule forbidding `javax.persistence`/`jakarta.persistence`/`org.springframework` imports inside `..domain..`) | This is the test that makes the other five actually enforceable over time — without it, "the domain has zero framework dependencies" is a convention that erodes silently |

Always include the ArchUnit rule (or the equivalent for the project's
language/tooling) in the plan's testing section — it's the one test that
turns the six non-negotiable rules from a one-time design decision into
something the codebase keeps automatically.

## Result/error handling across the boundary

Recommend a sealed result type for **expected** outcomes a use case can
produce (`OrderPlaced`, `OrderRejected(reason)`), returned from the inbound
port rather than thrown. Reserve exceptions for genuinely unexpected,
unrecoverable failures (a database connection drop, a bug) that no caller
is expected to branch on — an inbound web adapter catches these at its edge
and maps them to a 500, it doesn't pattern-match on them. Mixing the two —
throwing a checked exception for something the caller is expected to
handle as a normal branch — is one of the more common sources of an
anemic, exception-driven domain; see `java21-standards.md` for the sealed
result pattern in code.
