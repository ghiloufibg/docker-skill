# Building an MCP-UI server: a field guide

Everything here was learned building `docker-skill` — a Docker ops
dashboard exposed through MCP tool results that render as interactive
UI (see `docs/design/mcp-ui-docker-ops.md` for that project specifically).
This document strips the Docker-specific parts out and keeps only what
should transfer to *any* MCP-UI server. Where something is a docker-skill
choice rather than a universal rule, it's marked as such.

Five real bugs got found across this project, and every one of them was
found by *actually rendering the page against a real host* — never by
the headless protocol tests, which were passing the whole time. That's
the single biggest lesson here, and it shapes most of what follows.

## TL;DR checklist

- [ ] Use the official kit for the wire protocol (§2) — don't hand-roll
      postMessage/JSON-RPC framing.
- [ ] Split protocol layer (kit-owned) from view layer (your DOM/CSS) (§3).
- [ ] Spike on something low-stakes before building the real thing (§4).
- [ ] Tag every tool with `readOnlyHint`/`destructiveHint`/`idempotentHint` (§5).
- [ ] Decide `tool` vs `prompt` per action deliberately (§6).
- [ ] Layer your confirm story: UI dialog + host permission prompt +
      annotations, and know elicitation may not be supported yet (§7).
- [ ] Give every `hidden`-toggled element a `[hidden]` CSS override if its
      class sets its own `display` (§9).
- [ ] Give every theme-aware color token both a media-query rule *and* a
      `[data-theme]` rule (§8).
- [ ] Check `result.isError` explicitly at every `callServerTool` site —
      never rely on an incidental throw (§10).
- [ ] Test real failure paths (bad id, race conditions), not just happy
      path (§10).
- [ ] Actually render the page against a real host before calling
      anything done (§13-14). This is not optional.

## 1. What you're actually building

MCP tools normally return text/structured data. **MCP Apps** (the MCP
extension formalizing this — `modelcontextprotocol.io/extensions/apps`)
lets a tool also declare a `ui://` HTML resource
(`_meta.ui.resourceUri` on the tool), which the host renders in a
sandboxed iframe instead of (or alongside) the plain text result. The
resource's own JS can then call more tools, or send a prompt back into
the conversation — that's the whole mechanism.

Two implementations exist to build against:

- **The official MCP Apps SDK** — `@modelcontextprotocol/ext-apps`
  (+`@modelcontextprotocol/server`). This is what Claude's own docs
  point at (`claude.com/docs/connectors/building/mcp-apps`), and what
  this guide assumes.
- **`mcp-ui`** (`github.com/idosal/mcp-ui`) — an older community project
  that originated the pattern, with its own client/server SDKs and a
  slightly different native resource convention. Still worth knowing:
  its supported-hosts list is a useful cross-check, and its adapter
  layer can translate its own convention into MCP Apps' for hosts that
  don't speak the older format natively.

Pick one per-project and don't mix them for the same resource. This
project used the official SDK (see §2 for why).

## 2. Use the kit for the protocol, always

The postMessage/JSON-RPC framing between the sandboxed iframe and the
host is fiddly and security-relevant (CSP construction, origin
validation, the double-iframe handshake). Hand-rolling it is exactly
the kind of thing that looks like it works until it doesn't. Use
`registerAppTool`/`registerAppResource` on the server, `App` on the
client — the SDK owns the wire format, you own the data.

Concretely, on the server:

```ts
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";

registerAppTool(server, "my-tool", {
  title: "My Tool",
  description: "...",
  annotations: { readOnlyHint: true, openWorldHint: false }, // see §5
  inputSchema: z.object({ id: z.string() }),
  outputSchema: MyResultSchema,
  _meta: { ui: { resourceUri: "ui://my-widget/view.html" } },
}, async ({ id }) => {
  const data = await doTheWork(id);
  return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
});

registerAppResource(server, "ui://my-widget/view.html", "ui://my-widget/view.html",
  { mimeType: RESOURCE_MIME_TYPE, description: "..." },
  async () => ({ contents: [{ uri: "...", mimeType: RESOURCE_MIME_TYPE, text: builtHtml }] }));
```

