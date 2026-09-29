# Zero-comments policy

`SKILL.md` step 6 points here. This is this skill's own invariant, stated
explicitly because it's stricter than a general-purpose default: **every
comment and every Javadoc block found in reviewed code is a finding, with
no exception list.** This applies to production code and test code alike.

## Why this rule is absolute here, not "when non-obvious"

A general-purpose "only comment the non-obvious WHY" guideline still
leaves room for judgment about what counts as non-obvious — and that
judgment gap is exactly where comments accumulate over time, drift out of
sync with the code they describe, and stop being trustworthy. This skill
takes the stricter position on purpose: if a piece of code needs a comment
to be understood, the finding is about the code's clarity (an unclear
name, a function doing too much, a magic value that should be a named
constant — see `java21-modern-idioms.md`), not about the missing comment.
Fix the code; don't caption it.

## What to flag

- **Any `//` line comment**, anywhere, for any reason.
- **Any `/* ... */` block comment.**
- **Any Javadoc `/** ... */` block** — on classes, methods, fields,
  packages (`package-info.java`), regardless of how "professional" it
  reads. A well-written Javadoc block is still a Javadoc block; this rule
  is not about tone, it's about presence.
- **Commented-out code** — always Critical regardless of the general rule's
  severity, since it's not documentation at all, it's dead code hiding in
  a comment, which is strictly worse than either deleting it or keeping it
  live.
- **`// TODO` / `// FIXME` markers** — flag at Critical: an unresolved TODO in
  code under review means the code isn't actually finished, which is a
  completeness problem independent of the comment itself.

## Special case: AI-generated test scaffolding comments

Flag explicitly and by name when found — this is by far the most common
source of this violation in code produced by AI coding tools, so it earns
its own callout rather than being just another instance of "a comment was
found":

```java
// Critical flag — AI-generated Given/When/Then scaffolding
@Test
void shouldRejectOrderWhenInventoryInsufficient() {
    // Given
    var order = anOrderWithQuantity(10);
    var inventory = anInventoryWithStock(5);

    // When
    var result = useCase.place(order, inventory);

    // Then
    assertThat(result).isInstanceOf(OrderRejected.class);
}
```

The fix is never to reword the comments — it's to delete them and let the
test's **name** and its **arrange/act/assert structure via blank lines and
well-named local variables** communicate the same structure without prose:

```java
// ✅ correct — structure communicated by naming and whitespace, not comments
@Test
void shouldRejectOrderWhenInventoryInsufficient() {
    var order = anOrderWithQuantity(10);
    var inventory = anInventoryWithStock(5);

    var result = useCase.place(order, inventory);

    assertThat(result).isInstanceOf(OrderRejected.class);
}
```

Also flag other AI-tool tells in the same family if present: a comment
that just restates the next line in English (`// create the order` above
`var order = new Order(...)`), a comment marking which section of a large
method is "the validation part" / "the mapping part" (the fix is to
extract that section into a well-named private method, not to keep the
comment as a label), and file-level banner comments separating a class
into labeled regions.

## What replaces the comment

Every finding in this file pairs with a code-shape fix, not a rewording:

| Instead of a comment explaining... | Do this |
|---|---|
| What a block of code does | Extract it into a private method with a name that says what it does |
| Why a variable holds this value | Name the variable for what it represents, not `temp`/`result`/`data` |
| Which test phase a block belongs to | Blank line between arrange/act/assert; a descriptive test method name |
| A non-obvious business rule | A named constant, a well-named guard clause, or (if genuinely complex) a small domain method whose name states the rule |
| A workaround for a library/framework quirk | Still don't comment it here — if the workaround is genuinely load-bearing and would confuse a future maintainer without explanation, that's a signal for the PR description or a commit message, not the source file, under this skill's rule |

## The one thing this file does not cover

License/copyright header blocks required by legal or organizational policy
are a distinct category (metadata, not an explanation of the code) and are
outside this skill's scope to flag or clear — if a project has one, note
it exists and move on; don't spend a finding on it either way.
