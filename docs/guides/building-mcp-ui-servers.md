# Building an MCP-UI server: a field guide

Everything here was learned building `docker-skill` — a Docker ops
dashboard exposed through MCP tool results that render as interactive
UI (see `docs/design/mcp-ui-docker-ops.md` for that project specifically).
This document strips the Docker-specific parts out and keeps only what
should transfer to *any* MCP-UI server. Where something is a docker-skill
choice rather than a universal rule, it's marked as such.

Fourteen real bugs got found across this project, across six separate
rounds of build-and-break-it experimentation, and every one of them was
found by *actually running the thing* — rendering the page against a
real host, driving a real container restart against a real daemon for
the streaming ones, or running an automated tool (`axe-core`) against
the rendered DOM for the two contrast/theming bugs in round six — never
by the headless protocol tests, which were passing the whole time, and
never by eye. That's the single biggest lesson here, and it shapes most
of what follows. (A few more, across rounds four and five, were caught
by self-review before a render was ever needed — still worth naming,
but not part of that fourteen; see §20-22 and the design doc's round-4/
round-6 write-ups for the full count.)

A meta-lesson showed up more than once, in more than one shape: **a fix
needs the same real-conditions verification as the bug it fixes.** In
round two, a keyboard-trap fix (§16) shipped its first attempt with a
wrong CSS/JS selector that silently no-op'd the whole fix, caught only
by a second, more careful rendering pass. In round three, that same
pattern showed up twice more in a single feature: a `[hidden]`-on-`<svg>`
fix's first attempt looked right in the diff and was still wrong (§9),
and a streaming reconnect fix that worked cleanly for one container
restart quietly failed the same way on the *second* restart in a row
(§19) — caught only by testing two in sequence, not one. "I changed the
code that was wrong" and "I watched the new behavior happen, more than
once if the bug is about a gap between events" are not the same claim.

## TL;DR checklist

- [ ] Use the official kit for the wire protocol (§2) — don't hand-roll
      postMessage/JSON-RPC framing.
- [ ] Split protocol layer (kit-owned) from view layer (your DOM/CSS) (§3).
- [ ] Spike on something low-stakes before building the real thing (§4).
- [ ] Tag every tool with `readOnlyHint`/`destructiveHint`/`idempotentHint` (§5).
- [ ] Decide `tool` vs `prompt` per action deliberately (§6).
- [ ] Layer your confirm story: UI dialog + host permission prompt +
      annotations + elicitation where a host supports it — the mechanism
      itself is verified working against the SDK directly, so test your
      server's own behavior even without a host (§7).
- [ ] Give every `hidden`-toggled element a `[hidden]` CSS override if its
      class sets its own `display` — and don't assume an `<svg>` with no
      `display` rule in your own CSS is safe, the browser's own SVG
      stylesheet can be the thing overriding you (§9).
- [ ] Give every theme-aware color token both a media-query rule *and* a
      `[data-theme]` rule (§8) — and wire any third-party component's own
      theme prop to that same effective-theme logic explicitly, it won't
      inherit it for free.
- [ ] Run an automated contrast audit (`axe-core`) against every UI
      state that puts new text on screen, including transient ones like
      a toast — don't trust a color looking "clearly red enough" by eye
      (§22).
- [ ] Check `result.isError` explicitly at every `callServerTool` site —
      never rely on an incidental throw (§10).
- [ ] Test real failure paths (bad id, race conditions), not just happy
      path (§10).
- [ ] Guard against a second mutating action firing while the first is
      still in flight — a confirm dialog blocks a second *click*, not a
      second *concurrent tool call* (§17).
- [ ] Give every interactive dialog real keyboard support: initial
      focus, a Tab/Shift+Tab trap, Escape-to-cancel — and verify the
      trap by rendering it, not just by reading the code (§16).
- [ ] Check your layout at a phone-width viewport (~375px), not just
      whatever width your dev host happens to use (§18).
- [ ] For any live/streaming connection: don't trust the stream's own
      'end'/'error' events to notice the thing it's watching changed —
      poll external state and reconnect on that instead; give a
      reconnect a real resume point, not just "new data only"; test with
      two disruptions in a row, not one (§19).
