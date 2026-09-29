# Test quality checklist

`SKILL.md` step 5 points here. Applies to unit and integration tests
alike, for both the domain/application layer's own test suite and any
adapter tests. This file is about **what the tests actually verify and
how they're built** — the zero-comments policy in `no-comments-policy.md`
still applies on top of everything here and isn't repeated in this file.

## Core rule: mock the boundary, not the code you're testing

The single principle every check below is a specific case of: **a test
double replaces something the system under test doesn't own and can't
control in a test — an external boundary — not something the system under
test *is*.** If a class needs a mock to instantiate a plain value it
already owns, that's not a testing problem, it's a design signal that the
class is coupled to something it shouldn't be.

## Check 1 — Never mock value objects, records, or domain data

**Flag (Important, escalate to Critical if the mocked object's stubbed behavior
duplicates real domain logic)**: `Mockito.mock(SomeRecord.class)`,
`mock(Money.class)`, `mock(OrderId.class)` — anything mocking a class
whose entire purpose is to carry data, with no meaningful collaboration
behavior of its own.

**Why**: a value object is cheap and safe to construct for real — that's
the entire point of it being a value object. Mocking one buys nothing
(there's no external dependency being isolated) and costs real
correctness: a mocked `Money` doesn't exercise its actual `equals`,
compact-constructor validation, or arithmetic, so the test now verifies
that the mock returns what it was told to return, not that the code
behaves correctly with real data. As the Mockito project's own testing
guide puts it: needing to mock something because "constructing the real
object is too painful" is a signal to fix the construction path (a
builder, a factory, an Object Mother — see Check 3), not to mock it.

```java
// Important flag
Order order = mock(Order.class);
when(order.total()).thenReturn(Money.of(100, "USD"));

// ✅ correct — construct the real value
Order order = anOrder().withTotal(Money.of(100, "USD")).build();
```

## Check 2 — Only mock genuine external boundaries

**Flag (Important)**: a test mocking a collaborator that has no external
dependency of its own — a domain service, a pure mapper, a validator with
no I/O — instead of just invoking it for real.

**Don't flag**: mocking an **outbound port** (`SaveOrder`, `FindOrder`,
`PublishOrderEvent`) in a use-case test — this is the correct, intended
seam in a hexagonal design; mimir's own testing-strategy table prefers a
hand-written in-memory **fake** over a mocking framework here when the
port is simple, precisely because a `Map`-backed fake exercises more real
behavior (state, repeated calls, `find`-after-`save`) than a stubbed
mock — recommend a fake over a Mockito mock for outbound ports with more
than a couple of trivial calls, but don't flag a straightforward mock of
an outbound port as wrong on its own.

**The dividing line to apply**: genuine external boundaries worth a test
double are things the system under test cannot control deterministically
in-process — a database, an HTTP client, a message broker, the filesystem,
the system clock, a random/ID generator, another microservice. Anything
else in the call graph that's part of *this* codebase's own logic should
run for real in the test, even if that means the test exercises two or
three classes together rather than one in total isolation — a unit test
that mocks every single collaborator down to the last pure function is
the "Mockery" anti-pattern: so much of the test is mock setup that the
test ends up validating the mocks' own scripted answers, not the code.

```java
// Important flag — mocking a pure, in-process collaborator with no I/O
@Test
void shouldCalculateTotal() {
    PricingPolicy pricingPolicy = mock(PricingPolicy.class);
    when(pricingPolicy.apply(any())).thenReturn(Money.of(90, "USD"));
    // ... this test now validates the mock's answer, not PricingPolicy's real rule

// ✅ correct — real collaborator, mock only the actual external port
@Test
void shouldCalculateTotal() {
    var pricingPolicy = new StandardPricingPolicy(); // real, pure, no I/O — just use it
    var findOrder = mock(FindOrder.class); // real external boundary — mock or fake this
```

## Check 3 — Real objects with realistic test data, not scattered mocks

**Flag (Important)**: test setup that hand-builds an object's mock/stub instead
of constructing the real type, when the real type is cheap to construct
(any domain record, value object, or simple aggregate).

**Recommend, in this order of preference**:
1. **Object Mother** — a small class of named static factory methods that
   build ready-to-use, realistic instances for common scenarios
   (`anActiveCustomer()`, `anOrderPendingPayment()`). Cheapest to start
   with, and reads very clearly at the call site.
2. **Test Data Builder** — once an Object Mother's methods start growing
   parameters, or tests need to override just one or two fields off a
   sensible default, switch to a fluent builder per type
   (`anOrder().withStatus(PENDING).withTotal(Money.of(0, "USD")).build()`).
   This avoids the Object Mother's known failure mode: it either grows a
   combinatorial explosion of near-duplicate factory methods (one per
   field combination a test happens to need) or gets refactored into
   fine-grained pieces that individually do almost nothing, and callers
   end up composing them anyway — a builder gives the same composability
   without the sprawl.

