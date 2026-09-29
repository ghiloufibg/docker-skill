# Hexagonal boundary checklist

`SKILL.md` step 2 points here. These six checks mirror mimir's six
non-negotiable design rules — mimir designs them in *before* code exists,
this checklist catches them when they've drifted in *after*. Every
violation found here is CRITICAL: an architecture violation isn't a
style nit, it's the thing that turns "swap Postgres for DynamoDB" from an
adapter-only change into a domain-wide rewrite.

## Check 1 — Domain purity

**Rule**: nothing in a `domain` package imports anything outside the JDK.

Grep the imports of every file under `domain/` (or the project's
equivalent) for:
- `org.springframework.*` (any Spring annotation, including something as
  innocuous-looking as `@Component` or `@Value` on a domain class)
- `jakarta.persistence.*` / `javax.persistence.*` (`@Entity`, `@Table`,
  `@Column`, `@Id` — any JPA annotation)
- `com.fasterxml.jackson.*` (`@JsonProperty`, `@JsonIgnore` — Jackson
  annotations imply the domain type is also being used as a wire format,
  which is exactly the leak this rule prevents)
- Any logging framework (`org.slf4j.*`, `java.util.logging.*`) — a domain
  object that logs is a domain object with a side effect and a framework
  dependency both

**Finding template**: `<Class> in domain imports <package> — <annotation/
class> is a <framework> dependency. Move the annotated version to
adapter/{in,out}/<technology> and keep <Class> as a plain record/class with
zero imports outside java.*`.

## Check 2 — Dependency direction

**Rule**: `adapter → application → domain`, never the reverse, and never a
skip-level `adapter → domain` that bypasses `application` for something
that should have gone through a use case.

Check every file's imports for a domain class importing from `application`
or `adapter`, or an `application` class importing from `adapter`. A
same-package or same-module import is fine; the direction only matters
across the `domain`/`application`/`adapter` boundary itself.

Also check for **adapters calling each other's internals directly** instead
of going through the application layer (e.g. a web controller reaching
into a persistence adapter's repository bean because "it was already
there") — this is the dependency-direction violation in adapter clothing.

**Finding template**: `<Class> in <inner layer> imports <Class> from
<outer layer> — dependencies must point inward only. If <inner layer>
needs this capability, define/use a port instead of importing the concrete
type.`

## Check 3 — Port ownership and shape

**Rule**: ports are interfaces defined in `application.port.{in,out}`,
named for what the domain/use case needs, not for what the adapter's
technology looks like.

Flag:
- An outbound port named after a persistence technology or table
  (`OrderRepository`, `OrderJpaRepository`) rather than a domain need
  (`FindOrder`, `SaveOrder`).
- A port interface defined *inside* an adapter package and implemented by
  the application layer — ownership is backwards; the core defines the
  contract, the adapter satisfies it.
- A "fat" outbound port with query methods nothing in the current use
  cases actually calls ("we'll probably need it") — each unused method is
  a method the domain didn't ask for, defined for the adapter's
  convenience instead of the use case's need.

**Finding template**: `<Port> is named/shaped for <technology>, not for
what <UseCase> actually needs — rename to <need-based name> and drop
unused methods <list>, or confirm each is called by a real use case.`

## Check 4 — One inbound port per use case

**Rule**: a use case's public entry point is a narrow, single-purpose
inbound port, not a shared multi-method service interface.

Flag an inbound port (or the interface an adapter depends on) with more
than one or two methods representing genuinely different use cases rather
than overloads of the same one — a `40`-method `OrderService` interface
that every controller endpoint depends on is a violation of interface
segregation even if each method's internals are otherwise fine, because
now every consumer recompiles/redeploys against a surface it mostly
doesn't use.

**Finding template**: `<Interface> bundles <N> unrelated use cases behind
one interface — split into one inbound port per use case (<name each>) so
each adapter depends only on what it actually invokes.`

## Check 5 — Adapters never leak their models past the port

**Rule**: a JPA `@Entity`, a REST request/response DTO, a generated HTTP
client model — none of these are ever a port's parameter or return type.

Flag any port method (inbound or outbound) whose signature includes a
class annotated `@Entity`, a class in a `*.dto`/`*.request`/`*.response`
package, or a class generated from an OpenAPI/gRPC/WSDL spec. The fix is
always the same: an explicit mapper at the adapter edge (hand-written,
MapStruct, or otherwise — see `java21-modern-idioms.md`) that converts to/
from the domain record before the port is called.

**Finding template**: `<Port>.<method> takes/returns <AdapterModel>,
crossing the boundary with an adapter type — add a mapper in <adapter
package> that converts to/from <DomainType> before calling this port,
even though the fields are currently identical.`

## Check 6 — No Java feature newer than 21

**Rule**: nothing in the codebase uses a language feature that shipped
after JDK 21, and no *preview* feature (structured concurrency, JEP 453)
is used as if it were a stable default without an explicit, visible
`--enable-preview` acknowledgment and a note on why the team accepted that
risk.

Flag: unnamed variables/patterns (`_`), the class-file API, stream
gatherers, scoped values used as finalized (all Java 22+), or any
`--enable-preview` flag in the build file that isn't called out in a
comment-free way the team clearly opted into (a build file property is
configuration, not a domain comment — this check is about the language
feature, not about the zero-comments policy).

**Finding template**: `<file>:<line> uses <feature>, introduced in
Java <version> — this project targets Java 21; replace with
<21-compatible equivalent>.`
