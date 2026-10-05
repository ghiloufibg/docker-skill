# Profile: search engines

Elasticsearch and OpenSearch. Isolation mode.

## Container

The same engine and version as the service's client, from local images. Single
node, security disabled for the test unless the service requires it (then use the
synthetic credentials), limited heap. Health check: cluster health at least
`yellow`.

## Redirect

Override the hosts or URIs (`spring.elasticsearch.uris`, `opensearch.hosts`) with
the container's mapped port.

## Initialise

Index templates, mappings and aliases the service expects. Prefer letting the
service create them on boot if it does; otherwise create them from the repo's
mapping files. Missing mapping files are a doubt.

## Seed

Per case, `seeds/<T#>/docs.ndjson` for the `_bulk` API. Refresh the index after
loading so the documents are searchable.

## Reset

Delete the case's indices (or `_delete_by_query` match-all) and recreate what the
service needs.

## Assert

Through the service's search API; or a read-only `_search`/`_count` against the
index for documents the service wrote. Refresh before reading, and poll with a
timeout because indexing is near-real-time.