And in the widget itself:

```ts
import { App, applyDocumentTheme, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";

const app = new App({ name: "My Widget", version: "0.1.0" });
app.ontoolresult = (result) => render(result.structuredContent);
app.onerror = console.error;
// ... register other handlers before connect() — the host can send
// requests immediately after the handshake, so late handlers miss them.
app.connect().then(() => {
  const ctx = app.getHostContext();
  if (ctx) applyHostContext(ctx);
});
```

`App` exposes `callServerTool` (call another tool from the widget),
`sendMessage` (the `prompt` channel — see §6), `sendLog`, `openLink`,
and host-context handlers (`onhostcontextchanged`, theme/style/safe-area
info).

## 3. Split protocol layer from view layer

Two different questions, two different answers:

- **Protocol layer** (resource creation, iframe handshake, action
  framing): use the kit, don't touch it. This is where the security
  properties live.
- **View layer** (what's actually drawn): plain DOM/CSS is usually
  right. Every byte of the view layer ships inlined in every tool
  result (see §12 on payload size — the protocol layer already costs
  ~230KB before your view code adds anything), and most MCP-UI screens
  (cards, tabs, forms, confirm dialogs) don't need component-tree
  management. Reach for something heavier (Preact+htm, a real
  framework) only once plain DOM code has visibly become the harder
  path to read — not by default.

Don't use a charting library for a one-shot/non-streaming stat — a hand
rolled inline `<svg>` bar or sparkline is smaller and sufficient. Save
the heavier tooling for genuinely complex visuals (the official SDK's
own examples use Chart.js for a *streaming* CPU history chart, which is
a fair trade there — the shape of the problem, not a rule against
charting libraries in general).

## 4. Build in stages, re-verify rendering after every UI change

Don't build the whole surface before checking anything renders. Order
that worked well:

0. **Spike the plumbing** on something with zero blast radius and,
   ideally, zero external dependency — a static local data source, not
   your real backend. The point is isolating "does this technique work
   at all" from "does my actual feature work," so a plumbing bug can't
   get confused with a business-logic bug.
1. **Read-only view** of your real data, manual refresh only.
2. **Richer read-only views** (tabs, detail panels, secondary data).
3. **Agent-facing structured output**, if applicable (§6's report
   pattern) — turning "the agent replies in chat" into "the agent calls
   a tool that renders a resource."
4. **Gated mutating actions**, last, and only once the risk-tiering and
   confirm story (§5, §7) actually exist to gate them.

At every stage: re-run the actual rendering check (§13-14), not just
the headless protocol test. New UI, new chance for a `[hidden]` bug,
a broken theme selector, an unchecked `isError`. This project found a
new bug on nearly every stage that added interactive elements — the
pattern held consistently enough to trust it as a rule, not a
coincidence.

## 5. Tool design: visibility and risk tiers

**Visibility.** A tool can be model-facing (the agent can call it
directly), app-only (only the widget's own JS can call it, via
`_meta: { ui: { visibility: ["app"] } }` — invisible to the model,
useful for a polling/refresh tool you don't want the agent reasoning
about or spamming), or both. Default to model-facing; make something
app-only only when there's a concrete reason (e.g., a companion poll
tool that exists purely for a UI refresh button).

**Risk tiers.** A simple, effective scheme:

| Tier | Examples | Gate |
|---|---|---|
| 0 — read-only | list, get, inspect | none — safe to pre-approve |
| 1 — low-risk mutate | start, pause, anything reversible | simple confirm |
| 2 — high-risk mutate | stop, delete, anything hard to undo | confirm + re-type the target's name |
| 3 — arbitrary execution | shell/exec-style tools | exclude, or a fixed command palette, never freeform |

**Annotations.** MCP has a standard way to tell the host about a tool's
risk, independent of your own UI confirm — `readOnlyHint`,
`destructiveHint`, `idempotentHint`, `openWorldHint` on every tool's
`annotations`. Set them accurately for every tool, tier 0 included
(`readOnlyHint: true, openWorldHint: false` costs nothing and is the
correct, honest signal). A compliant host *can* use these to decide
whether to prompt — don't skip them just because your own UI already
has a confirm dialog; they're complementary, not redundant (see §7).

