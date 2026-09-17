import Docker from "dockerode";

// Local socket only, per docs/design/mcp-ui-docker-ops.md §1/§9 — never a
// remote/TCP Docker context. dockerode defaults to /var/run/docker.sock
// when constructed with no options, which is exactly what we want.
export const docker = new Docker();
