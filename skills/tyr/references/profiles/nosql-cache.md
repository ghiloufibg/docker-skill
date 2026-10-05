# Profile: NoSQL stores and caches

MongoDB, Redis, Cassandra, DynamoDB (DynamoDB Local), Hazelcast and similar.
Isolation mode.

## Container

The same engine and major version from the local images. Health check: Mongo
`db.runCommand({ping:1})`, Redis `redis-cli ping`, Cassandra `nodetool status`,
DynamoDB Local port. No persistent volume.

## Redirect

Override the connection keys (`spring.data.mongodb.uri`, `spring.data.redis.host`
and `port`, the DynamoDB endpoint override and synthetic credentials) with the
container.

## Initialise

Collections, indexes, key spaces, tables and TTL settings the service expects.
Prefer the service's own initialisation (index annotations, migration tools); if
there is none, use the repo's definitions. No source is a doubt.

## Seed

Per case, `seeds/<T#>/`: JSON documents or a command script for the engine's CLI
(`mongoimport`/`mongosh`, `redis-cli`, `cqlsh`, `aws dynamodb --endpoint-url`).
Synthetic data only. For caches, the usual seed is "empty" or a specific cached
value (including an expired or stale one) when the case is about cache behavior.

## Reset

Mongo: drop the collections the case touched. Redis: `FLUSHDB` on the service's
database index. Cassandra: truncate tables. DynamoDB: delete the items or
recreate the table. A cache case that depends on TTL uses a short TTL in the
override rather than a sleep.

## Assert

Through the service's API; or a read-only query for state the API does not
expose. For caches, assert on observable behavior (a second call does not reach
the partner: WireMock request count) rather than on key layout, unless the
requirement is about the key.
