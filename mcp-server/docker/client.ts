import Docker from "dockerode";

// Local socket only, per docs/design/mcp-ui-docker-ops.md §1/§9 — never a
// remote/TCP Docker context. dockerode defaults to /var/run/docker.sock
// when constructed with no options, which is exactly what we want.
export const docker = new Docker();

// Docker's own container name charset (`docker run --name` rejects
// anything else; container IDs, being hex, already satisfy it): first
// character alphanumeric, then alphanumeric/underscore/period/hyphen. Every
// `id` this server accepts eventually reaches either dockerode's
// `Container` methods (docker-modem's `Modem.dial` concatenates
// `options.path` into the raw HTTP request line with no URL-encoding — see
// node_modules/docker-modem/lib/modem.js) or the streaming sidecar's own
// path-derived id (docker/stream/sidecar.ts, after a `decodeURIComponent`
// that can turn an encoded `%2F`/`%2E%2E` back into `/`/`..`). Constraining
// to this charset closes both paths off, shared here so server.ts's Zod
// input schemas and the sidecar's plain runtime check can't drift apart.
export const DOCKER_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
