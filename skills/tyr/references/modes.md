# Modes: isolation and remote

`SKILL.md` preflight points here. The mode is recorded in the plan header and
decides which environment the cases run against and which steps apply.

| | `isolation` | `remote` |
|---|---|---|
| Target | the service running on the dev machine | the service deployed in a dev or rec environment on GCP (GKE) |
| Dependencies | local containers | the real ones the deployment is wired to, including real external APIs |
| Source of truth for dependencies | build files, config, code, repo compose/Testcontainers files | the repo's k8s manifests (Deployment, ConfigMap, Secret, Service, Ingress, overlays) |
| Data | seeded per case in containers | created through the service's own API with a run marker, then removed |
| Failure injection | yes (stub a 500, a timeout, a malformed body) | no |
| Test form | live checks, plus unit tests for paths a live check cannot reach | live checks only |
| Side effects | contained in disposable containers | real, listed in the plan |
| Needs | Docker, Compose, local images | `gcloud` session, `kubectl` context, `sops`, network path to the service |

## Choosing the mode

Take it from the prompt ("on dev", "against rec", "locally", "in isolation").
If it is not clear, ask once. A user who wants both runs the skill twice; the
second run reuses the case register from the first plan when it is found.

## Case tags

Each case carries one tag, decided at triage:

- `isolation-only`: needs a stubbed partner, seeded data, a broken or slow
  dependency, a specific broker message, or any state the real environment
  cannot be put into.
- `remote-only`: depends on real environment wiring (ingress and auth in
  front of the service, workload identity, a real partner contract, real
  configuration).
- `both`: observable through the public API in either place.

A case that does not fit the chosen mode is listed in the plan as "not run in
this mode" with its tag; it is not dropped silently, and it does not count as a
failure.

## What changes per step

| Step | isolation | remote |
|---|---|---|
| Preflight | Docker and Compose reachable | environment gate: `gcloud`, `kubectl` context, `sops`, class dev/rec |
| Scan | build files, config, code, repo compose/Testcontainers | the same for code, plus manifests of the chosen overlay |
| Design | environment design and dependency profiles | live-check design with entry point, secrets by name, data marker, cleanup |
| Execute | Compose up, initialise, seed, run, unit tests, Compose down | reach the service, run, clean up created data |
| `UNIT` class | available | not available |