## 6. Two action channels: `tool` vs `prompt`

A widget's JS can do two structurally different things:

- **`callServerTool`** — "do a mechanical thing and show me the
  result." No reasoning involved: refresh, fetch detail, run a
  Tier-1/2 action. This is most of what a widget does.
- **`sendMessage`** — hands a prompt to the *agent*, not the server.
  Use this when the next step genuinely needs reasoning your server
  shouldn't try to replicate (root-cause analysis, "what should I do
  about this"). The agent gets your full context as a normal
  turn — it can use Bash, other tools, whatever it has — and comes back
  with an answer.

**The report-building pattern.** Left alone, a `sendMessage`
investigation's answer lands as an ordinary chat reply — fine, but it
throws away the chance to show structured findings. The fix: register a
second, dumb tool (e.g. `build-investigation-report`) that takes
structured findings as input (`summary`, `rootCause`, `timeline`,
`evidence`, `suggestedRemediations` — whatever your domain needs) and
renders them as a resource. It does *no* data gathering itself. Then
have your `prompt` text explicitly tell the agent to call that tool
with what it found, instead of just answering in chat:

```
Investigate why X. Once you've actually looked, call build-investigation-report
with your findings instead of just replying in chat.
```

This keeps the division of labor clean: the agent owns reasoning, the
server only turns the *result* of that reasoning into UI. Don't try to
make the server smart — that's a rules engine you'll have to maintain
separately from the agent's own reasoning quality, and it'll be worse
at it.

If your report has "suggested next actions," think hard before making
them one-click buttons that call mutating tools — see §7's note on why
this project deliberately kept those as plain text.

## 7. Security: layer your defenses, know their limits

For any mutating action, stack these — they're not alternatives:

1. **UI-side confirm.** Simple confirm for low-risk, re-type-the-target-name
   for high-risk. Cheap, good UX, but **enforced by the resource's own
   JS running inside the iframe** — a compromised or buggy resource
   could in principle skip straight to the tool call. Don't present this
   as sufficient on its own.
2. **The host's own MCP permission prompt** on the tool call itself —
   this is the real backstop, since it's outside the iframe's control
   entirely. It's "free" in the sense that it happens automatically for
   any tool not pre-approved; your job is just to *not* pre-approve
   Tier 1/2 tools.
3. **Tool annotations** (`destructiveHint`, §5) — the spec-level signal
   that lets a compliant host apply its own extra scrutiny, independent
   of whether your resource's UI dialog fires correctly.
4. **Native host elicitation** (`inputRequired.elicit()` in
   `@modelcontextprotocol/server`), if the connected host supports it —
   the strongest option, since it routes confirmation through the
   *host's own UI*, not your iframe, so a compromised resource can't
   bypass it by construction. **Check before relying on it**: the SDK
   itself gracefully detects an unsupporting client and returns a clean
   tool error (`isError: true`, specific message) rather than hanging —
   but as of this writing, not every host implements the client side of
   it yet, including reference/test hosts. Feature-detect
   (`getUiCapability(clientCapabilities)`) and fall back to layers 1-3
   when it's unavailable, don't assume it.

**Don't leak secrets through read-only tools.** Any tool's output
becomes part of the model's context. If your domain has something like
"env vars" or "config values" that commonly carry secrets, return
*names*, never values, by default. There's no good way to redact
selectively without a real secrets-detection pass, so be blunt about it.

**Be conservative with agent-authored resources triggering mutations.**
An investigation report the *agent* filled in, if its "remediation"
items were real one-click buttons, would mean agent-generated content
triggering Tier 1/2 actions on click — a bigger attack surface than a
human clicking a dashboard button you wrote. Keep agent-authored
suggestions as plain text until you've thought through that
specifically; it's a different risk shape than the rest of this list.

## 8. Theming: you need both selectors, not one

