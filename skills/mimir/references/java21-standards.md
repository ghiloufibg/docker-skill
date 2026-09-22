# Java 21 language standards reference

The concrete language-feature decisions `SKILL.md` step 2 points here for.
The guiding rule: use what's **stable** in Java 21 to reduce boilerplate and
make illegal states unrepresentable — and never reach for anything that
shipped in a later JDK, or present a Java-21 preview feature as a safe
default.

## Records for every immutable data carrier

Value objects, domain events, commands/requests, query results, and
adapter-facing DTOs should all be `record`s. Before Java's records, each of
these required a hand-written constructor, getters, `equals`/`hashCode`, and
`toString` — code that added no behavior and was a routine source of
copy-paste bugs (a `hashCode` that forgot a field `equals` included).

```java
public record Money(BigDecimal amount, Currency currency) {
    public Money {
        Objects.requireNonNull(amount);
        Objects.requireNonNull(currency);
        if (amount.scale() > currency.getDefaultFractionDigits()) {
            throw new IllegalArgumentException("scale exceeds currency precision");
        }
    }
}
```

Use the **compact constructor** for invariant validation — it runs before
field assignment, so an invalid `Money` can never be constructed at all,
which is the actual goal (not just "validate somewhere"), matching rule 1's
insistence that the domain enforce its own invariants.

**Exception: JPA `@Entity` classes are not records.** JPA requires a mutable,
proxyable class with a no-arg constructor, which conflicts with a record's
immutability guarantees. Keep JPA entities as adapter-only classes in
`adapter/out/persistence`, and map them to/from domain records explicitly —
this is exactly the adapter-boundary mapping rule 5 requires, not a special
case of it.

## Sealed interfaces for closed domain hierarchies

Any time the domain has a fixed, known set of variants — outcomes of a use
case, domain event types, error categories — model it as a `sealed
interface` with `record` implementations, not as a single class with a
`type` enum field and nullable fields depending on which type it is (the
classic "this field is only set when status is REJECTED" anti-pattern that
records+sealed types eliminate entirely).

```java
public sealed interface PlaceOrderResult
        permits OrderPlaced, OrderRejected {}

public record OrderPlaced(OrderId id, Instant placedAt) implements PlaceOrderResult {}
public record OrderRejected(RejectionReason reason) implements PlaceOrderResult {}
```

## Pattern matching for switch + record patterns

Consume a sealed result/event with an exhaustive `switch` — the compiler
refuses to compile if a new variant is added and a `switch` doesn't handle
it, which is exactly the safety net you want at every place a use case's
result crosses into an adapter.

```java
String response = switch (result) {
    case OrderPlaced(var id, var placedAt) ->
        "Order %s placed at %s".formatted(id, placedAt);
    case OrderRejected(var reason) ->
        "Order rejected: " + reason;
};
```

No `default` branch — that's deliberate. A `default` branch silently
absorbs a future forgotten case; letting the compiler force a decision when
a new variant is added is the entire point of sealing the hierarchy in the
first place.

Guidance: keep patterns to one level of destructuring where possible. A
switch that pattern-matches three levels deep into nested records is harder
to read than one that switches on the outer type and destructures once
inside each branch — clarity over cleverness.

## Immutability by default

- `final` fields everywhere in the domain; no setters.
- Unmodifiable collections at every boundary: `List.copyOf(input)` when
  accepting a collection into a constructor, `List.of(...)` when building
  one — never store or return a caller's own mutable `ArrayList`.
- `var` is fine for local variables where the type is obvious from the
  right-hand side (`var order = new Order(...)`); never on a public method
  signature or field, where the type is part of the contract and should be
  explicit.

## `Optional` at boundaries only

Use `Optional<T>` as a **return type** from a port or use case when "absent"
is a legitimate outcome (`FindOrderById` returning `Optional<Order>`).
Never use `Optional` as a field type, a constructor parameter, or a method
parameter — those cases should either always have a value (make the field
non-optional) or model absence as an explicit variant (a sealed type case),
not as `Optional.empty()` buried in a field.

## Errors: sealed results vs. exceptions

Prefer a sealed result type (as above) for outcomes a caller is expected to
branch on. Reserve `RuntimeException` subtypes for failures no reasonable
caller handles differently — a database being unreachable, a programming
bug — that an inbound adapter catches once, at its edge, and translates to
a generic error response. Do not use checked exceptions in the domain or
application layer: they force every caller up the stack to either handle or
re-declare them, which in practice means they get wrapped in
`RuntimeException` a few layers up anyway, so the checked-ness added
ceremony without adding safety.

## Virtual threads (JEP 444) — for I/O-bound adapters, not for the domain

Virtual threads remove the cost of blocking on I/O (blocking JDBC calls,
blocking HTTP clients, thread-per-request web servers), letting an adapter
use ordinary blocking code at high concurrency instead of reactive
streams. They do **not** speed up CPU-bound work — a virtual thread
running domain logic runs exactly as fast as a platform thread would,
because the domain isn't blocking on anything.

Where this belongs in a plan: note that inbound web adapters can run on a
virtual-thread-per-request executor, and that outbound client/persistence
adapters benefit from it if they use blocking I/O clients. Two things to
flag explicitly when this appears in a plan:
- **Size connection pools for the downstream resource, not for thread
  count.** Ten thousand virtual threads will still exhaust a fifty-
  connection database pool — the pool's limit doesn't change just because
  the calling side got cheaper.
- Virtual threads pin the carrier thread inside a `synchronized` block —
  if an adapter has hot `synchronized` code on the request path, flag it
  as something to convert to a `ReentrantLock` before relying on virtual
  threads at scale.

## Structured concurrency — preview only, opt-in

Structured concurrency (JEP 453) is still a **preview** feature in Java 21
(requires `--enable-preview`, and its API can still change before it's
finalized in a later JDK). Do not design a plan's default execution model
around it. If a use case genuinely needs to fan out several concurrent
outbound calls and join their results, it's fine to note structured
concurrency as an explicit, opt-in future note ("once the team accepts
preview-feature risk, this fan-out is a natural fit for
`StructuredTaskScope`") — but the plan's baseline design should work
without it, using `CompletableFuture` or a plain `ExecutorService` with
virtual threads if concurrent I/O fan-out is needed now.

## What NOT to reach for

- Nothing from Java 22+ (e.g. unnamed variables/patterns, class-file API,
  stream gatherers, scoped values as a finalized feature) — Java 21 is the
  ceiling.
- Lombok in the domain layer — records make most of its use cases (getters,
  `equals`/`hashCode`, builders for simple data) unnecessary, and its
  annotation processing is exactly the kind of "framework leakage into the
  core" rule 1 rules out. It's tolerable in adapters if the team already
  depends on it elsewhere, but don't introduce it as part of a fresh plan.
- Field/setter injection — constructor injection only, everywhere,
  including in adapters. It's what makes a class constructible in a plain
  JUnit test without a DI container.