- [ ] Actually render the page against a real host before calling
      anything done (§13-14). This is not optional. Re-verify fixes the
      same way you found the bug — a fix is a claim, not a fact, until
      it's been rendered too.

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
  right at first. Every byte of the view layer ships inlined in every
  tool result (see §12 on payload size — the protocol layer already
  costs ~230KB before your view code adds anything), and most MCP-UI
  screens (cards, tabs, forms, confirm dialogs) don't need component-
  tree management at small scale. Reach for something heavier
  (Preact+htm, a real framework) only once plain DOM code has visibly
  become the harder path to read or extend — not by default, and not
  just because a framework is your normal habit. If that line *is*
  crossed, don't rule out React specifically for being "too heavy" on
  principle — measure it (§12 has the numbers from doing exactly that)
  and decide with the real cost in hand, not a guess.

Don't use a charting library for a one-shot/non-streaming stat — a hand
rolled inline `<svg>` bar or sparkline is smaller and sufficient. Save
the heavier tooling for genuinely complex visuals (the official SDK's
own examples use Chart.js for a *streaming* CPU history chart, which is
a fair trade there — the shape of the problem, not a rule against
charting libraries in general).

**When you do reach for a full component framework, Radix-style
accessible primitives (Dialog/Tabs/Checkbox, via shadcn/ui or directly)
are worth their weight for anything resembling a confirm dialog.** §16
below is a whole section about how much manual effort a correct focus
trap/initial-focus/Escape-to-cancel took to get right by hand, and how
easy the first "fix" was to get subtly wrong. A maintained primitive
that implements that correctly out of the box turns a class of bug this
guide spent real space on into a solved problem — worth the added
payload specifically for dialogs, even in a codebase that's otherwise
staying with plain DOM/CSS everywhere else.

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
them one-click buttons that call mutating tools directly — see §7's note
on how this project eventually did wire that up safely (a fixed
server-side enum plus the *same* UI confirm dialog as everything else,
not a shortcut around it).

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
4. **Native host elicitation** (`inputRequired`/`inputRequired.elicit()`
   in `@modelcontextprotocol/server`), if the connected host supports it
   — the strongest option, since it routes confirmation through the
   *host's own UI*, not your iframe, so a compromised resource can't
   bypass it by construction. **The mechanism is confirmed working, not
   hypothetical** — tested directly against `@modelcontextprotocol/server`
   + `@modelcontextprotocol/client` (2.0.0, the latest published version
   as of this writing): a client with no `elicitation` capability gets a
   clean `isError: true` with a specific message (safe to rely on, easy
   to test without any host at all — see below); a client that declares
   `elicitation: {}` and registers an `elicitation/create` handler gets
   the entire multi-round-trip retry handled transparently by
   `client.callTool()`, no extra code needed on either side. What's
   *still* unconfirmed is any real host implementing the client half —
   as of this writing, `basic-host` (the official MCP Apps reference
   host) still doesn't declare the capability, so there's nothing to
   route through yet in practice. **Test your own server's behavior
   either way** without needing a host: connect a bare
   `@modelcontextprotocol/client` `Client` twice, once with no special
   capabilities (expect the clean refusal) and once with
   `{ capabilities: { elicitation: {} } }` plus a
   `setRequestHandler("elicitation/create", ...)` that auto-responds
   (expect the full round trip to succeed) — an
   `InMemoryTransport.createLinkedPair()` needs no network, no host, and
   no subprocess. Fall back to layers 1-3 when the capability isn't
   there, don't assume it is.

**Don't leak secrets through read-only tools.** Any tool's output
becomes part of the model's context. If your domain has something like
"env vars" or "config values" that commonly carry secrets, return
*names*, never values, by default. There's no good way to redact
selectively without a real secrets-detection pass, so be blunt about it.

**If you do wire up agent-authored one-click remediation, keep the same
gates a human-clicked button would have — don't let the report be a
shortcut around them.** Two things made this safe enough to actually
ship in this project: (1) a fixed, server-side enum of allowed
tool+target-shape combinations (the agent can *suggest* one of a known
set, never name an arbitrary tool), and (2) the button still opens the
exact same UI confirm dialog as a human-triggered action — same
initial-focus/Tab-trap/Escape handling (§16), same Tier 1/2 distinction,
same re-type-the-target-name requirement for anything destructive. The
agent's report picks *which* button appears; it never gets to skip the
click. Be conservative about going further than that.
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

