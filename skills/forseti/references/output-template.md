# Output template

`SKILL.md` step 7 says to use this structure exactly. Every finding must
be concrete — a real file, a real line, real code quoted from the file
under review, and a real corrected snippet. A finding that just cites a
rule name without showing the actual offending line isn't finished.

```markdown
# Code Review: <Scope — file/PR/feature name>

## Summary
<One paragraph: what was reviewed, how many files, and the headline —
e.g. "3 files reviewed. 1 hexagonal boundary violation, 6 idiom findings,
2 Spring Boot findings. Comments present in 2 of 3 files.">

| Severity    | Count |
|-------------|-------|
| Critical    | <N>   |
| Important   | <N>   |
| Recommended | <N>   |

## Critical

Findings that break the hexagonal boundary or are correctness/security
bugs. Address before merge.

### <Short title>
**Location**: `<file>:<line>`
**Rule**: <which checklist rule, e.g. "Hexagonal boundary — Check 1: domain purity">

```java
<offending code, quoted as-is>
```

**Why**: <one or two sentences, specific to this code, not a generic
restatement of the rule>

**Fix**:
```java
<corrected code>
```

(repeat for each Critical finding)

## Important

Findings that violate one of this skill's hard rules but won't misbehave
at runtime today. Address before merge unless the team explicitly accepts
the trade-off.

(same structure as Critical, one subsection per finding)

## Recommended

Judgment calls, not rule violations. Worth considering, not blocking.

(same structure as above — these can be slightly more compact if the fix
is self-evident from the diff)

## Strengths
<Optional but recommended for any review with Critical/Important findings:
one or two sentences naming something the code does well and consistent
with the rules in this skill — e.g. correct port naming, good use of
sealed results. A review that only lists problems reads as harsher than
intended and buries the signal that most of the code is fine.>

## No findings
<Only if the scope genuinely has zero findings at every severity — say so
plainly instead of omitting the sections above. Don't manufacture a
Recommended finding just to have something to report.>
```

## Ordering rules

- Sections appear in severity order (Critical → Important → Recommended),
  never file order — omit an empty severity section entirely rather than
  writing "None."
- Within a severity, order findings by file, then by line — this makes the
  report usable as a top-to-bottom checklist per file once the developer
  starts fixing.
- If the same rule fires many times in a mechanical, repetitive way (e.g.
  ten identical hand-rolled null checks across a file), don't write ten
  near-identical findings — write one finding that shows one representative
  example, states the rule, and lists the remaining file:line locations
  in a single line (`Also at: OrderMapper.java:23, 41, 58, ...`). A wall
  of copy-pasted findings hides the report's actual signal.

## Sizing the report to the scope

A single small file with two or three findings doesn't need the full
`## Summary` counts table or a `## What's already good` section — a short
inline reply with the findings grouped by severity is enough. Reserve the
full template, and saving it to `claudedocs/`, for a review spanning
several files or a whole PR, per `SKILL.md` step 7.
