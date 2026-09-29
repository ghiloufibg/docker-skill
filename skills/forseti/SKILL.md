---
name: forseti
description: Reviews already-written Java 21 (or earlier LTS) Spring Boot 3.x code against strict Hexagonal Architecture (Ports & Adapters) — the same architecture the mimir skill plans — plus modern Java 21 idioms, Spring Boot 3.x practices, and test quality. Produces a severity-ranked findings report (Critical/Important/Recommended) covering: hexagonal boundary violations (domain framework leakage, dependency direction, port ownership, adapter model leakage); Optional misuse (field/parameter vs. return-type); hand-rolled null/blank/empty checks that should use StringUtils/CollectionUtils instead; hardcoded string/number literals that should be named constants; missing final on immutable fields/locals and missed var opportunities; imperative for-loops that should be Streams (and vice versa, where a loop is clearer); manual object mapping that should use MapStruct; large/telescoping constructors that should use a builder; Lombok POJOs that should be records; Spring Boot 3.x practices (constructor injection only, ProblemDetail/RFC7807 error handling, @Transactional correctness incl. self-invocation, JPA N+1/FetchType.LAZY, @ConfigurationProperties over scattered @Value, virtual-thread pinning); test-quality anti-patterns (mocking value objects/records instead of constructing them for real, mocking static methods instead of invoking pure statics directly, mocking collaborators that aren't genuine external boundaries, missing Object Mother/Test Data Builder usage for fixtures, over-verification via mock interactions instead of real assertions, wrong test type for the layer under test — e.g. @SpringBootTest on a domain test or H2 instead of Testcontainers); and a strict zero-comments/zero-Javadoc policy, including flagging AI-generated Given/When/Then-style comments in tests. Use whenever the user asks to review, audit, critique, or find issues in already-written Java/Spring Boot code or its tests, asks "does this follow hexagonal architecture", wants a PR review for a Java service, or asks to check code or tests against modern Java 21/Spring Boot 3 best practices. Do NOT use before code exists — use the mimir skill to plan first — and do NOT use for non-Java stacks or for pure build/config file review with no Java source involved.
---

# Forseti — the Fair Verdict

Forseti sits in Glitnir and settles every dispute brought before him so
fairly, and on such plain evidence, that both sides leave reconciled — he
is called the best judge among gods and men for exactly that reason. This
skill works the same way: it reads code that already exists and renders a
verdict on it, grounded in specific evidence rather than opinion — a
framework annotation that crossed into the domain, a JPA entity that
crossed out through a port, a hardcoded literal that should have been a
constant — each finding argued from the code itself, not from taste.

Where `mimir` designs the hexagon before code exists, `forseti` judges code
against that same hexagon (and a set of Java 21 / Spring Boot 3.x idiom
rules) after it exists. Read `skills/mimir/references/hexagonal-architecture.md`
and `skills/mimir/references/java21-standards.md` first if they're available in
this repo — this skill's boundary checklist restates their rules as review
checks rather than re-deriving them, so the two skills stay consistent with
each other.

This is a **review skill, not an auto-fix skill**. It reports findings with
enough detail (file:line, rule, why, corrected snippet) that a developer or
`/sc:implement` can act on them — it does not rewrite the code itself unless
the user explicitly asks for the fix to be applied.

## The severity scale

Every finding gets exactly one of these three markers — never leave a
finding unranked, and never use a fourth tier:

- **CRITICAL** — breaks the hexagonal boundary, or is a correctness/
  security bug: domain framework leakage, dependency pointing outward, an
  adapter model crossing a port, a swallowed exception hiding a real
  failure, an N+1 or self-invocation `@Transactional` bug that will
  misbehave in production, logging secrets, unparameterized queries.
- **IMPORTANT** — violates one of this skill's hard rules but won't
  misbehave at runtime today: `Optional` used as a field/parameter,
  hand-rolled null/blank checks instead of `StringUtils`/`CollectionUtils`,
  a magic literal that should be a constant, manual mapping that should be
  MapStruct, a Lombok data POJO that should be a record, a comment or
  Javadoc block present anywhere in the reviewed code, missing `final` on
  something that's never reassigned.
- **RECOMMENDED** — a judgment call, not a rule violation: a borderline
  case for a builder, a `var` opportunity, a loop that's *arguably* cleaner
  as a stream but not clearly so.

A finding that doesn't fit any of these — "this could theoretically be
nicer" with no concrete rule behind it — doesn't belong in the report.
Evidence over vibes.

## Workflow

### 1. Inventory before judging

Before flagging anything, establish:
- **Scope**: which files/directories are actually in review (a diff, a PR,
  a directory, "this file"). Don't wander into unrelated code.
- **Layer per file**: classify each file as `domain`, `application`, or
  `adapter` by its package (see `references/hexagonal-boundary-checklist.md`
  if the project doesn't already make this obvious) — every other check
  depends on knowing which layer a file lives in, since the same code
  (e.g. a Lombok `@Data` class) is Critical in `domain` and merely worth a note
  in `adapter/out/persistence`.
- **Actual toolchain**: check the build file (`pom.xml`/`build.gradle`) for
  what's already a dependency — Lombok, MapStruct, Commons Lang3/Collections,
  Spring's own `StringUtils`/`CollectionUtils`. Recommending a library the
  project doesn't have is a suggestion ("consider introducing MapStruct"),
  never phrased as a violation of existing code. Don't invent a dependency
  requirement the codebase never opted into.
- **CI/Docker reality, before touching anything Testcontainers-related**:
  check whether this project's CI can actually run Docker — look for a
  Docker-in-Docker or `services: docker` block, a Testcontainers dependency
  already paired with a passing CI run, or any other positive signal in the
  CI config (`.github/workflows/*.yml`, `.gitlab-ci.yml`, `Jenkinsfile`,
  `azure-pipelines.yml`, `bitbucket-pipelines.yml`). **Never assume Docker
  is available** — if the signal is genuinely absent or ambiguous, ask the
  user directly rather than guessing. Get this wrong once and every
  Testcontainers-related finding in the report is a finding that would
  break the build if acted on. If Docker is confirmed unavailable, the
  Testcontainers-vs-H2 rule in `references/test-quality-checklist.md`
  Check 7 does not apply as written — its own text says what to check
  instead, and a test suite that's mostly unit tests with a small
  integration slice is the *correct* shape for that environment, not
  something to flag as a pyramid gap.

### 2. Walk the hexagonal boundary checklist first

This is the highest-severity pass — architecture violations compound, idiom
violations don't. Follow `references/hexagonal-boundary-checklist.md`, which
restates mimir's six non-negotiable rules as concrete review checks:
domain purity, dependency direction, port ownership, inbound port
granularity, adapter-model leakage, and the Java-version ceiling.

### 3. Walk the Java 21 idiom checklist

Follow `references/java21-modern-idioms.md` for: `Optional` placement,
`StringUtils`/`CollectionUtils` vs. hand-rolled checks, constants vs. magic
literals, `final`/`var`, Stream vs. imperative loops, records vs. Lombok,
builder vs. large constructors, and MapStruct vs. manual mapping. Each
subsection there states the rule, why it's a rule (not just style), and the
narrow cases where the "modern" choice is actually the wrong call — flag
those exceptions correctly too; a checklist applied without judgment
produces noise the user will start ignoring.

### 4. Walk the Spring Boot 3.x checklist

Follow `references/spring-boot3-practices.md` for: constructor injection,
`ProblemDetail`/RFC 7807 error handling, `@Transactional` correctness
(including the self-invocation proxy trap), JPA fetch strategy and N+1,
`@ConfigurationProperties` vs. scattered `@Value`, and virtual-thread
pinning hazards. Skip this section entirely for files that aren't Spring
Boot code (e.g. a pure domain record has nothing here to check).

### 5. Walk the test quality checklist

Follow `references/test-quality-checklist.md` for any `*Test.java`/
`*IT.java`/`*Tests.java` file in scope: mocking a value object/record
instead of constructing it for real, mocking a static method that's
either a pure utility (mock it never — call it) or a hidden external
boundary (flag the missing port, not just the mock), mocking a collaborator
that isn't a genuine external boundary, Object Mother/Test Data Builder
usage for fixtures instead of ad hoc inline mocks, assertions that only
verify mock interactions instead of real output/state, and the test type
matching its layer (no Spring context in a domain test, Testcontainers
over H2 for a persistence adapter test *only when step 1 confirmed Docker
is available in this project's CI*, `@WebMvcTest` over full
`@SpringBootTest` for a web-layer slice). This check applies whether the
production code under review has tests changing in the same diff or not
— if tests are in scope, they get the same rigor as production code, not
a lighter pass.

### 6. Apply the zero-comments policy

Follow `references/no-comments-policy.md`. This applies to **every file in
scope, including tests** — flag every comment and every Javadoc block found,
with special attention to AI-generated `// Given` / `// When` / `// Then`
scaffolding comments in test methods, which get their own explicit call-out
because they're the most common instance of this violation in
tool-generated code.

### 7. Write the report

Use the exact structure in `references/output-template.md`. Group findings
by severity, not by file — a developer fixing a review works top-down by
severity, not file-by-file alphabetically. Every finding names the file and
line, quotes the offending code, states which specific rule it breaks, and
shows the corrected version — a finding that says "use a constant here"
without showing the constant isn't finished.

For a review covering many files, save the report to
`claudedocs/review-<feature-or-scope>-<yyyy-mm-dd>.md` instead of only
pasting it into chat, per this project's file-organization convention. For
a single small file or a short diff, replying inline is fine — don't create
a file for three findings.

## Before delivering the report, check it against its own rules

Walk back through what got flagged and ask, per finding: *is this actually
one of this skill's rules, or is it a personal style preference dressed up
as one?* The most common self-violations: flagging `Optional` use that's
actually correct (a return type, not a field), flagging a loop that has a
`break`/early-return or multiple side effects a stream would obscure rather
than clarify, flagging Lombok on a JPA entity (which is the tolerated
exception, not the violation), recommending MapStruct/a builder for a
project that has zero mapping needs and a 2-field DTO, or flagging a mock
of an **outbound port** in a use-case test as if it were the value-object/
static-mocking violation — mocking a port is the intended seam; mocking
the domain data flowing through it is the violation. The costliest
self-violation to miss: recommending Testcontainers, or flagging its
absence, in a project whose CI can't run Docker — that isn't a defensible
finding, it's advice that breaks the pipeline, and it's exactly the
failure mode this skill exists to prevent, not produce. If step 1's
environment check was skipped or its answer wasn't actually confirmed,
go back and confirm it before the report ships with any Testcontainers
finding in it. A review that cries wolf on defensible code trains the
developer to skim past the findings that actually matter — precision
here is the entire value of the report.
