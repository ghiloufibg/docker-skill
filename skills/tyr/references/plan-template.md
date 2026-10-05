# Plan template

`SKILL.md` steps 6 to 8 point here. The saved plan is this document,
section by section. The plan holds signatures, data and commands; it holds no
test bodies and no secrets.

Path: `./.copilot/docs/qa/<service>-<slug>-test-plan.md`.

## Front matter

```
---
plan-id: <service>-<slug>
service: <service>
mode: isolation | remote
status: <see SKILL.md status model>
revision: r1
generated: <date>
path-taken: normal | large (draft written directly)
images: { wiremock: <repo:tag>, ... }   # as found; isolation only
target: { project, cluster, namespace, overlay }   # remote only
---
```

If the plan is a large-path draft, the first line after the front matter is:
`Status: DRAFT — not yet validated`.

## Sections

1. **Summary**: what is tested, how, in which mode, and what is not tested.
2. **Test cases**: `T#` register (verbatim wording, restated, trigger, observable
   outcome) and the triage table (class, mode tag, reason). Cases not run in this
   mode are listed with their tag.
3. **Service profile**: bootstrap (build, launch command, readiness), inbound
   surface, and every dependency found (kind, technology, route chosen, override
   keys) with `[F#]`.
4. **Clarifications and assumptions**: `[U#]` answers, `A#` assumptions with the
   risk if wrong, gate outcome (answered / defaulted / deferred, round), open
   items.
5. **Environment design**. Isolation: topology table, images and tags, ports,
   health checks, naming, run identity, teardown, missing images as
   preconditions. Remote: environment gate result (project, cluster, namespace,
   overlay, context), the real systems the cases touch, the entry point.
6. **Service launch**: command (PowerShell and shell forms), override variables,
   readiness check. Remote: how to reach the deployed service.
7. **Dependency designs** (isolation): one block per dependency with the six
   answers (container, redirect, initialise, seed, reset, assert) and, for
   WireMock, the mappings and failure modes per case.
8. **Data design**: per case, the seed for each dependency it touches, and the
   reset strategy. Remote: the API data each case creates, the run marker, the
   cleanup.
9. **Test case designs**: per `T#` by class: the live-check steps
   (`triage.md` format), or the unit-test design (`unit-test-conventions.md`
   format). Remote cases include secrets by name and the side-effect class.
10. **Automation plan**: working folder, the files the execute phase will
    generate (Compose file, stubs, seeds, scripts) by name and purpose, run
    order, how to run and tear down by hand.
11. **Artifact policy**: what is ephemeral (live checks, scripts, the working
    folder, the git exclusion step) and what is proposed for the repo (unit
    tests with paths, left uncommitted).
12. **Traceability matrix**: `T#` -> class -> mode tag -> requirement ->
    stubs/seeds (or API data and cleanup, or test class and method) ->
    assertions.
13. **Risks and limits**: what this approach cannot prove (stubs not derived from
    a spec, emulator coverage, version differences, timing, shared-environment
    effects), gaps not covered by any case.
14. **Execution contract**: exactly what `validate` will do. Isolation: the
    containers it will start (count), the live checks, the unit-test files and
    their paths, the commands it will run, the cleanup. Remote: the environment,
    the cases with their side-effect classes, the partners called, the
    credentials obtained by name, the cleanup. State that nothing will be
    staged or committed and that bugs are reported, not fixed.
15. **Resources appendix** (always last): `[F#]` files with path and what was
    taken, `[U#]` answers, `A#` assumptions, and what was not searched and why.
    Every citation in the plan resolves here.

## Conventions

- Citations `[F#]`, `[U#]`, `A#` on every finding and decision.
- Placeholders for run-time values: `<run-id>`, `<port:service>`.
- No secrets, tokens or personal data; "secret, value not recorded" plus the key
  name.
- Commands in both PowerShell and shell form where they differ.
- Keep the plan as short as its content allows. Prefer tables to prose.
