# Dependency catalog

`SKILL.md` step 4 points here. For each dependency found by the scan, take the
row, load its profile, and fill in the six answers (container, redirect,
initialise, seed, reset, assert) for the cases that touch it. Isolation mode
only; remote mode uses the real dependency through the service's API.

Image names are candidates. Use whatever local image matches the engine
(`docker image ls`), preferring the version the service's own compose files,
Testcontainers usage or manifests declare. Never pull.

| Kind | Detection signals | Replace with | Profile | Readiness |
|---|---|---|---|---|
| External HTTP / REST | Feign/RestClient/WebClient/HttpClient, `*.base-url` | WireMock | `http-wiremock` | `GET /__admin/mappings` 200 |
| gRPC | `grpc-*`, `.proto`, `*.grpc.*` | WireMock with gRPC extension, else a stub per `fallback` | `http-wiremock` (gRPC note) | port open |
| SOAP | WSDL, `spring-ws`, JAX-WS | WireMock | `http-wiremock` | as above |
| PostgreSQL | `postgresql`, `jdbc:postgresql` | postgres | `relational-db` | `pg_isready` |
| MySQL / MariaDB | `mysql`, `mariadb` | mysql / mariadb | `relational-db` | `mysqladmin ping` |
| SQL Server, Oracle | `mssql`, `ojdbc` | engine image, if installed | `relational-db` | engine ping |
| MongoDB | `spring-data-mongodb` | mongo | `nosql-cache` | `db.runCommand({ping:1})` |
| Redis | `spring-data-redis`, `lettuce`, `jedis` | redis | `nosql-cache` | `redis-cli ping` |
| Cassandra, DynamoDB | `cassandra`, `dynamodb` | cassandra / DynamoDB Local | `nosql-cache` | engine check |
| Elasticsearch / OpenSearch | `elasticsearch`, `opensearch` | same engine | `search` | cluster health |
| Kafka | `spring-kafka`, `kafka-clients` | kafka (KRaft) | `messaging` | broker API versions |
| RabbitMQ | `spring-amqp`, `amqp-client` | rabbitmq | `messaging` | `rabbitmq-diagnostics ping` |
| ActiveMQ, NATS, Pulsar | respective clients | same broker | `messaging` | broker check |
| SQS / SNS / Kinesis | `aws-sdk` sqs/sns | LocalStack | `messaging` | LocalStack health |
| Pub/Sub | `google-cloud-pubsub` | Pub/Sub emulator | `messaging` | emulator port |
| Azure Service Bus | `azure-messaging-servicebus` | Service Bus emulator, if installed | `messaging` | emulator port |
| S3 | `aws-sdk` s3, `s3` config | MinIO or LocalStack | `object-storage` | `/minio/health/live` |
| GCS | `google-cloud-storage` | fake-gcs-server | `object-storage` | server port |
| Azure Blob | `azure-storage-blob` | Azurite | `object-storage` | Azurite port |
| SMTP | `spring-boot-starter-mail`, `spring.mail.*` | Mailpit or MailHog | `mail` | `/api/v1/info` |
| OIDC / OAuth2 / Keycloak | `spring-security-oauth2-*`, `issuer-uri` | Keycloak, or WireMock for token and JWKS | `identity` | realm well-known URL |
| LDAP | `spring-ldap` | openldap | `fallback` | ldap bind |
| Config / secrets | Config Server, Consul, Vault | the server, or disable by profile | `fallback` | server health |
| SFTP / FTP | `jsch`, `commons-net` | sftp / ftp container | `fallback` | port open |
| Scheduler stores, locks | Quartz JDBC, ShedLock | the underlying database | `relational-db` | as DB |
| Anything else | | | `dependency-fallback.md` | |

Only one profile is loaded per detected dependency; load it when needed, not
up front.

## The six answers

Every dependency in the plan fills in the same table:

| Question | Meaning |
|---|---|
| Container | image and tag (local), ports, health check, environment |
| Redirect | the service config key(s) and the override value that points at the container |
| Initialise | schema, topics, queues, buckets, realms, indexes the service expects before the first case |
| Seed | per-case data, synthetic, one folder per case |
| Reset | how state is cleared between cases |
| Assert | how the outcome is observed |

If the route makes an answer moot (a disabled dependency has no seed or reset),
write "n/a" and why.
