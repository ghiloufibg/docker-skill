# Unit-test conventions

`SKILL.md` step 6 and the execute phase point here. Only `UNIT` cases use this
file. These tests may end up in the service's repository and run in CI, where
Docker is not available. They are pure unit tests.

## What a unit test here may and may not do

May: instantiate the class under test and real value objects, replace its
outbound ports with doubles, inject a fixed clock and a seeded random source,
assert on return values, thrown exceptions and interactions with ports.

May not: start a container, use Testcontainers, open a socket or connect to a
database, a broker or an HTTP endpoint, load a Spring context
(`@SpringBootTest`, `@DataJpaTest`, `@WebMvcTest`), use `Thread.sleep`, read a
real clock, or depend on test order or on machine state.

A candidate that would need any of those is not a unit test. Send it back to
triage as `LIVE` or `NOT-TESTABLE`.

## Match the repo

Before proposing anything, read the existing unit tests and copy:

- location (`src/test/java/...` mirroring the main package) and the package of
  neighbours
- naming of classes (`*Test`) and methods (behavior-style names)
- runner and assertion library (JUnit 5, AssertJ or Hamcrest), mocking library
  (Mockito or none), fakes and builders already present
- tags or categories used to split unit from other tests
- how the build runs them (Surefire, Gradle `test`)

If the repo has no unit tests, propose a layout and flag it as a decision for
the user. Do not add a dependency or a plugin; if one is needed, it is a
decision the user approves in the plan.

## Quality bar

- One behavior per method, named for that behavior (`rejectsAmountAboveLimit`,
  not `test1`).
- Arrange, Act, Assert separated by blank lines. No comments, no Javadoc in
  test code.
- Real value objects and records; never mock them. Mock only an external
  boundary (an outbound port). Prefer a simple in-memory fake of an outbound
  port over a mock when the port has more than a couple of calls.
- Inject time and randomness. No sleeps.
- No logic (loops, conditionals) in assertions beyond what a parameterized
  test provides. Use parameterized tests for permutations.
- If the `forseti` skill is available, its test-quality checklist is the
  reference for this bar.

## What the plan gives per unit test

```
T3  Rounding rule at the half-cent boundary
  Why not live:   40 combinations of amount and tax rate; the live API takes
                  one at a time and does not expose the intermediate value
  Class under test: com.acme.orders.domain.PriceCalculator
  Proposed path:  src/test/java/com/acme/orders/domain/PriceCalculatorTest.java
  Doubles:        none (pure); TaxRatePolicy fake returning the rate under test
  Cases:          parameterized: (amount, rate) -> expected total
  Method name:    roundsHalfCentUpOnTotal
  Expect:         totals match the requirement table [U2]
```

Signatures and data, never test bodies, in the plan.

## At execution

1. Write the file at the proposed path, copying the neighbours' style.
2. Run only the new test class with the repo's build tool, for example
   `mvn -q -Dtest=PriceCalculatorTest test` or
   `gradlew test --tests com.acme.orders.domain.PriceCalculatorTest`
   (use `mvnw`/`gradlew` if the wrapper exists; on Windows `.cmd`).
3. Check statically that the new file imports nothing from Testcontainers,
   Spring test slices, socket or HTTP-client classes (`java.net.Socket`,
   `java.net.http`, `HttpURLConnection`, OkHttp, Apache HttpClient) or JDBC.
   `java.net.URI` and similar pure types are fine. If it does, fix the test.
4. Then run the module's unit suite to confirm nothing else broke.
5. Leave the files unstaged. Report their paths.

A unit test that fails is diagnosed per `bug-triage.md`: either the test is
wrong, or the code violates the requirement, which is a bug and is reported. The
test is kept as written in the second case, so the user can see it fail.