**A component library brought in later doesn't inherit this wiring for
free — it needs the same dual-selector logic wired to it explicitly.**
A toast library (or any other component with its own `theme="light" |
"dark" | "system"` prop) reads `prefers-color-scheme` at best, which is
exactly half of the rule above — it has no way to know about a host's
`[data-theme]` override unless you tell it. The bug this produces is
easy to miss because it's not a rendering failure: the rest of the page
correctly goes dark, and the third-party component just quietly stays
on its own default theme, looking like a deliberate design choice
rather than a bug, until someone actually toggles the host's theme and
sees it. Read the *current effective theme* the same way your CSS
already computes it — the host's explicit override if set, else the OS
preference — and pass that into the component explicitly; keep it live
with a `MutationObserver` on the attribute plus a `matchMedia` change
listener, not just a one-time read at mount.

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

**A second, nastier variant: the overriding rule can come from the
browser itself, not your CSS.** An inline `<svg>` element toggled the
same way (`el.hidden = true/false`) stayed visibly rendered even with
*no* `display` rule anywhere in the project's own stylesheet — because
Chromium's own SVG default stylesheet includes `svg:not(:root) { ... }`
(every non-document-root `<svg>` matches this, which is all of them),
at specificity (0,1,1) — higher than a bare `[hidden]` at (0,1,0). Grepping
your own CSS for `display` on that element's class finds nothing, because
there's nothing to find; the fix still needs the same override:

```css
svg.your-class[hidden] { display: none; }
```

And even that isn't automatically the end of it: the first attempt to
fix this specific case used `el.style.display = hidden ? "none" : ""`,
which is still broken — an *empty* inline style clears the inline
override and falls back to the stylesheet cascade, which still matched
the `hidden` attribute if nothing ever actually removed it from the
element. Setting a concrete inline value (`"none"` / `"block"`) plus
`el.toggleAttribute("hidden", hidden)` to keep the attribute itself
honest is what actually works — checked by reading `getComputedStyle`
after toggling, not by re-reading the diff. If an SVG in your widget
ever needs to be conditionally hidden, verify it the same way you'd
verify any other `[hidden]` toggle — don't assume "no `display` in my
CSS" means it's safe.

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

**That ~15-20 KB application-code figure is a vanilla-DOM number,
not a universal one — measure again if you add a framework.** The same
project later rewrote all three of its widgets in React + Tailwind CSS
v4 + shadcn/ui (Radix primitives) on explicit request. Measured
directly, per resource, vanilla vs. React+Tailwind+shadcn:

| Resource | Vanilla DOM | React + Tailwind + shadcn | Multiplier |
|---|---|---|---|
| Smallest widget (system card) | 244 KB / 65 KB gzip | 526 KB / 151 KB gzip | 2.2× / 2.3× |
| Largest widget (fleet dashboard) | 273 KB / 72 KB gzip | 644 KB / 187 KB gzip | 2.4× / 2.6× |

Roughly 2.2-2.6× the vanilla baseline — React+ReactDOM+Tailwind's
generated CSS dominate the delta the same way the SDK dominates the
~236 KB floor above: a trivial widget with one button and one badge and
*zero* application logic already weighs about as much as the entire
vanilla dashboard did with all its business logic included. This isn't
a reason to avoid a framework — it's the number to have in hand before
deciding, per §3's updated guidance. Nothing about the CSP stance
changes: a `@tailwindcss/vite`-compiled, tree-shaken, fully-inlined
build stays entirely within the "no remote origin" rule (§11) — this is
purely an inline-payload cost, not a new constraint.

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
- [ ] Every confirm/modal dialog has real keyboard support, verified by
      rendering it — not just implemented (§16).
- [ ] Every color token used as text color was contrast-checked against
      every background it can appear on (including tinted/translucent
      ones), with an automated tool (`axe-core`), across every state
      that puts new text on screen — including a toast/notification, not
      just the resting view (§22).
- [ ] Every mutating action is guarded against firing concurrently with
      another one on the same target (§17).
- [ ] The full interaction surface was checked at a phone-width
      viewport, not just your dev host's default width (§18).