Flag an existing Object Mother that has visibly hit this failure mode
(many single-use, oddly-specific factory methods added over time,
e.g. `anOrderWithThreeItemsAndOneDiscount()`) as a Recommended suggestion to
migrate that type to a builder — not Important, since the Object Mother
methods still work, they're just no longer the best tool.

```java
// ✅ Object Mother — good for a handful of common, named scenarios
public final class OrderMother {
    public static Order anOrderPendingPayment() {
        return new Order(OrderId.generate(), OrderStatus.PENDING, Money.of(50, "USD"));
    }
    private OrderMother() {}
}

// ✅ Test Data Builder — good once tests need to vary individual fields
public final class OrderTestDataBuilder {
    private OrderStatus status = OrderStatus.PENDING;
    private Money total = Money.of(50, "USD");

    public static OrderTestDataBuilder anOrder() { return new OrderTestDataBuilder(); }
    public OrderTestDataBuilder withStatus(OrderStatus status) { this.status = status; return this; }
    public OrderTestDataBuilder withTotal(Money total) { this.total = total; return this; }
    public Order build() { return new Order(OrderId.generate(), status, total); }
}
```

**Don't flag**: inline construction of a trivial value with one or two
fields directly in the test (`Money.of(10, "USD")`) — a builder/mother for
something that small is ceremony, not a fix.

## Check 4 — Never mock static methods that aren't a real external boundary

**Flag (Critical)**: `Mockito.mockStatic(...)` (or PowerMock's equivalent) used
on a pure/utility static method — `StringUtils`, `CollectionUtils`, a
domain factory method, a math/formatting helper. Call the real static
method; it's deterministic and has no external dependency to isolate.

**Flag (Critical) the design, separately from the test**: `mockStatic` used to
stand in for a static method that *does* wrap a real external boundary —
a legacy static HTTP client, a static file-system helper, a static
"current time" getter. Mocking static state widens the mocked scope to
the entire class for the duration of the test (a static mock is global,
not scoped to one instance), which is exactly the kind of test-isolation
risk that gets worse as the suite grows, and it's a sign the static call
should never have been static: wrap it behind an outbound port (an
injectable interface, per the hexagonal boundary rules) so the real
production code calls an interface and the test supplies a fake or mock
implementation the ordinary way. Flag both: the immediate `mockStatic`
call in the test, and the missing port in the production code it's
compensating for.

```java
// Critical flag — mocking a pure static utility
try (MockedStatic<StringUtils> mocked = mockStatic(StringUtils.class)) {
    mocked.when(() -> StringUtils.isBlank(anyString())).thenReturn(true);
    // just call StringUtils.isBlank("") for real — it's a pure function
}

// Critical flag (both the test AND the production design) — static wrapping a real boundary
try (MockedStatic<LegacyPaymentGatewayClient> mocked = mockStatic(LegacyPaymentGatewayClient.class)) {
    mocked.when(() -> LegacyPaymentGatewayClient.charge(any())).thenReturn(Result.ok());
}
// fix: define ChargePayment as an outbound port, inject it, mock/fake the interface instead
```

## Check 5 — Don't mock a type the codebase doesn't own

**Flag (Important)**: a test mocking a third-party SDK class directly (a cloud
SDK client, an ORM's session/entity manager, an HTTP library's response
type) instead of mocking a thin adapter interface this codebase defines
around it.

**Why**: mocking a third-party type couples the test to that library's
exact method signatures and behavior assumptions — when the library
upgrades and changes a method's contract, the test's mock still returns
whatever it was told to, silently drifting from what the real library
now does. Wrapping the third-party call behind an owned port/adapter
(the same pattern the hexagonal boundary rules already require for
outbound dependencies) means the mock is of a type this codebase defines
and controls, and the one place that actually talks to the third-party
type gets verified by an integration test instead (Check 7), where it
matters.

## Check 6 — Assertions verify behavior/state, not mock configuration

**Flag (Important)**: a test whose only assertions are `verify(mock).method(...)`
calls with no assertion on the system under test's actual output or
resulting state — this proves the code called a method, not that the
method call produced a correct outcome.

**Don't flag**: `verify(...)` used *alongside* a state/outcome assertion,
or used specifically to confirm a side-effecting call happened when that
call *is* the behavior being tested (e.g. verifying `PublishOrderEvent`
was called with the right event, in a use case whose entire job is to
publish that event) — interaction verification is correct and necessary
for commands with no other observable return value; it's only a problem
when it's the *only* thing establishing correctness for a test that could
also check real output.

## Check 7 — Match the test type to what it verifies

**Flag (Important)**: a `domain`/`application`-layer test carrying `@SpringBootTest`
or any Spring context bootstrap — these layers have no framework
dependency to test (per the hexagonal boundary rules) and should run as
plain JUnit 5, no container, no context, milliseconds not seconds.

**Before applying the next rule, confirm Docker/Testcontainers actually
runs in this project's CI** — per `SKILL.md` step 1's environment check.
Getting this wrong isn't a harmless false positive: it's a finding that,
if acted on, produces a test suite that's green locally and red (or
simply unable to run) in CI. If the check in step 1 didn't already
establish this, ask before flagging anything in this rule rather than
assuming Docker is available.

