# Spring Boot 3.x practices checklist

`SKILL.md` step 4 points here. These checks only apply to `adapter` code
(and the thin `bootstrap`/`config` wiring layer) — a pure `domain` or
`application` class shouldn't have any Spring imports to check in the
first place (that's Check 1 in `hexagonal-boundary-checklist.md`; if it
fires, skip this file entirely for that class).

## Constructor injection only

**Flag (Critical)**: `@Autowired` on a field or a setter method.

**Flag (Important)**: a constructor-injected class with more than one
constructor and no `@Autowired` marking which one Spring should use.

**Why**: field/setter injection lets a class exist in a half-constructed,
untestable state (a plain `new` in a unit test leaves the field `null`),
and hides the class's real dependency count — a constructor with nine
parameters is an obvious "this class does too much" signal that field
injection buries. Constructor injection is also what makes a class
testable with a plain `new` in a JUnit test, no Spring context required —
the same reasoning `java21-standards.md` applies to adapters generally.

```java
// Critical flag
@Service
public class OrderService {
    @Autowired
    private FindOrder findOrder;
}

// ✅ correct
@Service
public class OrderService {
    private final FindOrder findOrder;

    public OrderService(FindOrder findOrder) {
        this.findOrder = findOrder;
    }
}
```

**Don't flag**: omitting `@Autowired` entirely on a class with exactly one
constructor — Spring 4.3+ infers it, and adding the annotation there is
optional style, not a rule either way; don't flag its presence or absence
on a single-constructor class.

## `ProblemDetail` / RFC 7807 for error responses

**Flag (Important)**: a hand-rolled error response DTO (`ErrorResponse`,
`ApiError`, etc.) in a Spring Boot 3.x project, when `ProblemDetail`
(Spring Framework 6+, ships with Boot 3) covers the same need with a
standardized shape.

```java
// Important flag — bespoke error shape
public record ApiError(String message, int status, Instant timestamp) {}

// ✅ correct
@ExceptionHandler(OrderNotFoundException.class)
public ProblemDetail handleNotFound(OrderNotFoundException ex) {
    ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, ex.getMessage());
    problem.setTitle("Order Not Found");
    problem.setType(URI.create("https://api.example.com/problems/order-not-found"));
    return problem;
}
```

Check that translation happens in one centralized place (a
`@RestControllerAdvice`, optionally extending `ResponseEntityExceptionHandler`)
rather than scattered `try/catch` blocks in individual controllers building
their own `ResponseEntity<ErrorDto>` per endpoint — flag the scattered
version as Important even if each individual instance is otherwise correct,
since the duplication is the actual problem.

**Don't flag**: a project that predates Boot 3 / Spring Framework 6, or
one with an established, consistent error contract already in wide client
use — migrating a public API's error shape is a breaking change decision
for the user to make deliberately, not something to flag as if it were a
bug.

## `@Transactional` correctness

**Flag (Critical)**: a `@Transactional` method called via `this.method()` from
another method in the *same* class (self-invocation). Spring's proxy-based
AOP can't intercept the call because it never goes through the proxy — the
transaction silently doesn't start. This is a correctness bug, not a style
issue, and it's easy to miss in review because the code compiles and often
appears to work until the untransacted path actually needs atomicity.

```java
// Critical flag — self-invocation bypasses the proxy, saveAll() runs with no transaction
@Service
public class OrderService {
    public void processAndSave(List<Order> orders) {
        saveAll(orders); // no transaction: called via `this`, not through the Spring proxy
    }

    @Transactional
    public void saveAll(List<Order> orders) { ... }
}
```

**Flag (Important)**: a read-only use case (a query/finder) without
`@Transactional(readOnly = true)` — this isn't just documentation, it lets
Hibernate skip dirty-checking and lets some drivers/connection pools
optimize the connection, so a missing `readOnly = true` on a pure read
path is a real, if minor, performance miss worth flagging.

**Flag (Important)**: `@Transactional` placed on a `private` method — Spring's
proxy mechanism (JDK dynamic proxies or CGLIB subclassing) cannot intercept
private methods at all, so the annotation is silently a no-op.

## JPA fetch strategy and N+1

**Flag (Important)**: an `@OneToMany`/`@ManyToMany` association without an
explicit `fetch = FetchType.LAZY` — `@OneToMany`'s default is already
`LAZY`, but `@ManyToMany`/`@ManyToOne`/`@OneToOne` default to `EAGER` and
are frequently left at the default by mistake; flag any eager association
that isn't accompanied by a stated reason (a comment-free, code-visible
reason such as the entity always being loaded with that data — not a
comment explaining it, per the zero-comments policy; state the reasoning
in the review finding itself, not as something the code should say).

