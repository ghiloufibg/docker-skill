# Profile: message brokers

Kafka is the model; RabbitMQ, ActiveMQ, NATS, Pulsar, SQS/SNS (LocalStack),
Pub/Sub (emulator) and Service Bus follow the same shape. Isolation mode.

## Container

The broker image installed locally (Kafka in KRaft mode needs no ZooKeeper
container if the image supports it). Advertised listeners must be reachable
both from the service on the host and from other containers: set a host
listener on the mapped port. Health check: the broker's own API-versions or
status command.

If the service uses a schema registry, add its container (or a mock of its
HTTP API) as another dependency.

## Redirect

Override the bootstrap servers or connection keys (`spring.kafka.bootstrap-servers`,
`spring.rabbitmq.host` and port, queue URLs) with the container. Keep the
service's own group id, client id and serializer settings.

## Initialise

Create what the service expects before it starts, with the container's CLI or
admin API: topics (name, partitions, replication 1), queues, exchanges and
bindings, subscriptions, dead-letter topics. Take names and counts from config
and listener annotations.

## Seed

Per case, `seeds/<T#>/messages/`: one file per message with key, headers and
payload. Produce with the container's CLI producer (for Kafka,
`kafka-console-producer` with key and header support) before or after the
trigger, as the case requires. A case that consumes a message uses this to
deliver it; payloads follow the schema (Avro/JSON/Protobuf) from the repo.

## Reset

Use a unique consumer group per run so offsets never leak between cases.
Between cases: delete and recreate the topics the case touched, or purge the
queues. For a long run, a fresh broker per group of cases is the strongest
option.

## Assert

- Outbound messages: start a consumer on the output topic or queue before the
  trigger, with a unique group, and read with a bounded timeout. Check key,
  headers and payload fields, and the number of messages.
- Inbound processing: observe the side effect through the API, the database
  read-only, or an output message.
- Poll with a timeout (Awaitility-style loop or a consumer timeout). Never
  sleep for a fixed time. Report the timeout used.
- For "no message is published", wait the full timeout and assert none arrived.

## Notes

Ordering and timing are probabilistic; the plan records the timeout and any
case sensitive to ordering across partitions.
