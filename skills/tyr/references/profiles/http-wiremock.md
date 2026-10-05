# Profile: external HTTP APIs with WireMock

Covers REST, SOAP and, with the gRPC extension, gRPC. Isolation mode.

## Container

The WireMock image already installed locally. Record repository and tag from
`docker image ls`. One WireMock container per external host the service calls
when the hosts have different base paths clashing; otherwise one container with
one mapping folder per host path prefix. Enable the admin API (`/__admin`), a
health check on `GET /__admin/mappings`, and request journaling.

## Redirect

For each external base-URL key from the scan, set the override to the
container: `http://localhost:<mapped-port>/<prefix>`. Use the container's
random published port, read back with `docker compose port`. Set the key by
environment variable or command-line property at launch; never edit the
service's files.

If the partner uses HTTPS only and the client validates certificates, that is a
doubt: a test profile that allows plain HTTP, a trust store, or WireMock with
HTTPS.

## Initialise

Nothing is loaded globally. Mappings are loaded per case.

## Seed (stubs)

One folder per case, `stubs/<T#>/`, with one mapping file per endpoint. Each
mapping states the request match (method, URL or pattern, headers, body
patterns) and the response.

Per case design:

- the happy response, from the partner's OpenAPI or WSDL when one exists;
  otherwise mark the stub as an assumption `A#`
- the failure modes the case needs: status codes (4xx, 5xx), `fixedDelay`,
  connection reset, empty body, malformed body, chunked-then-dropped
- stateful scenarios for retry behavior (first call fails, second succeeds)
- the partner's auth, answered the way the service expects (token endpoint,
  signature header)

Load with `POST /__admin/mappings` (or `/__admin/mappings/import`).

## Reset

`POST /__admin/reset` (mappings and journal) between cases. Scenarios are reset
with it.

## Assert

- Verify that the service called the partner as the requirement says:
  `POST /__admin/requests/count` with the request pattern, or
  `POST /__admin/requests/find`. Check method, path, headers and body, and the
  number of calls (retries).
- After every case read `GET /__admin/requests/unmatched`. An unmatched request
  is a failure signal: the service called something the case did not expect.

## gRPC note

Use WireMock's gRPC extension when the image has it; load descriptors from the
`.proto` files. Otherwise route 3 of `dependency-fallback.md`.
