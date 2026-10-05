# Profile: relational databases

PostgreSQL is the model; MySQL, MariaDB, SQL Server and Oracle follow the same
shape with their own tooling. Isolation mode.

## Container

The same engine and major version the service uses, from the local images
(prefer the version in the service's compose files or manifests). Set a test
database, user and password (synthetic, fixed in the plan). Health check
`pg_isready` (Postgres) or the engine's ping. Use a tmpfs or an anonymous
volume so nothing survives teardown.

## Redirect

Override the datasource keys (`spring.datasource.url`, `username`, `password`)
with the container's mapped port. Do not change the dialect or driver.

## Initialise

The schema comes from the service's own migrations (Flyway, Liquibase), run when
the service boots. Do not hand-write DDL to mirror them. If there are no
migrations and `ddl-auto` creates the schema, say so. If neither exists, the
schema source is a blocking doubt.

Extensions, roles or schemas the migrations assume (for example `pgcrypto`, a
schema name) are created before the service starts.

## Seed

Plain SQL, one file per case, `seeds/<T#>/seed.sql`, applied after the service
has migrated and before the trigger. Synthetic rows only. Insert in dependency
order and respect constraints. Put identifiers in one place so the live-check
steps can refer to them.

## Reset

Default: truncate the tables the cases write to (the seeded tables and the
tables the service writes), listed in the plan, in one statement
(`TRUNCATE ... RESTART IDENTITY` in Postgres). Never truncate reference or lookup
tables filled by migrations, nor the migration history tables. Avoid `CASCADE`
unless the plan has checked that it reaches no such table. A
stricter option, a fresh database per case, is slower; choose it only when
truncation cannot restore the state (sequences, triggers, materialized views).
State the choice in the plan.

## Assert

Prefer the service's API: read back what the case created or changed. Use a
read-only query (`SELECT`) only for state the API does not expose, with the
query written in the plan. Never write to the database during assertions.

## Notes

- Scheduler stores and locks (Quartz JDBC, ShedLock) live in the same database:
  reset them with the rest.
- Timestamps in seeds should be relative or fixed far from "now" unless the case
  is about time.
