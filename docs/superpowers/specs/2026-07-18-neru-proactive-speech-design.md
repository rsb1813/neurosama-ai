# neru Proactive Speech (#3) — Design Spec

**Status:** Design approved (brainstorming), ready for implementation plan.
**Date:** 2026-07-18
**Subproject:** #3 Proactive speech.

## Goal

Make neru feel alive: when the conversation goes quiet, she speaks up on her
own — riffing in character and naturally bringing up things she remembers —
instead of only replying when spoken to. This is a defining Neuro-sama trait.

## Decisions (from brainstorming)

- **Trigger: idle timer only.** After ~45s of no user activity (and neru not
  already speaking / no turn in flight), she says something unprompted.
  Event-driven triggers (chat messages, notifications) are deferred to #4.
- **Content: personality riffing + memory.** She riffs in character and may
  surface a remembered fact (memory is already injected into every prompt by
  the #2 recall context provider). **No autonomous web search** on idle for
  this version — that's a deliberate policy choice, not an architectural limit
  (see Extensibility).
- **Consecutive cap.** If neru speaks proactively N times (default **2**)
  without any user reply, she goes quiet until the user speaks again (which
  resets the counter). Avoids monologuing to an empty room and burning proxy
  tokens.
- **Never interrupt.** Proactive speech never fires while a turn is in flight,
  while neru is speaking, or while the user is actively typing.

## Core design principle: content-agnostic trigger

The idle scheduler's only job is to **trigger a chat turn** when the room has
been quiet. *What neru does in that turn* is a separate, swappable **policy** —
a short "nudge" seed plus whatever tools are available that turn. Because a
proactive turn runs the **exact same pipeline as a normal reply** (LLM proxy →
English voice + `<ko>` subtitle → memory context → emotion tokens → the
always-on `remember`/`webSearch` tools), the trigger is decoupled from content.

This is what makes the feature future-proof:
- **Today's policy** = "riff + use memory, don't search" (a nudge string).
- **Later (#7 computer agent / autonomous idle actions):** enabling neru to
  *autonomously search or use the computer* when idle is a **policy change**
  (swap the nudge / broaden tool guidance), **not an architecture change** —
  `webSearch` is already always-on in the turn, and future computer-agent tools
  would be exposed the same way. Keep the nudge/policy an isolated, replaceable
  unit so this stays a one-line swap.

## Architecture

A renderer-side **idle scheduler** (`useProactiveSpeech` composable) watches
three signals — last user activity, whether a turn is sending, and whether neru
is speaking (`nowSpeaking`) — and runs a small state machine:

```
idle for >= idleDelayMs
  AND not sending AND not nowSpeaking AND consecutive < maxConsecutive
    → trigger a proactive turn (send the nudge seed through the normal chat path)
    → consecutive += 1
any user message
  → reset consecutive = 0, reset idle timer
```

The proactive turn is seeded with a short **nudge** that instructs neru to speak
unprompted and stay brief; the nudge is injected so it drives the turn **without
appearing as a user utterance** in the visible history (exact mechanism — a
hidden/system-tagged seed or a non-persisted proactive message — settled in the
plan; it must not render as if the user said it).

## Components (files — exact paths settled in the plan)

| Unit | Responsibility |
|------|----------------|
| `useProactiveSpeech` composable (stage-ui renderer) | The idle-timer + guards + consecutive-cap state machine. Pure-ish and unit-testable via an injected clock and an injected `trigger()` callback. Config: `idleDelayMs` (default 45000), `maxConsecutive` (default 2), `enabled`. |
| Proactive nudge/policy (isolated constant/module) | The short seed instruction ("you've been quiet — say something on your own: riff, react, or bring up something you remember; keep it short"). The **swappable policy** unit (see Extensibility). |
| Wiring in `Stage.vue` (or a sibling) | Starts/stops the scheduler; feeds it the `sending` / `nowSpeaking` / user-activity signals it already has; calls `trigger()` = send the nudge via the existing chat path; resets the counter on a real user send. |
| Config surface | MVP may hardcode the three config values as documented constants (with env override if trivial); a settings-UI toggle is optional/out-of-scope for v1. |

Design for isolation: the composable owns the *timing/guard/cap* decision and
knows nothing about chat internals (it calls an injected `trigger`); the wiring
owns the *chat integration*; the nudge owns the *content policy*. Each is
understandable and testable alone.

## Data flow

```
user goes quiet (no activity for idleDelayMs)
  → scheduler timer fires
    → guards: not sending, not nowSpeaking, consecutive < maxConsecutive?  (any false → skip, re-arm)
    → trigger(): send proactive nudge seed through the normal chat send path
      → normal LLM turn (proxy) → neru speaks: English voice + <ko> subtitle + emotion; may reference memory
    → consecutive += 1; re-arm idle timer
  ... repeats until consecutive == maxConsecutive → quiet
user sends a message → consecutive = 0, timer reset → proactive speech re-enabled
```

## Guards / control (must-haves)

- Do not fire while `sending` is true, while `nowSpeaking` is true, or while a
  proactive turn from this scheduler is itself in flight (no overlap/pile-up).
- Do not fire while the user is actively composing input (typing) — treat
  keystrokes / input focus as user activity that resets the idle timer.
- Any real user message resets `consecutive` to 0 and re-arms the timer.
- Debounce so a burst of activity signals doesn't thrash the timer.

## Error handling

- If a proactive turn fails (LLM/proxy error), do not loop or crash: count it
  like a normal proactive turn (it still advances toward the cap) and re-arm;
  never retry-storm. (Search being unavailable is already graceful from
  #internet, and this version doesn't search anyway.)
- If the scheduler is disabled or teardown happens (unmount), clear timers
  cleanly (no dangling intervals).

## Testing

- **Unit (the state machine):** with an injected fake clock and a mock
  `trigger`, assert: fires after `idleDelayMs`; does NOT fire while
  sending/speaking; stops after `maxConsecutive` un-answered fires; a user
  message resets the counter and re-enables; teardown clears timers. This is
  the bulk of the value and is fully deterministic.
- **Nudge/policy:** a trivial test that the nudge instructs unprompted,
  brief, in-character speech (regression guard, like the persona tests).
- **Manual (end-to-end):** launch neru, leave it idle → she speaks in English
  voice with Korean subtitle; keep ignoring → she stops after N; send a
  message → she resumes on the next idle window; confirm she never talks over
  herself or interrupts a user turn.

## Out of scope (YAGNI / deferred)

- **Event-driven triggers** (chat/notifications) → #4.
- **Autonomous web search or computer use on idle** → deferred; the
  architecture is intentionally ready for it (content-agnostic trigger) but the
  v1 policy is riff+memory only.
- Voice/mic input changes (on hold), multi-persona, a settings UI for the knobs.

## Rejected / considered alternatives

- **Reuse AIRI's `spark-notify` event system as the trigger.** It's a heavy,
  server/WebSocket-oriented event→agent→command pipeline (priority, interrupt,
  multi-agent). Overkill for a local idle timer; it's the natural backbone for
  #4's *event*-driven proactivity later, not for this idle-only v1. Rejected for
  now.
- **Inject the nudge as a visible fake user message.** Simplest, but pollutes
  the chat history with lines the user never said and reads as neru replying to
  herself. Rejected in favor of a seed that doesn't render as a user utterance.
- **A separate always-running background "prompter" service in the main
  process.** More moving parts; the idle signals (activity, speaking, sending)
  all live in the renderer, so the scheduler belongs there next to them.

## Open questions (settle during implementation)

- Exact nudge injection mechanism that avoids a visible fake user message
  (hidden/system-tagged seed vs. non-persisted proactive message) — pick the
  cleanest fit with the chat store's message model.
- Whether the three knobs are hardcoded constants or env-overridable for v1
  (settings UI is out of scope).
- Precise idle-activity signal wiring in `Stage.vue` (which existing refs/hooks
  represent "user is active").
