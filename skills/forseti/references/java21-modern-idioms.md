# Java 21 modern idioms checklist

`SKILL.md` step 3 points here. Each check states the rule, *why* it's a
rule rather than taste, and the exception cases where flagging it would be
a false positive — apply the exception before writing the finding, not
after.

## Optional: return type only, never field or parameter

**Flag (Important)**: `Optional<T>` used as a field type, a constructor parameter,
or a method parameter.

**Why**: `Optional` as a field adds wrapper overhead for no benefit, breaks
frameworks that expect a plain type (JPA, Jackson, Bean Validation all
special-case or mishandle `Optional` fields), and complicates
serialization. As a parameter, it forces every caller to wrap a value they
already know isn't null, which is pure ceremony — `Optional` communicates
"this method might not return a value," not "this parameter is sometimes
absent," and an absent parameter should be an overload or a different
method, not a wrapped `null`.

**Don't flag**: `Optional<T>` as a **return type** from a query method or
port (`Optional<Order> findById(OrderId id)`) — this is the one place it's
correct and idiomatic.

```java
// Important flag — Optional field
public class Order {
    private Optional<Discount> discount; // flag: use `Discount discount` (nullable) or a sealed "no discount" variant
}

// Important flag — Optional parameter
public void applyDiscount(Optional<Discount> discount) { ... } // flag: overload, or accept `@Nullable Discount`

// ✅ correct — Optional return type
public Optional<Order> findById(OrderId id) { ... }
```

**Also flag (Critical if in a use case's error path, otherwise Important)**: calling
`.get()` on an `Optional` without a preceding presence check or without
using `orElseThrow`/`map`/`orElse` — `Optional.empty().get()` throws
`NoSuchElementException`, which is exactly the unchecked-null bug
`Optional` was supposed to prevent, just relocated.

## StringUtils / CollectionUtils over hand-rolled checks

**Flag (Important)**: a hand-rolled null/blank/empty check where an established
utility already covers it correctly.

```java
// Important flag
if (name == null || name.trim().isEmpty()) { ... }
if (list == null || list.isEmpty()) { ... }

// ✅ correct — Apache Commons Lang3 / Commons Collections4, or Spring's own
if (StringUtils.isBlank(name)) { ... }
if (CollectionUtils.isEmpty(list)) { ... }
```

**Why**: `name.trim().isEmpty()` is a fresh place to get whitespace/`null`
handling subtly wrong every time it's re-typed (forgetting the null check,
using `isEmpty()` without `trim()` and missing whitespace-only strings,
NPE-ing on the `.trim()` call itself). A well-tested utility method removes
an entire category of copy-paste bugs — this is different from, and not
an endorsement of, growing a project's own ad hoc "Util" dumping ground
(see the constants check below for the parallel anti-pattern).

**Which library**: use whatever the project already depends on — check the
build file first (`SKILL.md` step 1). Common choices: `org.apache.commons:
commons-lang3` (`StringUtils`) + `commons-collections4` (`CollectionUtils`),
or Spring's own `org.springframework.util.StringUtils`/`CollectionUtils`
(already on the classpath in any Spring Boot project, no new dependency
needed — prefer this one if the project has no existing Commons dependency).
Don't recommend adding Commons Lang3 to a codebase that already uses
Spring's equivalents for the same purpose; flag the inconsistency instead
if both are present.