**If Docker is confirmed available in CI — flag (Important)**: a persistence-
adapter test using an in-memory database (H2) standing in for the
production database engine, rather than Testcontainers running the real
engine — in-memory substitutes diverge from real engines on exactly the
things worth testing at this layer (constraint enforcement, dialect-
specific SQL, locking behavior).

**If Docker is confirmed unavailable in CI — do not flag H2, an in-memory
substitute, or a persistence adapter covered only by unit tests against a
fake outbound port.** That shape is the deliberate, correct trade-off for
this environment, not a gap to close, and a test suite that's mostly unit
tests with a small integration slice is exactly what that trade-off looks
like — don't recommend "add more integration tests" as a finding here
without first confirming there's somewhere for them to run. Never
recommend introducing `Testcontainers`, `@Testcontainers`, or any
Docker-dependent test infrastructure as a "fix" in this case — that
recommendation is itself the bug this environment check exists to
prevent: code that reads correct in review and breaks the pipeline it
has to run in. Two things are still worth a Recommended note, not an
Important finding, in this situation:
- Note, once, in the review's summary — not as a per-file finding — that
  H2's divergence from the production engine (specific `CHECK`
  constraints, JSON columns, engine-specific functions/locking behavior,
  whichever are actually relevant to the code under review) is an
  accepted residual risk given the CI constraint, not something the
  developer is expected to solve in this review.
- If the project has no separate lane at all for real-engine testing
  (a manually-triggered workflow, a nightly job, a different runner tier
  with Docker access) and the adapter under review has meaningfully
  engine-specific behavior, suggest that lane as a Recommended process
  improvement — phrased as an option for the team to decide on, not as a
  blocking finding on this review.

**Flag (Recommended, only when Docker is confirmed available)**: a Testcontainers-
based test not using Spring Boot 3.1+'s `@ServiceConnection` for wiring
(manual `@DynamicPropertySource` plumbing where `@ServiceConnection`
would do it declaratively), or a container declared `static` without
being shared/reused across the test class — restarting a container per
test method is a real, avoidable slowdown. The example below shows what
"good" looks like *in a project whose CI can run Docker* — it isn't a
target to migrate toward in a project that can't.

```java
// ✅ correct — modern Testcontainers + Spring Boot 3.1+ wiring
@Testcontainers
@SpringBootTest
class OrderPersistenceAdapterIT {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine");
    // container starts once, Testcontainers' JVM shutdown hook stops it — no manual lifecycle needed
}
```

**Flag (Important)**: an `adapter/in/web` test using `@SpringBootTest` (full
context) where `@WebMvcTest` (a slice test, with the use case's inbound
port mocked) would isolate the same HTTP-layer concern — status codes,
serialization, validation — without paying for a full application
context on every run.

## Check 8 — Test independence and naming

**Flag (Important)**: tests that depend on execution order, share mutable state
via a static/instance field across test methods without resetting it, or
depend on a previous test's side effect (a row left in a shared
Testcontainers database by an earlier test method with no cleanup)
— FIRST's "Independent" and "Repeatable" properties: a test suite where
tests must run in a specific order, or that behaves differently in CI
than locally, has already lost the property that makes automated tests
trustworthy.

**Flag (Recommended)**: a test named `test1`, `testOrder`, or otherwise not stating
the behavior and condition being verified — prefer
`shouldRejectOrder_whenInventoryInsufficient` or
`rejectsOrderWhenInventoryInsufficient` (either underscore-scenario or
camelCase-sentence style is fine; consistency within the suite is what
matters) over a name that only states the method under test.

## What "good" looks like — a worked example

```java
class PlaceOrderUseCaseTest {

    private final FakeOrderRepository orderRepository = new FakeOrderRepository(); // fake > mock for a stateful port
    private final FixedClock clock = new FixedClock(Instant.parse("2026-01-01T00:00:00Z")); // real boundary, fake it
    private final PlaceOrderUseCase useCase = new PlaceOrderUseCase(orderRepository, clock);

    @Test
    void placesOrderWhenInventoryAvailable() {
        var request = anOrderRequest().withQuantity(2).build(); // real value, built via test data builder

        var result = useCase.place(request);

        assertThat(result).isInstanceOf(OrderPlaced.class);
        assertThat(orderRepository.findById(((OrderPlaced) result).id()))
                .hasValueSatisfying(saved -> assertThat(saved.status()).isEqualTo(OrderStatus.PLACED));
    }
}
```

Nothing here mocks a value object (`OrderRequest`, `Money`, `OrderId` are
all real). The one genuine external dependency the use case has — the
clock — is faked, not mocked, because the test cares about its actual
value being used consistently, not just that `now()` was called. The
assertion checks real resulting state via the fake repository, not a
`verify()` call on a mock.