`applyDocumentTheme(theme)` (from the SDK) sets
`documentElement.setAttribute('data-theme', theme)` on the host page —
this is how a host's *own* theme toggle overrides what your widget
shows, independent of the OS/browser's `prefers-color-scheme`. If your
CSS only has:

```css
@media (prefers-color-scheme: dark) { :root { --bg: #111827; } }
```

...it will **never react to the host's theme switch** — only to the
underlying OS setting. This is exactly what happened here: the host
went fully dark, the widget stayed glaring white, because nothing in
the CSS ever looked at `[data-theme]`. The fix is the standard
dual-selector pattern:

```css
:root {
  --bg: #ffffff; /* light, default */
}

/* OS-level preference, when the host hasn't set an explicit theme */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #111827;
  }
}

/* Host-driven theme — wins regardless of source order */
:root[data-theme="dark"] {
  --bg: #111827;
}
```

Test this for real: call your tool, then find and click the host's
actual theme toggle (don't just trust that you handled the callback —
check the computed background color of your widget's `<body>`
afterward).

## 9. The `[hidden]` CSS trap

An author stylesheet rule beats the browser's default
`[hidden] { display: none }` at equal CSS specificity. If any class you
toggle via the `hidden` attribute also sets its own `display` property
(`display: flex` for a modal overlay, a flexbox row, whatever), that
element **stays visible even when `hidden` is set** — the class rule
wins over the browser default.

Two real instances of this in one project: a confirm modal that stayed
permanently visible over the whole dashboard, and an "action needed"
box that showed at a metric value nowhere near its trigger threshold.
Both looked completely broken once actually rendered, and both were
invisible to any headless/protocol-level test, since those never
render CSS at all.

**The check:** for every element you toggle with `el.hidden = true/false`
in JS, grep its class in the CSS. If that class sets `display`, add:

```css
.your-class[hidden] { display: none; }
```

Do this preemptively for every hidden-toggled element in a new widget,
don't wait to find it by clicking around.

## 10. Error handling: check `isError`, always, explicitly

A tool call's result has an `isError` flag. When true, `structuredContent`
is typically absent. It's tempting to skip checking it explicitly,
because destructuring or property access on `undefined` will usually
throw anyway and get caught by your `catch` block — the user-visible
result often looks the same either way. Don't rely on that:

```ts
// Fragile — "works" only because destructuring undefined happens to throw
const result = await app.callServerTool({ name: "get-thing", arguments: {} });
const { value } = result.structuredContent; // throws if isError, by luck

// Correct
const result = await app.callServerTool({ name: "get-thing", arguments: {} });
if (result.isError) throw new Error("get-thing returned an error");
const { value } = result.structuredContent;
```

This project found two call sites that had the fragile version — not a
user-visible bug (the accidental throw happened to produce the right
catch-block behavior), but a latent one: if an error result ever
happened to have a `structuredContent`-shaped payload by coincidence,
it would silently render wrong data instead of an error state.

**Test real failure paths, not just the happy one.** A validation
error (bad type, missing field) is caught automatically by the SDK's
schema validation and returns a clean, specific message — that part is
free. What's worth testing deliberately is the *race*: open a detail
view, then remove/invalidate the thing it's showing from underneath it
(literally, in another terminal), then trigger a refresh. A well-built
widget shows a clean error state; a fragile one shows stale data, a
broken layout, or a JS exception. This is easy to test and catches real
bugs.

## 11. CSP and external resources

If your resource needs something from outside itself (a font, an
external map/chart library, an API), declare it explicitly via
`_meta.ui.csp` on the resource content item:

```ts
_meta: {
  ui: {
    csp: {
      resourceDomains: ["https://fonts.googleapis.com", "https://fonts.gstatic.com"], // scripts/styles/images/fonts
      connectDomains: ["https://api.example.com"], // fetch/WebSocket
    },
  },
},
```