**Don't flag**: a null-check that's guarding a genuinely different
condition than blank/empty (e.g. checking a specific sentinel value, or a
check that's part of validating business rules beyond "was something
provided") — the rule is about reimplementing a solved problem, not about
banning all conditionals.

## Constants for hardcoded literals

**Flag (Important)**: a string or numeric literal repeated more than once, or used
in a context where its meaning isn't obvious from the surrounding code
(a "magic" literal), especially error messages, header names, config keys,
regex patterns, and status/type discriminator strings.

```java
// Important flag
if (status.equals("PENDING")) { ... }
response.setHeader("X-Request-Id", requestId);

// ✅ correct
private static final String STATUS_PENDING = "PENDING";
private static final String HEADER_REQUEST_ID = "X-Request-Id";
```

**Where the constant lives — flag the wrong placement too**:
- A constant used by exactly one class belongs as a `private static final`
  field on that class, not in a shared constants class.
- A constant shared by a handful of related classes belongs in a
  small, logically-scoped holder next to them (or on a `sealed` type/enum
  if it's really a fixed set of values), not dumped into a single
  project-wide `Constants`/`Config` god-class — flag a constants class that
  has grown unrelated groups of literals ("God constants class") as its own
  finding, separate from the individual missing-constant findings.
- A constant used across module/bounded-context boundaries should only
  exist if that module is genuinely a shared library with an explicit
  dependency — don't let one feature's internal constant leak into
  another feature's code just because the classpath allows the import.

**Don't flag**: a literal used exactly once, in a context where it's
self-explanatory (`List.of(1, 2, 3)` for a genuinely arbitrary small
fixture, `"/"` as a path separator in a one-off split) — a constant that
exists only to satisfy the rule, with a name no clearer than the literal
itself, is worse than the literal.

## `final` and `var`

**Flag (Important)**: a field, parameter, or local variable that is never
reassigned after initialization but isn't declared `final`.

**Flag (Recommended)**: a local variable whose declared type is redundant with an
obvious right-hand side (`Order order = new Order(...)`, `List<String>
names = new ArrayList<>()` when consumed immediately as `List<String>`)
that could be `var order = new Order(...)`.

**Don't flag `var`**: on a field, a method/constructor parameter, or a
public method's return type (`var` on a public signature removes the type
from the contract a caller reads without an IDE) — this is a rule
violation in the *other* direction if seen, not a missed opportunity. Also
don't flag `var` as *missing* when the right-hand side's type isn't
actually obvious at the call site (`var result = process(input);` where
`process`'s return type isn't guessable from the name) — `var` should aid
readability, not require the reader to open another file.

```java
// Important flag — never reassigned, should be final
BigDecimal total = calculateTotal(items);

// ✅ correct
final BigDecimal total = calculateTotal(items);

// Recommended flag — obvious RHS type, could be var
Map<String, Integer> counts = new HashMap<>();
// ✅
var counts = new HashMap<String, Integer>();

// ❌ never flag as missing — RHS type isn't obvious from the name alone
var result = process(input); // fine to leave as `var` if process's return is genuinely legible in context; don't demand explicit typing either way here
```

## Streams over imperative loops — and the reverse

**Flag (Important)**: a `for`/`while` loop whose entire body is a pure
map/filter/collect/reduce with no early exit, no multiple mutated
accumulators, and no interleaved side effects — this is exactly what the
Stream API expresses more directly.

```java
// Important flag
List<String> activeNames = new ArrayList<>();
for (User user : users) {
    if (user.isActive()) {
        activeNames.add(user.getName());
    }
}

// ✅ correct
List<String> activeNames = users.stream()
        .filter(User::isActive)
        .map(User::getName)
        .toList();
```

**Flag (Recommended, not Important) the reverse** — a stream pipeline forced onto logic
that's genuinely clearer as a loop: multiple side effects per iteration,
an early `break`/`return` mid-iteration, a loop that needs the index, or a
pipeline with more than one `peek()`/nested lambda just to smuggle in
control flow a loop would express directly with `if`/`break`/`continue`.
Clarity outranks the idiom either direction — a three-line stream with a
`peek()` side effect and a cast is not an improvement over a four-line
loop.

**Also flag (Important)**: unnecessary object allocation or `StringBuilder`
misses inside a loop body (concatenating with `+` across iterations
instead of a single `StringBuilder`), and streams left unclosed
(`Files.lines(path)` not in try-with-resources) — a real resource leak,
so Critical if the stream wraps an actual OS resource (file, socket) rather than
an in-memory collection.

## Records instead of Lombok POJOs for immutable data

**Flag (Important)**: a class annotated `@Data`, `@Value`, or a hand-written
getter/equals/hashCode/toString/all-args-constructor combination, used
purely as an immutable data carrier (DTO, value object, event, command,
query result) with no behavior beyond that.

```java
// Important flag
@Value
public class MoneyDto {
    BigDecimal amount;
    String currency;
}

// ✅ correct
public record MoneyDto(BigDecimal amount, String currency) {}
```

**Don't flag (this is the tolerated exception, not a violation)**: a JPA
`@Entity` using Lombok — JPA requires a mutable, proxyable class with a
no-arg constructor, which a record structurally cannot provide. Do,
however, flag `@Data` specifically on a JPA entity (see
`spring-boot3-practices.md`'s entity equality check) — the exception
covers Lombok's constructor/getter generation on entities, not `@Data`'s
auto-generated `equals`/`hashCode` on a mutable, ID-bearing entity, which
is its own, separate bug class.

**Don't flag**: Lombok already in wide use in `adapter` code the project
has standardized on, when a new class is small and consistent with
neighboring adapter classes — note it as a Recommended "could be a record"
suggestion rather than an Important rule violation in that case; this rule is strongest for new
domain/application code and for adapter DTOs, weaker as a blanket demand
to rewrite every existing adapter class in a review of unrelated changes.

## MapStruct instead of manual mapping

**Flag (Important)**: a hand-written method that copies fields one-by-one from one
type to another (an adapter mapping a JPA entity to a domain record, a
domain record to a response DTO) where the mapping is a straightforward
field-for-field copy.

```java
// Important flag
private OrderResponse toResponse(Order order) {
    return new OrderResponse(order.id().value(), order.status().name(), order.total());
}

// ✅ correct
@Mapper(componentModel = "spring")
public interface OrderResponseMapper {
    OrderResponse toResponse(Order order);
}
```

**Why**: MapStruct generates the same mapping at compile time, so it's as
fast as hand-written code (no reflection) but doesn't rot silently when a
field is added to one side and forgotten on the other — the generator
either maps it or the build warns on an unmapped target property.
MapStruct works with `record` sources/targets natively; no special
configuration needed for the plain-record case.

**Don't flag**: a "mapping" that actually contains business logic
(conditional field derivation, validation, aggregation across multiple
sources) — that belongs in the domain/application layer as real behavior,
not in a mapper of either kind; recommend extracting the logic, not just
swapping hand-written mapping for MapStruct. Also don't flag a single
one-line delegation (`toResponse` that's just `new Response(order.id())`
with one field) as needing a mapping framework — MapStruct earns its
build-time cost on multi-field mappings, not trivial wraps.

**Note on Lombok + MapStruct combined**: if the project uses Lombok's
`@Builder` on the target type, MapStruct needs the builder declared
explicitly (`@Mapper(builder = @Builder(buildMethod = "build"))`) — flag a
MapStruct mapper targeting a `@Builder`-annotated type with no such
configuration as likely to fail at build time, not just as a style note.

## Builder pattern for large/telescoping construction

**Flag (Important)**: a constructor or static factory with 4+ parameters,
especially when several are optional or the same type repeats (multiple
`String`/`boolean` parameters in a row, where a caller can pass them in
the wrong order and the compiler won't catch it).

```java
// Important flag
new ShippingRequest("123 Main St", "Springfield", "IL", "62704", true, false, null);

// ✅ correct
ShippingRequest.builder()
        .street("123 Main St")
        .city("Springfield")
        .state("IL")
        .zip("62704")
        .expedited(true)
        .build();
```

**For records specifically**: a canonical constructor with many
parameters has the same readability problem as any other constructor.
Prefer, in order: (1) split into a smaller record if some fields are
genuinely a cohesive sub-object (e.g. an `Address` record nested in the
larger one — often the better fix, since it also improves the domain
model, not just construction ergonomics), (2) a static factory method with
a descriptive name for the common case, (3) only then reach for a builder
— a record generated builder (Lombok's `@Builder` on a record, or a
record-builder code-gen library) if the project already has that
dependency, not introduced solely for one record.

**Don't flag**: a 2-3 field constructor/record, even if some fields are
optional — a builder here adds ceremony without solving a real ordering or
readability problem.

## Sealed interfaces + pattern matching for closed outcomes

**Flag (Recommended, or Important if it's actively causing bugs)**: a class with a `type`/
`status` enum field plus several nullable fields that are "only set when
type is X" — the classic pre-sealed-types workaround.

```java
// Important flag — nullable-field-per-variant anti-pattern
class OrderResult {
    OrderResultType type; // PLACED or REJECTED
    OrderId id;           // only set when PLACED
    String rejectionReason; // only set when REJECTED
}

// ✅ correct
sealed interface OrderResult permits OrderPlaced, OrderRejected {}
record OrderPlaced(OrderId id, Instant placedAt) implements OrderResult {}
record OrderRejected(String reason) implements OrderResult {}
```

Pair this with an exhaustive `switch` (no `default` branch) wherever the
result is consumed — a `default` branch on a sealed type's switch defeats
the entire point of sealing it, since the compiler can no longer force a
decision when a new variant is added; flag a `default` branch on a switch
over a sealed type as its own Important finding.

## Text blocks for multi-line string literals

**Flag (Recommended)**: multi-line strings built with `+` concatenation (SQL,
JSON payloads, formatted templates) where a text block would be both
shorter and free of escaping noise.

```java
// Recommended flag
String sql = "SELECT id, status " +
             "FROM orders " +
             "WHERE customer_id = ?";

// ✅ correct
String sql = """
        SELECT id, status
        FROM orders
        WHERE customer_id = ?
        """;
```