**Flag (Critical if it's on a hot/list-rendering path, Important otherwise)**: a loop
that triggers one query per iteration by accessing a lazy association
inside a `for`/stream loop over a collection fetched by a separate query —
the classic N+1. Recommend a fetch join (JPQL `JOIN FETCH`), an
`@EntityGraph`, or a batch-fetch size, named specifically for the query in
question, not just "fix the N+1" as a generic note.

**Flag (Important)**: bidirectional `@OneToMany`/`@ManyToOne` associations
without a clear reason both directions are actually navigated by the code
— an unused inverse side adds synchronization burden (both sides must be
kept consistent on every mutation) for no benefit.

**Flag (Critical)**: `equals`/`hashCode` on a JPA entity generated from all
fields (Lombok `@Data`/`@EqualsAndHashCode` with no exclusions), when the
entity has a database-generated identity. Before persistence, `id` is
`null` on every instance, so field-based equality either treats all new
entities as equal to each other or changes an entity's equality the moment
it's saved (breaking it as a key in any `Set`/`Map` used before and after
persistence). Use a stable business key, or identity-based equality scoped
to non-null-after-load IDs, explicitly — never `@Data`'s default on an
entity.

## `@ConfigurationProperties` over scattered `@Value`

**Flag (Recommended, or Important if the same prefix is repeated across 3+ `@Value`
injections)**: several `@Value("${some.prefix.*}")` fields scattered
across different classes for what is really one cohesive configuration
group.

```java
// Important flag — same "orders." prefix scattered across unrelated classes
@Value("${orders.retry.max-attempts}") private int maxAttempts;
@Value("${orders.retry.backoff-ms}") private long backoffMs;

// ✅ correct — one typed, validated group
@ConfigurationProperties("orders.retry")
public record OrderRetryProperties(int maxAttempts, long backoffMs) {}
```

Records work naturally as `@ConfigurationProperties` targets in Boot 3.x
(constructor binding) — recommend the record form over a mutable
`@ConfigurationProperties` class with setters.

## Virtual threads (if enabled)

Only check this section when the project has `spring.threads.virtual.
enabled=true` or otherwise clearly opts into virtual threads (Java 21,
JEP 444) — otherwise skip it.

**Flag (Important)**: a `synchronized` block or method on a request-path class
that will run on a virtual thread — `synchronized` pins the virtual thread
to its carrier platform thread for the block's duration, eliminating the
scalability benefit for that path. Recommend `ReentrantLock` instead.

**Flag (Recommended)**: a `ThreadLocal` used for per-request state on a codebase
that has enabled virtual threads — not wrong, but worth a note that a
`ThreadLocal`'s lifecycle assumptions (one thread per request, cleared at
request end) still need to hold; virtual threads don't break `ThreadLocal`
by themselves, but high-cardinality virtual-thread-per-request usage makes
a forgotten `ThreadLocal.remove()` a larger leak surface than it was with
a bounded platform-thread pool.

**Don't flag**: connection pool sizing as if virtual threads changed it —
flag the *opposite* mistake if seen: a connection pool sized up to match
an assumed higher virtual-thread concurrency. The downstream resource
(the database's own connection limit) didn't get any cheaper just because
the calling side did; a pool sized for "lots of virtual threads" without
regard to what the database can actually sustain is itself a finding.

## Bean Validation over manual null checks on inbound DTOs

**Flag (Important)**: a controller method manually checking `if (request.name()
== null || request.name().isBlank())` on a request body, when a Bean
Validation annotation (`@NotBlank`, `@NotNull`, `@Size`, ...) on the
request record plus `@Valid` on the controller parameter expresses the
same constraint declaratively and gets enforced before the method body
even runs.

## Logging hygiene

**Flag (Critical)**: a log statement including a password, token, full card
number, or other secret/PII field directly (`log.info("login attempt:
{}", request)` where `request` includes a raw password field via its
`toString()`).

**Flag (Important)**: string concatenation in a log call (`log.info("order " +
id + " failed")`) instead of parameterized logging
(`log.info("order {} failed", id)`) — concatenation always builds the
string even when the log level is disabled; parameterized logging defers
that cost.

## Exception handling

**Flag (Critical)**: an empty `catch` block, or a `catch (Exception e) {}` /
`catch (Throwable t) {}` that swallows the error with no rethrow, no
logging, and no translation to a domain-meaningful outcome.

**Flag (Important)**: `catch (Exception e)` (or broader) where a specific
exception type is known and catchable — catching broader than necessary
risks silently absorbing an unrelated bug (a `NullPointerException` from a
real defect) under the same handling meant for an expected failure (an
`IOException` from a flaky downstream call).