This is **genuinely enforced**, not decorative — confirmed both
directions in this project: an undeclared external stylesheet was
blocked with an explicit CSP violation message naming the exact
directive; the same stylesheet, once declared, loaded successfully
(including the font file it referenced). Default to declaring nothing
and let the sandbox's default policy (self + inline + `data:`/`blob:`)
hold; only add domains you actually need, and only the ones you need
(don't blanket-allow a wildcard).

**Debugging gotcha, if you're testing from a sandboxed/proxied dev
environment**: a blocked-looking external request can be a TLS/proxy
certificate issue, not a CSP issue — they produce a similar "request
failed" symptom. Check the actual failure reason (`requestfailed`
event / browser console message) before concluding it's a CSP problem;
`net::ERR_CERT_AUTHORITY_INVALID` and an explicit
"Refused to load ... because it violates the following Content
Security Policy directive" are different failures that look similar at
a glance.

## 12. Payload size: budget for the SDK, not your code

Measured directly: a widget that does *nothing* but
`new App({ name, version }).connect()` — no DOM, no CSS, no business
logic — already weighs **~236 KB** once bundled (Vite +
vite-plugin-singlefile, minified). The official SDK's own dependency on
zod for wire-protocol validation is the dominant cost. Application code
(DOM manipulation, CSS, business logic) is noise by comparison — a
full dashboard with cards, tabs, a confirm modal, and real business
logic added only ~15-20 KB on top of that baseline in this project.

Practical implications:

- **Don't spend time shrinking your own widget code** for size — it's
  not where the bytes are. Spend that time on correctness (§8-10)
  instead.
- **Every resource independently re-bundles this cost.** If you have
  multiple widgets (a dashboard, a detail view, a report), each one
  ships its own full copy of the SDK inline — there's no shared chunk
  across separately-fetched `rawHtml` resources.
- **`rawHtml` content can't be browser-cached separately from the
  data** — it's the same string, re-sent and re-parsed on every
  resource read. If a resource is fetched very frequently (heavy
  polling, a resource re-rendered on every tool call) and payload size
  becomes a real problem, consider `externalUrl` content instead (an
  actual hosted URL) so the browser's normal HTTP cache can take over
  on repeat loads — a real architectural trade-off, not a default.

## 13. Test in two layers — neither is sufficient alone

**Headless protocol test** (spin up the built server, drive it with
`@modelcontextprotocol/client` over stdio, call every tool, assert
`structuredContent` shapes and that resources come back with the
correct `text/html;profile=mcp-app` mimeType). This catches: wire
protocol correctness, schema mismatches, server-side logic bugs, real
Tier 1/2 state transitions if you exercise them against a real backend
instead of mocks (this project's version creates a disposable resource,
drives it through a full mutation lifecycle, and cross-checks against
the real backend state at every step — not just what the tool claims
happened). It **cannot** catch anything about rendering, since it never
renders CSS or runs the widget's JS in a browser.

**Real rendering check** (§14) catches everything the protocol test
structurally can't: CSS bugs (§8, §9), JS runtime errors, actual click-
through UX, the `sendMessage` round trip actually reaching a host. Five
real bugs in this project; every one of them was only visible this way.

Run both. The protocol test is fast and belongs in normal CI-style
iteration; the rendering check is heavier but should happen at least
once per meaningfully-new UI surface, and again after any CSS/interaction
change — not just once at the end.

## 14. How to run a real rendering check before you have a target host

If your actual target host isn't available yet, or you want to
validate the *mechanism* independent of one specific host's quirks, use
the MCP Apps extension's own reference host —
`modelcontextprotocol/ext-apps`'s `examples/basic-host` — driven
headlessly with Playwright. Concrete recipe and gotchas:

1. **Don't `npm install` the example inside the cloned monorepo** — its
   root `package.json` has workspace/build scripts that will try to
   rebuild the whole repo. Copy `examples/basic-host` to a directory
   *outside* the clone, then `npm install` there; its dependencies
   (`@modelcontextprotocol/client`, `@modelcontextprotocol/ext-apps`,
   etc.) are plain published versions, not workspace links.