- [ ] Any streaming/live connection was tested against the thing it
      watches actually changing state (not just staying steady), twice
      in a row, and a wrong/missing auth token on it was confirmed
      rejected (§19).
- [ ] If elicitation is used anywhere, both the "capability declared"
      and "capability absent" paths were tested directly against the SDK
      (no host needed — §7).

## 16. Keyboard accessibility on dialogs — and verify the fix, not just the bug

A confirm dialog that only works with a mouse is a real accessibility
gap, and — for a *confirmation* dialog specifically — also a security
regression: the whole point of a re-type-the-name Tier 2 confirm is to
slow a destructive action down, and that protection means nothing if a
keyboard user can Tab past the dialog without ever reaching it. Three
things a modal needs, none of which a click-only test path will ever
exercise:

- **Initial focus** moves into the dialog when it opens — and to the
  *safe* control (Cancel), not the destructive one, so an accidental
  Enter doesn't fire the action.
- **A Tab/Shift+Tab trap** keeps focus cycling within the dialog's own
  focusable elements instead of leaking to the page (or the host)
  behind it.
- **Escape** closes the dialog as a cancel.

```ts
function dialogFocusables(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".confirm-dialog button, .confirm-dialog input"))
    .filter((el) => !(el as HTMLButtonElement).disabled && el.offsetParent !== null);
}
```

**The meta-lesson is more important than the checklist item.** The
first version of this fix in this project used `#confirm-dialog` in
that selector — the dialog's actual markup only has
`class="confirm-dialog"`, no matching id. `querySelectorAll` for a
nonexistent id silently returns an empty NodeList; `dialogFocusables()`
always returned `[]`; the trap's own guard clause (`if (focusables.length
=== 0) return;`) made it a complete no-op. Escape still worked (it
doesn't depend on that query), so a shallow retest — "does Escape close
it? yes, ship it" — would have called this fixed. It took a second,
more careful Playwright pass specifically walking the Tab sequence
(`document.activeElement` checked *inside the widget's own iframe
document*, not the ambiguous top-level view a nested sandboxed iframe
produces) to catch that Tab #2 still escaped the dialog entirely. **A
fix is a claim, not a fact, until you've rendered it and driven the
exact interaction it claims to fix** — the same discipline as testing
the original bug, applied again to your patch for it. Don't let "I
changed the code that was wrong" substitute for "I watched the new
behavior happen."

## 17. Guard against concurrent mutating actions

A confirm dialog's full-screen overlay blocks a second *click* while
it's open — but that only covers the window during which the dialog
itself is visible. Once a user confirms, there's typically a real gap
between "the tool call starts" and "the UI re-renders to reflect the
new state," and during that gap the *previous* set of action buttons is
often still live. If two different mutating actions are both available
in that state (e.g. Restart and Pause both showing for a running
container), a fast user can confirm one, then confirm the other before
the first's tool call has even returned — firing two mutating calls
against the same target concurrently, with only whichever one resolves
last ever reflected in the status message.

This is easy to prove empirically and easy to miss by reasoning about
the code alone (a code read that only checks "is the overlay open"
misses the gap entirely, since the overlay *is* closed for that whole
window). Verified in this project with Playwright by confirming one
action, then immediately confirming a second, distinct action on the
same target, and checking real backend state afterward — it landed in
a valid-but-unintended state (the second action's outcome, with the
first's result silently dropped).

The fix is a simple in-flight guard, the same shape as disabling a
"Submit" button during an async request — nothing more elaborate is
needed:

```ts
let actionInFlight = false;

