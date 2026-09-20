/**
 * CLI argument parsing, isolated from cli.ts so it's obvious what to change
 * first when forking this as a blueprint for a different MCP-UI skill: the
 * wire format (flags before `--`, target command after) and defaults live
 * here, everything else just consumes a plain Config object.
 */

export interface Config {
  /** The wrapped server's own command line, e.g. ["node", "server.js"]. */
  targetCommand: string;
  targetArgs: string[];
  /** Auto-launch the system browser on a new UI session (default true). */
  autoOpen: boolean;
  /** Fixed loopback port, or 0 to let the OS assign one (default). */
  port: number;
  /** How long an unopened session link stays valid, in ms (default 30 min). */
  sessionTtlMs: number;
}

const USAGE = `Usage: mcp-apps-browser-bridge [options] -- <command> [args...]

Wraps any stdio MCP server given after \`--\`. Register THIS command with your
MCP host (in place of the real server command) so tool results carrying a
ui:// MCP Apps resource get a real, fully-wired browser view instead of
silently degrading to raw text on a terminal host.

Options (must come before --):
  --no-open           Print the session link instead of auto-launching a browser.
  --port <n>          Fixed loopback port for the UI companion (default: OS-assigned).
  --session-ttl <min> Minutes an unopened session link stays valid (default: 30).
  -h, --help          Show this help and exit.
  -v, --version       Show the version and exit.`;

export class UsageError extends Error {}

export function parseArgs(argv: string[]): Config {
  if (argv.includes("-h") || argv.includes("--help")) {
    console.log(USAGE);
    process.exit(0);
  }
  if (argv.includes("-v") || argv.includes("--version")) {
    // Kept as a literal (not read from package.json) so this file has zero
    // runtime dependency on being able to resolve its own package root —
    // handy when copied wholesale into another project as a starting point.
    console.log("mcp-apps-browser-bridge 1.0.0");
    process.exit(0);
  }

  const sep = argv.indexOf("--");
  if (sep === -1 || argv.length === sep + 1) {
    throw new UsageError(USAGE);
  }

  const flags = argv.slice(0, sep);
  const [targetCommand, ...targetArgs] = argv.slice(sep + 1);

  const portIdx = flags.indexOf("--port");
  const port = portIdx !== -1 ? Number(flags[portIdx + 1]) : 0;
  if (portIdx !== -1 && (!Number.isInteger(port) || port < 0 || port > 65535)) {
    throw new UsageError(`--port must be an integer in [0, 65535], got "${flags[portIdx + 1]}"`);
  }

  const ttlIdx = flags.indexOf("--session-ttl");
  const ttlMinutes = ttlIdx !== -1 ? Number(flags[ttlIdx + 1]) : 30;
  if (ttlIdx !== -1 && (!Number.isFinite(ttlMinutes) || ttlMinutes <= 0)) {
    throw new UsageError(`--session-ttl must be a positive number of minutes, got "${flags[ttlIdx + 1]}"`);
  }

  return {
    targetCommand,
    targetArgs,
    autoOpen: !flags.includes("--no-open"),
    port,
    sessionTtlMs: ttlMinutes * 60_000,
  };
}
