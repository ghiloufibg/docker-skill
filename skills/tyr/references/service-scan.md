# Scanning the service

`SKILL.md` step 4 points here. The scan is read-only and gathers the evidence
the design needs: how the service starts, what it exposes, and every dependency
it talks to. Each finding becomes an evidence card `[F#]`.

## Evidence card

```
[F3] src/main/resources/application.yml
  Finding:  partner client base URL
  Key:      partner.api.base-url
  Override: env PARTNER_API_BASE_URL (relaxed binding) or --partner.api.base-url=
  Value:    https://api.partner.example/v1 (default); hard-coded? no
  Touches:  T1, T2
```

Do not copy credentials, tokens or personal data from config. Write "secret,
value not recorded" and the key name.

## 1. Bootstrap

- Build file (`pom.xml`, `build.gradle*`): Java version, packaging, test
  plugins, wrapper presence.
- Main class and profiles: `application*.yml|properties`, profile-specific
  files, `spring.profiles.active`.
- How to launch: `spring-boot:run`, `bootRun`, the jar, or an image from a
  Dockerfile. The readiness check: an actuator health URL or a log line.
- Required environment: variables with no default.

## 2. Inbound surface

Controllers and routes, the inbound OpenAPI spec if any, message listeners
(topics or queues consumed), scheduled jobs, gRPC services, and the security in
front of them (filters, scopes, API keys, token validation).

## 3. External HTTP APIs

`@FeignClient`, `RestClient`, `RestTemplate`, `WebClient`, `HttpClient` beans;
base-URL properties; any outbound OpenAPI spec in the repo; the auth to the
partner (static key, OAuth client credentials, mTLS). A base URL that is
hard-coded in code, or a client that builds its own URL from data, cannot be
redirected: a blocking doubt.

## 4. Infrastructure: the detection pass

Technology-agnostic. Take the union of independent evidence.

1. **Build dependencies**: starters and drivers (`spring-boot-starter-data-*`,
   `*-jdbc`, `spring-kafka`, `spring-amqp`, AWS/GCP SDKs, mail, LDAP, search
   clients, gRPC).
2. **Configuration**: every setting holding a host, URL, port, DSN, bucket,
   queue, topic or credential, including `${...}` placeholders.
3. **Code**: clients, templates, listeners, repositories and producers that use
   those settings.
4. **Declared environment**: `docker-compose*.yml`, Testcontainers usage in
   existing tests, `.env` files, Helm charts and k8s manifests. They often name
   the image and version the service really runs against. Prefer that version
   for the container tag.
5. **Docs**: README and runbooks, for dependencies that appear nowhere else.

Match each dependency against `dependency-catalog.md`. No match goes to
`dependency-fallback.md`.

For every dependency record: kind and technology, the config key(s) that
control the target and their override form, the schema or message definition
source (migrations, `.proto`, Avro, JSON schema, topic list), and the cases
that touch it.

## 5. Schema and contract sources

- Database: Flyway (`db/migration`), Liquibase changelogs, JPA `ddl-auto`, SQL
  scripts. No source is a doubt.
- Messaging: topic names, partition expectations, serializers, key and header
  conventions, schema registry use, dead-letter topics.
- Partner APIs: OpenAPI or WSDL in the repo, contract tests, recorded examples.
  Stubs not derived from a spec are assumptions.

## 6. Remote mode

The same detection runs for code. The declared environment is the manifest
tree: see `remote-environment.md` section 2 for what to read from Deployments,
ConfigMaps, SOPS Secrets and Services.

## 7. Docker images (isolation)

After the dependencies are known, run `docker image ls` and match: WireMock,
and each engine or emulator needed. Record the exact repository and tag found
and, for each missing one, the image the skill would pick. Never pull.
