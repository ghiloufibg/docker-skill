# Naming checklist

`SKILL.md` step 3 points here. Under the zero-comments policy the name is
the only documentation, so a name must say what the business calls the
thing and what it is for (the DDD ubiquitous language). `mimir` states the
same standard for design; this checklist catches it drifting in the code.

## The evidence rule

A naming finding must name a **better name and where the term comes from**:
the code's own domain vocabulary, the ticket or documents the work came
from, or the plan's glossary. If no business term can be pointed to, do not
file a finding — "this could be named better" with no term behind it is
taste, not a rule. Never invent a term the business doesn't use.

## Check 1 — Business words, not generic ones

**Rule**: classes, records, methods, fields, parameters and variables in
`domain` and `application` use the business's vocabulary.

Flag generic or mechanical names where a domain term exists: `Manager`,
`Helper`, `Util`, `Processor`, `Handler`, `Data`, `Info`, `Item`, `Object`,
and methods like `process`, `handle`, `doIt`, `check`. A use-case port's
single method (`execute` or the use case's verb) is not a finding — the
interface name carries the intent.

**Finding template**: `<Name> says nothing about <business concept> —
rename to <term>, the word <source> uses for it.`

## Check 2 — Behaviour is a business verb

**Rule**: operations on the domain are named for what the business does.

Flag `update`, `set`, `change`, `modify` methods in `domain`/`application`
that hide a business operation (`order.setStatus(CANCELLED)` is
`order.cancel()`). A persistence adapter's `save`/`find` is correct — that
layer is technical.

**Finding template**: `<method> hides the business operation <verb> —
rename to <verb> and move the state change behind it.`

## Check 3 — Technical names stay in adapters

**Rule**: `Entity`, `Dto`, `Model`, `Bean`, `Impl`, `Abstract`, `Base`,
and table- or column-derived names appear only in `adapter` packages.

Flag them in `domain` or `application`. Inside an adapter they are correct
(`OrderJpaEntity`, `OrderRequestDto`) and are not findings. An `Impl`
suffix on a use-case class is Recommended: name it for what it does.
Port naming (technology-named ports) is Check 3 of the hexagonal boundary
checklist — report it there, not twice.

**Finding template**: `<Class> in <layer> carries the technical name
<suffix> — name it <term> and keep the technical name on the adapter model
that maps to it.`

## Check 4 — One concept, one name

**Rule**: a concept has one name across the scope under review.

Flag synonym drift with evidence: both names appear in the reviewed scope
for the same concept (`Customer` and `Client`, `cancel` and `abort`), and
name which one the business uses.

**Finding template**: `<A> and <B> both denote <concept> (<file:line>,
<file:line>) — use <term>, the word <source> uses.`

## Check 5 — Variables and tests reveal intent

**Rule**: local names and test names say what they hold or prove.

Flag, as Recommended unless the confusion is real: `data`, `temp`, `obj`,
`val`, `result`, `list`, single letters outside a tiny scope; test names
like `test1` or `testCancel` that don't state the behaviour in business
terms (`cancelledOrderCannotBeShipped`). Raw `String`/`long` parameters for
a domain concept with rules (`String email`, `long orderId`) are a
Recommended note to use a named value object.

## Not findings

Loop indices and lambda parameters in a one-line scope; names a framework
requires (`main`, `*Application`, `*Configuration`, `@Bean` method names);
generated code; mapper methods like `toDomain`/`toEntity`; abbreviations
the business itself uses (`VAT`, `IBAN`); and names fixed by an existing
schema or public contract.

## Severity

Checks 1–4 with a concrete better name: **Important**. Check 3's `Impl`
suffix and everything in Check 5: **Recommended**. Naming alone is never
Critical. Group repeated hits into one finding with an `Also at:` list, per
the output template.

## In plan mode

The same checks apply to planned class, method and field names, and to the
plan's glossary if it has one: a name in the plan that fails these checks
will be copied into the code.
