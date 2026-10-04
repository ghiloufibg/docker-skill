# Resources appendix

`SKILL.md` step 9 and the plan template's section 10 point here. This is
the last section of every plan, including a partial plan. Its job: a reviewer
can trace any claim in the plan to its source, and can see what was looked
at and not used.

## Citation markers

| Marker | Source |
|---|---|
| `[J#]` | Jira issue (the ticket and linked issues) |
| `[C#]` | Confluence page |
| `[F#]` | Repository file read |
| `[U#]` | User answer or decision at the gate |
| `[A#]` | Assumption (defined in plan section 4, listed here for completeness) |

Ids are assigned in the order sources are first used and never reused. Every
marker used anywhere in the plan must appear below; every entry below should
be cited at least once or moved to "Considered, not used".

## Format

```markdown
## 10. Resources

### Jira
| ID | Key | Title | Type / status | Last updated | Link |
|----|-----|-------|---------------|--------------|------|
| J1 | PROJ-123 | ... | Story / In Progress | <ts> | <url> |
| J2 | PROJ-98 | ... (linked: blocks) | ... | ... | <url> |

### Confluence
| ID | Title | Space | Page id / version | Modified | Found via | Informs | Note |
|----|-------|-------|-------------------|----------|-----------|---------|------|
| C1 | ... | ... | 12345 / v7 | <date> | link from J1 | R2, R5 | ok |
| C2 | ... | ... | ... | <date> | search "order cancel" | R3 | possibly stale |

### Codebase
| ID | Path | Why read |
|----|------|----------|
| F1 | pom.xml | Java version, build tool, boundary enforcement |

### Clarifications
| ID | Question | Decision | Gate round | Date |
|----|----------|----------|------------|------|
| U1 | Keep or delete on cancel? | Keep, status CANCELLED (answered) | 1 | <date> |

### Assumptions
| ID | Assumption | Basis | Risk if wrong |
|----|------------|-------|---------------|

### Skills and rules applied
mimir (<version or commit if known>), forseti plan-review mode (<same>),
project instruction files read: <paths>.

### Considered, not used
Pages or issues found and rejected, each with the reason; queries that
returned nothing; pages left unread because of the budget.

### Generation
Date, ticket timestamp at generation, gate rounds run, status.
```

## Rules

- Record what was actually read, not what was merely searched. Search
  queries that found nothing go under "Considered, not used".
- Links are the real URLs the user can open; don't construct a URL that
  wasn't returned by the tools.
- Do not include secrets or personal data; where a source contained some,
  note "contains sensitive data, not reproduced".
