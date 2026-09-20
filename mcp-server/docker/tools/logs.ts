import { docker } from "../client.js";

const DEFAULT_TAIL = 100;

/**
 * Non-streaming `docker logs` returns Docker's multiplexed stream format
 * (unless the container was created with a TTY): each frame is an 8-byte
 * header — [streamType(1), 0,0,0(3 padding), size(4, big-endian)] —
 * followed by `size` bytes of payload. dockerode doesn't demux a Buffer
 * result for us (only stream.pipe()), so this does it by hand.
 */
function demux(buf: Buffer): string[] {
  const lines: string[] = [];
  let offset = 0;
  let pending = "";
  while (offset + 8 <= buf.length) {
    const size = buf.readUInt32BE(offset + 4);
    const payload = buf.subarray(offset + 8, offset + 8 + size).toString("utf-8");
    pending += payload;
    offset += 8 + size;
  }
  for (const line of pending.split("\n")) {
    if (line.length > 0) lines.push(line);
  }
  return lines;
}

export async function getContainerLogs(id: string, tail = DEFAULT_TAIL): Promise<string[]> {
  const container = docker.getContainer(id);
  const [info, rawLogs] = await Promise.all([
    container.inspect(),
    container.logs({ stdout: true, stderr: true, tail, timestamps: true, follow: false }),
  ]);
  const buf = rawLogs;
  // A TTY container's logs are already plain text — demuxing would corrupt them.
  if (info.Config.Tty) {
    return buf.toString("utf-8").split("\n").filter((l) => l.length > 0);
  }
  return demux(buf);
}