2. **Your server likely needs a temporary HTTP transport.** If it's
   stdio-only by design (a reasonable choice — see the local-only
   framing in `docs/design/mcp-ui-docker-ops.md` §1 for why this
   project is), `basic-host` still needs to reach it over Streamable
   HTTP. Write a small throwaway file that wraps your existing
   `createServer()` export with `NodeStreamableHTTPServerTransport`
   bound to `127.0.0.1`, point `basic-host` at it via
   `SERVERS='["http://127.0.0.1:PORT/mcp"]'`, and **delete the file
   when done — never commit it** if it contradicts your shipped
   design.
3. **Build both of `basic-host`'s bundles**: `INPUT=index.html vite build`
   and `INPUT=sandbox.html vite build` (it's a double-iframe host — see
   its own README for why), then run its `serve.ts`.
4. **Drive it with Playwright**, reaching your widget through the
   nested iframes:
   ```js
   const frame = page.frameLocator('iframe').first().frameLocator('iframe').first();
   await page.selectOption('select >> nth=1', 'your-tool-name');
   await page.click('button:has-text("Call Tool")');
   // now interact with `frame.locator(...)` as a real user would
   ```
5. **Capture console + `pageerror` + `requestfailed` events**, not just
   screenshots — several of this project's findings showed up as a
   console message or a failed request before they were visually
   obvious, and `pageerror`/`requestfailed` are the fastest way to
   separate "genuinely broken" from "looks a bit off."
6. **Background process management in a sandboxed dev session is
   fragile** — processes started with shell `&`/`disown` can get reaped
   between separate tool invocations. Use your environment's actual
   background-process primitive (not ad hoc shell job control) for
   anything that needs to outlive a single command.
7. **Actually click through the full user journey**, not just the
   first tool call: open detail views, switch every tab, trigger both
   confirm paths (cancel and confirm) on every tiered action, force a
   real failure (remove/invalidate what's currently displayed, then
   refresh). This is what found bugs 4 and 5 in this project, after an
   earlier, shallower pass had already declared rendering "verified."

## 15. Before you call it done

- [ ] Every tool has accurate `readOnlyHint`/`destructiveHint`/
      `idempotentHint`/`openWorldHint` annotations.
- [ ] Every Tier 1/2 action has a UI confirm *and* isn't pre-approved at
      the host level; elicitation used only where you've confirmed the
      target host supports it.
- [ ] Every `hidden`-toggled element's CSS was checked for the
      `display` trap (§9).
- [ ] Every themed color token has both the media-query and
      `[data-theme]` rule (§8), and you clicked the host's actual theme
      toggle to confirm it, not just the callback firing.
- [ ] Every `callServerTool` call site explicitly checks `isError`.
- [ ] At least one real failure/race path was tested per interactive
      element, not just the happy path.
- [ ] The full interaction surface was clicked through against a real
      (or reference) host at least once after the last UI change — not
      just the headless protocol test.
- [ ] No secrets-shaped data (env values, tokens, credentials) is
      returned by any read-only tool without explicit justification.
- [ ] Payload size is understood (§12), not guessed at.

## Appendix: where each lesson came from

Every lesson above has a fuller worked example in this repo:

- Kit choice, protocol/view split — `docs/design/mcp-ui-docker-ops.md` §6.
- Risk tiers, annotations, confirm-dialog implementation —
  `mcp-server/server.ts` (Stage 4 tools), `mcp-server/src/docker-dashboard.ts`
  (`ACTION_DEFS`, `showConfirm`).
- The report-building pattern — `build-investigation-report` in
  `mcp-server/server.ts`, and the `sendMessage` prompt text in
  `mcp-server/src/docker-dashboard.ts`/`mcp-app.ts`.
- Env-var redaction — `mcp-server/docker/tools/inspect.ts`.
- The theme, `[hidden]`, and `isError` bugs — see the git history on
  this branch for the exact commits, or `docs/design/mcp-ui-docker-ops.md`
  §12 for the narrative.
- The rendering-check recipe — same §12, "Recommended first spike" (§13)
  and the git history's `dev-http-harness.ts`/Playwright-script pattern
  (never committed, by design — see §14 point 2 above).