async function handleAction(def: ActionDef): Promise<void> {
  if (actionInFlight || !currentTarget) return; // ignore a click while one's already committing
  const confirmed = await showConfirm(def);
  if (!confirmed) return;

  actionInFlight = true;
  setActionButtonsDisabled(true); // visible feedback — a silently-ignored click reads as "broken"
  try {
    await callTheAction(def);
  } finally {
    actionInFlight = false;
    setActionButtonsDisabled(false); // or let the post-action re-render handle it
  }
}
```

Two details worth keeping: guard at the *top* of the handler (a click
during the in-flight window should be ignored outright, not queued —
queuing a second confirm dialog for later is more confusing, not less),
and disable the buttons rather than relying on the guard alone — an
invisible no-op click looks like a bug to the user even when it's
correctly protecting them from one.

## 18. Check a phone-width viewport, not just your dev host's width

Not every layout bug is a broken one. A grid that's 2 items per row
regardless of viewport width can still pass "no horizontal overflow,
nothing visually cut off" at 375px and still be a real readability
regression: long values (a full CPU model string, a multi-word platform
string) get squeezed into a half-width column and wrap across 2-3
ragged lines, reading as garbled data rather than formatted text. This
project's reference host happens to render at a comfortable desktop
width by default, so this was invisible until deliberately resizing the
viewport — the same blind spot as testing only the happy path, just for
layout instead of logic.

Check with an explicit narrow viewport (Playwright:
`newPage({ viewport: { width: 375, height: 667 } })`, roughly
phone-width) as part of your rendering pass, not just your dev host's
default window size. Confirm two things, not just one: that nothing
overflows (`document.documentElement.scrollWidth <=
document.documentElement.clientWidth`, checked inside the widget's own
document) *and* that it's still comfortably readable — a screenshot is
the fastest way to catch the second, since "no overflow" alone doesn't
catch cramped wrapping. Where it matters, a single `max-width` media
query switching a multi-column grid to one column is usually enough —
confirm the wider-viewport layout is unchanged afterward, since this is
exactly the kind of change that's easy to over-apply.

Whether this matters for a *given* project depends on what hosts you
expect: not every MCP host renders at phone width today, but the
MCP-UI ecosystem includes hosts that do (mobile chat apps among them),
and checking costs one extra Playwright viewport size — cheap enough
to just always do it.

## 19. Streaming and live connections: plan for reconnect, don't trust the stream's own lifecycle events

If your widget wants live data instead of manual refresh, you're
probably running some kind of long-lived connection (a loopback SSE
sidecar the widget's `EventSource` reaches directly, most likely — a
browser can't open a Unix socket, so the mechanism the SDK/design doc
might gesture at for "local-only streaming" still ends up being a
loopback TCP port in practice). Two real bugs here, both found only by
scripting an actual disruption to the thing being watched — a container
restart, in this project's case — never by reasoning about the
streaming library's API.

**Don't assume the underlying stream tells you when the thing it's
watching goes away.** A `docker logs -f`/`docker stats --stream` style
connection, attached before the container it's following restarts, just
went quiet afterward — no `'end'`, no `'error'`, nothing a `stream.on(...)`
listener would ever see. The fix wasn't a smarter stream handler; it was
giving up on the stream's own signals for detecting this at all, and
polling the thing's *external* state instead (a `setInterval` checking
the container's `StartedAt` timestamp) to force a reconnect when it
changes. The general version: if what you're streaming has a lifecycle
independent of the connection (a process that can restart, a resource
that can be replaced), don't trust the connection's own events to tell
you that happened — poll the state directly and react to *that*.

**A reconnect's "resume from where we left off" logic needs a real
starting point, not just "whatever we last received."** The first fix
tracked a resume timestamp from the last line actually delivered,
defaulting to "only brand-new data" until something arrived. That
silently reintroduced the exact gap it was built to close, for the one
case that matters most: a source that produces output once and then
goes quiet (a container that logs a single startup line, say). Nothing
was ever received to set the resume point, so *every* reconnect fell
back to "only new data from right now" — permanently missing whatever
the next restart's startup line was, forever, not just once. The fix:
track "the moment this connection started watching," independent of
whether anything was ever received, and only move it forward when real
data actually arrives. Test this specifically by triggering **two
disruptions in a row** — the first version passed a single-restart test
completely cleanly, because the gap it left only shows up on the
*second* one.

**A loopback sidecar needs its own lightweight auth, even on
127.0.0.1.** Any process on the same machine can reach a loopback port —
the same "localhost dev server" trust assumption every local tool with a
UI ships with, and worth naming rather than ignoring. A random
per-process token, checked with a timing-safe comparison and handed to
the widget only over the existing MCP tool-call channel (never baked
into the static, cacheable HTML bundle), is enough for a local,
single-user tool without adding real auth infrastructure. Verify the
rejection path works, not just the happy path — a client fetching the
stream URL with a wrong or missing token should get a clean 403, and
that's worth a one-line automated check.

## 20. Optimistic UI and shared refresh paths: two more failure shapes

Two lessons from a round of purely additive, lower-risk-looking work
(search/filter/sort, bulk actions, loading-state polish) — a reminder
that "not a new architectural surface" doesn't mean "can't ship a bug."

**A bug of omission hides in whichever function becomes the new central
point something used to reset ad hoc.** Adding client-side search/filter/
sort meant every `docker-ps` refresh now had to flow through one
`setContainers()` function instead of calling the renderer directly, so
that filtering could be reapplied consistently. That function correctly
cleared the (also new) bulk-selection state on every refresh — but
nothing told the bulk toolbar to re-render, so it kept showing a stale
"N selected" after an action completed and the selection had, in fact,
already been cleared. Nothing about the code *looked* wrong; a smaller
diff (calling the renderer inline, as before) would never have had this
seam at all. When you introduce a new shared choke point that several
call sites used to reach independently, explicitly re-check that every
side effect those call sites used to trigger separately still happens —
"I cleared the state" and "I told the UI the state changed" are two
different lines, and it's easy to write only the first.

**A fast local round trip can make "does the loading state actually
show" impossible to confirm by looking.** An optimistic-loading fix
(show the clicked item's already-known data immediately, plus a
skeleton, instead of stale previous-item data until the real response
arrives) is impossible to *dis*confirm by watching a real host over a
real network — a slow response is exactly the case it's for. But
confirming it worked, in a local dev loop where the full round trip can
resolve in under 20ms, hits the opposite problem: a screenshot or a
`waitForTimeout`-then-check taken any real amount of time after the
triggering click will simply never catch the skeleton, because it's
already gone — and that absence looks identical to "the skeleton never
rendered at all," which is the actual bug this fix exists to prevent.
Resolve the ambiguity by instrumenting, not by looking harder: a
`MutationObserver` on the container being updated, logging each mutation
with a timestamp, shows definitively whether the intermediate state
existed and for how long, independent of how fast it disappeared. If a
piece of UI is designed to be transient, "I saw it" and "I have evidence
it rendered" are not the same claim, and only the second one survives
someone asking "are you sure?"

## 21. Porting a widget to a component framework: keep the SDK registration at module scope

If you move a widget from vanilla DOM/JS to React (or any framework with
a component lifecycle), §2's rule — register `ontoolresult`/
`onhostcontextchanged`/etc. before `connect()`, because the host can
message you right after the handshake — gets easy to violate by
accident, in a way that's specific to frameworks and didn't exist in
the vanilla version at all.

**A `useEffect` (or equivalent lifecycle hook) runs *after* the first
render commits, which is already too late.** The natural first draft
of a port puts the SDK setup — creating the `App`, wiring
`ontoolresult` — inside the root component's mount effect, because
that's where "do a thing when this component starts up" normally goes
in component-framework code. But the vanilla version's equivalent code
ran at module/script-evaluation time, before the DOM had even finished
its first paint — a strictly earlier point than any lifecycle hook can
reach. Moving SDK setup into a `useEffect` narrows, but does not close,
the race the vanilla version accidentally avoided for free: a host that
messages immediately after the handshake can still beat the first
effect run. This is exactly the kind of bug that won't show up against
a fast local reference host (round 4's own optimistic-UI lesson, §20)
and won't show up in a headless protocol test either (§13) — it needs a
slow-enough or eager-enough real host to actually manifest, so don't
wait to find it empirically. Catch it by re-reading the port's diff
against §2's rule directly, the same way you'd check a new
`hidden`-toggled element against §9's rule: create the SDK client and
register every handler it needs at **module scope** — plain top-level
code in whatever file first imports the SDK — exactly as the vanilla
version did, and treat "this runs before React exists" as a hard
requirement, not a nice-to-have.

**Bridge the SDK's push-style callbacks into component state with
`useSyncExternalStore`, not a `useEffect` subscription.** Once
`ontoolresult` etc. live at module scope, a component still needs to
re-render when new data arrives. The correct primitive for "a
component tree needs to react to a mutable value that changes outside
React's own render cycle" is `useSyncExternalStore(subscribe,
getSnapshot)` — not a `useState` initialized from a `useEffect`
subscription, which reintroduces its own version of the same
too-late-to-catch-the-first-message problem for the exact same reason.
The subscribe/notify plumbing is a dozen lines (a `Set` of listener
callbacks, notified from the module-scope callback, unsubscribed on
unmount) and is worth writing once per widget rather than reaching for
a state-management library for this alone — matches this guide's own
running theme of not reaching for heavier tooling than a problem
actually needs.

## 22. Run an automated contrast audit — manual keyboard testing doesn't cover it

§16's keyboard-accessibility checklist (initial focus, a Tab trap,
Escape-to-cancel) and this section are testing two different axes of
accessibility, and passing one says nothing about the other. A
confirm dialog can have a flawless focus trap and still fail for a
low-vision user if its text is 3:1 against its background instead of
the 4.5:1 WCAG AA requires for normal-size text (3:1 only applies to
large text — 18pt, or 14pt bold — and to non-text UI components like
borders and icons). Nobody reliably self-catches this by eye: four
prior rounds of this project's own screenshots and manual review never
flagged it, because a slightly-too-light red or amber still *reads* as
"clearly red" or "clearly amber" to a sighted reviewer looking for
roughly the right color, not measuring the actual ratio.

**Run `axe-core` against the widget's own document, not the host
page.** Inject it into the actual iframe your UI renders in — for a
doubly-sandboxed host like the MCP Apps reference implementation, that
means resolving the real nested `Frame` object, not a `FrameLocator`
(which can't take a script injection):

```js
const outerFrame = await (await page.locator('iframe').first().elementHandle()).contentFrame();
const innerFrame = await (await outerFrame.locator('iframe').first().elementHandle()).contentFrame();
await innerFrame.addScriptTag({ content: axeSource }); // read axe.min.js off disk first
const results = await innerFrame.evaluate(() => window.axe.run(document, { resultTypes: ['violations'] }));
```

**Check every state that puts new text on screen, not just the
default view — a toast notification is easy to forget.** The default
card-list/detail-panel views passed cleanly on the first pass in this
project; the violations were only in text that only exists transiently
(a confirm dialog's own copy, a toast's success/error message). If your
audit script never triggers the action that produces a toast, it never
checks the toast's contrast — an audit that only covers a widget's
resting state has a real coverage gap, the same shape of gap as testing
only the happy path (§10).

**A finding at 4.3-4.4:1 that vanishes and reappears between runs is
probably an animation timing artifact in your test, not a flaky bug in
the app.** `axe-core`'s contrast check samples actual rendered pixels;
caught mid-fade-in (a toast library's entrance transition, say), that
sampling can return a genuinely different, lighter blended color than
the element's settled CSS value — read a computed-style property
directly (`getComputedStyle(el).color`) to check whether the *value* is
right, independent of whether the audit happened to run mid-animation;
if the computed value is already correct, wait longer before the next
audit pass rather than chasing a bug that isn't there.

**Fix real findings at the token level, computed, not eyeballed.** If a
CSS custom property is used as text color anywhere, contrast-check it
against every background it can actually appear on (plain page
background and any tinted/translucent surface you build with it, like
a `color-mix()` or low-opacity fill) — a token that passes on white can
still fail against its own 10-40%-opacity self. Compute replacement
colors with the actual WCAG relative-luminance formula rather than
picking a slightly-darker shade and hoping; a browser console one-liner
or a five-line script is enough, and it's the same rigor §16 already
asks for when re-verifying a keyboard fix — a color choice you're
confident about and a color choice you've measured are not the same
claim.

## Appendix: where each lesson came from

Every lesson above has a fuller worked example in this repo. **Note on
paths below for rounds 1-4:** they point at the vanilla-DOM file layout
(`src/docker-dashboard.ts`/`.css`, `src/mcp-app.ts`/`.css`,
`src/investigation-report.ts`/`.css`) that round 5 replaced with a
React/Tailwind component tree under `src/dashboard/`, `src/system-card/`,
`src/report/` — those exact files no longer exist on this branch's HEAD.
Use the branch's git history to see them (`git log --all --
mcp-server/src/docker-dashboard.ts`), or read the equivalent logic in its
new location per round 5's own appendix entry below; the underlying
lesson (what the bug was, why the fix works) is unchanged by the
rewrite, only the file it lived in moved.

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
- The keyboard-accessibility fix (and its own wrong-selector bug) —
  `showConfirm`/`dialogFocusables` in `mcp-server/src/docker-dashboard.ts`.
- The concurrent-action guard — `actionInFlight`/`setActionButtonsDisabled`
  in the same file, used from `handleAction`.
- The narrow-viewport fix — the `@media (max-width: 420px)` block in
  `mcp-server/src/mcp-app.css`.
- All three round-2 experiments — `docs/design/mcp-ui-docker-ops.md` §12,
  the bullet after the "Five further experiments" one.
- The SVG `[hidden]` trap and its own two-attempt fix —
  `setSvgHidden` in `mcp-server/src/docker-dashboard.ts`, and the
  `.sparkline[hidden]` rule in `mcp-server/src/docker-dashboard.css`.
- The streaming reconnect logic (both bugs) — `waitForStreamEndOrRestart`
  and the `sinceUnixSeconds` tracking in `mcp-server/docker/stream/sidecar.ts`.
- The loopback-sidecar token auth — `timingSafeTokenMatch` and the
  `stream-info` app-only tool, same file and `mcp-server/server.ts`.
- The elicitation round-trip verification (both paths) — this guide's
  own §7 point 4 describes the exact test; the script itself was
  scratch/temporary (an `InMemoryTransport` pair, never committed) —
  reproduce it from that description if you need to re-check a newer
  SDK version.
- The gated remediation-button pattern — `RemediationActionSchema` in
  `mcp-server/server.ts`, and `runRemediation`/`showConfirm` in
  `mcp-server/src/investigation-report.ts` (a near-verbatim port of the
  dashboard's own confirm-dialog code, including its accessibility fix).
- The compose-project grouping and teardown — `renderCards`'s project
  grouping and `handleProjectDown` in `mcp-server/src/docker-dashboard.ts`,
  `stopComposeProject` in `mcp-server/docker/tools/actions.ts`.
- All of round 3 — `docs/design/mcp-ui-docker-ops.md` §11 items 5-7 and
  the bullet after the round-2 one in §12.
- All of round 4 (search/filter/sort, richer detail, bulk actions,
  UI/UX polish) — `docs/design/mcp-ui-docker-ops.md` §11 item 8 and the
  round-4 bullet at the end of §12, including the stale-bulk-toolbar bug
  a Playwright assertion caught and the `prefers-reduced-motion` toast
  fix a self-review caught first.
- Round 5 (the React + Tailwind + shadcn/ui rewrite) — `docs/design/
  mcp-ui-docker-ops.md` §6.1's update and §11 item 9. The module-scope-
  registration fix from this guide's own §21 —
  `mcp-server/src/system-card/mcp.ts`'s `useSystemInfoResult` (and its
  siblings `useIncomingContainers` in `src/dashboard/mcp.ts`,
  `useIncomingReport` in `src/report/mcp.ts`), all built on
  `useSyncExternalStore`. The Radix-backed confirm dialog —
  `useConfirm` in `src/dashboard/ConfirmDialog.tsx`, its
  `onOpenAutoFocus` override for the Cancel-not-destructive initial-
  focus rule in `src/components/ui/alert-dialog.tsx`, shared as source
  by both `src/dashboard/DashboardApp.tsx` and `src/report/ReportApp.tsx`.
  The Tailwind theme-variable wiring that keeps §8's dual light/dark
  selectors working — `@theme inline` in `src/styles/theme.css`.
- Round 6 (the `axe-core` accessibility audit) — `docs/design/
  mcp-ui-docker-ops.md` §11 item 10 and this guide's own §22. The
  retuned, computed (not eyeballed) color tokens and the code comment
  showing the exact contrast numbers — `src/styles/theme.css`'s `:root`
  block. The `sonner`-not-wired-to-the-host-theme bug and its fix —
  `useEffectiveTheme` in `src/lib/theme.ts`, used from
  `src/dashboard/DashboardApp.tsx` and `src/report/ReportApp.tsx`, plus
  the `[data-sonner-toaster]` variable override right below the token
  block in `theme.css`. The audit script itself (nested-iframe `axe-core`
  injection, eleven UI states) was scratch/temporary, never committed —
  reproduce it from §22's recipe if you need to re-check after a future
  change.
