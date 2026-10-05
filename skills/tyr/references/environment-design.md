# Environment design (isolation mode)

`SKILL.md` step 6 points here. The plan describes how the whole local stack is
built, started, observed and removed. Nothing here is executed in the plan
phase.

## Run identity

- `run-id`: `qa-<yyMMddHHmm>-<4 hex>`, chosen at execution and written into the
  report. The plan uses the placeholder `<run-id>`.
- Compose project name: `tyr-<service>-<run-id>`.
- Label on every container, network and volume: `tyr.run=<run-id>`.
- Working folder: `.copilot/qa-run/<service>-<slug>/`, holding the generated
  Compose file, stubs, seeds, scripts and evidence. It is ephemeral. The plan
  tells the user to add `.copilot/` to `.git/info/exclude` (local, untracked) so
  `.gitignore` is not modified. The skill does not make that edit itself unless
  the user asks.

## Topology

One Compose project: a dedicated network, one service per dependency (from the
profiles), WireMock, and, if the plan runs the service as a container, the
service too.

Rules:

- No fixed host ports. Publish with `127.0.0.1::<port>` so Docker picks free
  ports; read them back with `docker compose -p <project> port <svc> <port>`.
  The user's own stack is never clashed with.
- A health check on every container; start order uses `depends_on` with
  `condition: service_healthy`.
- No volumes that survive teardown (tmpfs or anonymous volumes).
- Images referenced exactly as found locally, by repository and tag. Set
  `pull_policy: never` so Compose cannot pull behind the user's back.
- Resource limits are not set unless the machine is known to be constrained.

The plan includes the topology as a table (service, image:tag, published
port variable, health check) and the Compose file's outline; the file itself is
generated at execution.

## Service launch

Prefer running the service on the host:

- command from the build (`mvnw spring-boot:run`, `gradlew bootRun`, or
  `java -jar target/<app>.jar`), PowerShell and shell forms
- the override variables from the scan, pointing at the mapped ports
- an `application` profile for tests only if one already exists
- readiness: the actuator health URL, or a log line, with a timeout

Run it as a container instead when the repo already builds an image and the user
wants it closer to production. State the choice and why.

Capture the service's log to the working folder for evidence.

## Observability for evidence

Each live check captures: the request, the response, the relevant service log
lines (by time window or correlation id), and the mock/broker/mail verification
results. Keep the evidence small; it goes into the report only where it
supports a finding.

## Teardown

`docker compose -p <project> down -v --remove-orphans`, then a label-based
sweep (`docker ps -a --filter label=tyr.run=<run-id>`, and the same for
networks and volumes) as a safety net. Stop the service process. Remove nothing
that does not carry the label. Teardown also runs after failure or
interruption; anything it cannot remove is listed in the report with the exact
command to remove it.

## Resource note

Report the container count and warn when it is large: each dependency adds
start-up time and memory. Offer to run the cases in groups that need different
dependencies if that reduces the load.
