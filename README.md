# dsh-voice-alert

[![CI](https://github.com/BUGLAN/dsh-voice-alert/actions/workflows/ci.yml/badge.svg)](https://github.com/BUGLAN/dsh-voice-alert/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin: it plays one
sound when a session shows as finished in the sidebar, plays another when the sidebar shows
that dsh needs you to answer or choose, can raise a Windows/macOS system notification for
either moment, and adds a **Sound alerts** (语音提醒) page to Settings where all of it is
configured.

[中文说明 →](README.zh-CN.md)

## What it does

Both alerts copy the sidebar's own status dots: the plugin derives each session row's dot
from the same inputs the sidebar uses, so a sound means what the dot means.

| Alert | Trigger | Default |
|---|---|---|
| Completion sound (`chime-up`) | a top-level session row shows the green dot: nothing is pending, the session is not running, no direct child is running, and its turn has ended | on |
| Reply-needed sound (`ask-up`) | a top-level session row shows the yellow dot: a question, a plan review, or an approval is waiting for you | on |
| System notification | the same two moments, as a Windows/macOS notification | off (opt-in) |

A row can only show a dot if the sidebar draws it at all. A session this browser has no
catalog row for — a teammate whose catalog was loaded by another window — is unknown, and an
unknown row alerts for nothing. Nor does a session that is a subagent or carries a parent, an
archived session, or a blank New Session row.

The green dot is not "the turn ended", it is "the work stopped": a turn that starts again
inside `completionDelayMs` (default 1200 ms) cancels its own alert, and a session that still
has a direct child running keeps showing the spinning dot instead of the green one, so a
parent that stops while its teammate works stays silent until the last child stops. That
last child stopping is what turns the row green, and it alerts exactly once.

One finished turn alerts once. The turn's own number is its identity, so re-reaching the same
finished state — a repeated snapshot, or a running flag that blips while the session list
catches up with the status stream — never raises the alert again; only a turn the log has
actually advanced to does. When the turn cannot be named because the view had already retired
the window, the stop that raised the alert carries the credit instead, so opening that session
afterwards does not report the same stop a second time.

The turn's own log says why it ended (`turn/end` carries a reason): `completed`, `blocked`
and `max-tokens` alert; `aborted` (the user, a parent agent, a hook or disposal),
`interrupted` and `forked` stay silent. That log only ever refines an alert the status
signal already raised — it never raises one by itself, because opening a session for the
first time materializes its log, and the last turn of that log may have ended long before
this page existed. Leaving a session retires this browser's event window for it, so a
background session has none: the sidebar's own unread mark (its green dot) still alerts, and
only the window-backed refinements — the reason, the failure text, and the latest prompt —
fall back to their defaults.

The two signals are held to different standards, because only one of them already means
"finished". The sidebar's unread mark is that dot, so it alerts by itself. This browser's own
running-true→false observation is not: the session may have finished, or you may have stopped
it, and only the durable log tells the two apart. So that edge alerts when a readable window
proves the newest turn ended (`completed`, `blocked`, `max-tokens`) and stays silent when the
turn was cancelled, still open, or unreadable. A session you stop and leave is the case that
proves it: the view retires the window while the stop settles, and an idle edge with nothing
left to prove it is not a finish.

### When it stays silent

- you pressed stop / cancelled the turn (`aborted`, reason `user` or `parent`);
- the session stopped while this browser could no longer read its turn: without a readable
  end and without the sidebar's unread mark, an idle edge is a stop as easily as a finish;
- the turn was closed by a crash-repair or fork marker (`interrupted`, `forked`);
- the row belongs to an internal run: a subagent or teammate session
  (`origin: 'subagent'`, or any session with a `parentId`), whose ends happen constantly
  during ordinary work — and equally when this browser has no catalog row for it at all;
- the row still has a direct child running (the sidebar shows the spinning dot, not the
  green one);
- the turn resumed before the debounce elapsed;
- the matching switch is off, the master switch is off, or `notifyBackgroundOnly` is on and
  the window is in front.

### What a toast says

The title is always that session's `displayTitle` and carries no icon. The body opens with a
status icon, then the work's name: it is the newest prompt the user themselves sent in that
session, collapsed to one line and bounded to 120 characters, so a completion reads as the
thing you asked for rather than as the session's auto-generated title. A user-role message is
not always a prompt — injected context (workspace instructions, skill catalogs, teammate
framing) arrives in the user role too — so only `source.kind === 'user'` counts.

| Icon | Meaning |
|---|---|
| `🐳` | the completion alert for a turn that ended normally |
| `🌀` | the completion alert for a turn that ended in an error |
| `❗` | the reply-needed alert (a question, plan review, or approval is waiting) |

The icon always leads the body, whatever the body turns out to be — your explicit text
override, the failure message, the latest prompt, or the built-in copy — because it names the
event rather than the text. Body precedence per alert is unchanged: your explicit text
override, then (for a turn that ended in an error) the failure message, then the latest
prompt, then the built-in copy. The session title never becomes the body. The settings page's
**Send a test notification** button is not an alert, so its body has no icon.

**An error is not a third alert.** It has no title, switch or tone of its own: a failed turn
raises the completion alert with the completion sound and the completion switch, and the
error message only supplies the body — its icon is `🌀` instead of `🐳`. The error title and
body entries the settings dictionary used to carry are gone.

## Requirements

- **DeepSeek Harness** — a build whose client exposes `uiSession.sessionStatus` and the
  `settings.section` slot (the 0.1.7 line and newer).
- **Node.js** 22.19+ or 24+ for the dsh process that loads the Host half.
- **Runtime** — the desktop app or the web UI. Sounds play in the page, so the page needs a
  user gesture at least once; notifications use the renderer's `Notification` API, which the
  desktop shell routes to the OS notification center.

### System notifications on macOS

The notification switch and the sound switches are independent, and the notification one is
off by default **per machine**: with only the sounds on, macOS plays a tone and never raises a
banner — which is usually the whole difference from a Windows machine where the toggle was
turned on. To diagnose:

1. Turn on **Enable system notifications** in Settings and press **Send a test notification**.
   The page then reports the receipt: the system accepted it, or it got no receipt.
2. On "no receipt", check **System Settings → Notifications → DeepSeek Harness**: allow
   notifications, set the style to Banners, and make sure Focus is not silencing them.
3. macOS only asks for authorization when this app posts its first notification, and it drops
   that very notification. The plugin re-sends that first delivery once; if the first test
   still shows nothing, press it again after allowing the system prompt.
4. Clearing **Only while the window is not in front** makes alerts fire while the app is
   frontmost too — but macOS tends to file a frontmost app's notifications straight into
   Notification Center, so put the window behind another app while testing.

## Install

A DSH profile installs plugins as **bundles**, and this package is one: it ships
`cordis.patch.yml` and declares `dsh.bundle.patch`, so a profile only has to depend on it.

**Through dsh (recommended).** Ask the agent to install the bundle, or call the plugin
manager tool directly:

```jsonc
{ "action": "install_bundle", "target": "github:BUGLAN/dsh-voice-alert" }
```

A git spec is fetched with git, so the machine needs network access to github.com. The
install adds `dsh-voice-alert` to the profile's `dsh.profile.bundles`, records the dependency
in the profile's `package.json`, and links it into the profile's `node_modules`. There is no
build step — `lib/` ships in the repository.

**By hand.** In `~/.dsh/profiles/<profile>`:

```sh
pnpm add github:BUGLAN/dsh-voice-alert
```

then add `"dsh-voice-alert"` to `dsh.profile.bundles` in that profile's `package.json` and
start dsh.

### Update, disable, remove

```jsonc
// turn the plugin off without uninstalling it
{ "action": "set_plugin", "target": "include:voice-alert", "enabled": false }
// uninstall
{ "action": "remove_bundle", "target": "dsh-voice-alert" }
```

To update, run `pnpm update dsh-voice-alert` in the profile directory: a `github:` spec
tracks the default branch, and pnpm pins whichever commit it fetched, so an update is what
moves it to a newer one.

## Settings page

Settings → **Sound alerts** (语音提醒), order 60, right after Agent presets:

- a master sound switch and a volume slider;
- one block per sound — completion and reply-needed — each with its own switch;
- a built-in tone picker (8 tones; picking one saves it and immediately previews it) plus a
  **Preview** button;
- an optional custom audio file (≤ 1.5 MB) stored as a data URL, with **Clear** to return to
  the built-in tone;
- a **System notifications** block: its own switch, one switch per event, a
  notify-only-while-the-window-is-behind switch, optional body-text overrides per event, the
  current permission state, and a **Send a test notification** button that requests
  permission and raises a real notification so you can see and place it.

The OS sound of a notification is suppressed whenever this plugin already played its own
sound for that event, so you never hear two alerts; with the plugin's sound off, the
notification keeps the OS sound.

## Configuration

Every preference is a Config field of this plugin's entry, so it can be set from the
profile's `cordis.yml` / `cordis.patch.yml` (or the Plugins page's config editor) as well as
from the Settings page:

| Key | Type and default | Meaning |
|---|---|---|
| `enabled` | boolean, `true` | master switch for both sounds |
| `volume` | number 0–1, `0.6` | playback volume, as a fraction of full scale |
| `completionEnabled` | boolean, `true` | play a sound when a session row shows the green dot |
| `completionTone` | string, `chime-up` | built-in tone used when no custom file is set |
| `completionFile` | string, `''` | custom completion sound, as a data URL |
| `completionDelayMs` | number 0–60000, `1200` | debounce before the completion alert; `0` disables it |
| `waitingEnabled` | boolean, `true` | play a sound when a reply is needed |
| `waitingTone` | string, `ask-up` | built-in tone used when no custom file is set |
| `waitingFile` | string, `''` | custom reply-needed sound, as a data URL |
| `notifyEnabled` | boolean, `false` | raise a system notification in addition to the sound |
| `notifyCompletion` | boolean, `true` | notify when a session row shows the green dot |
| `notifyWaiting` | boolean, `true` | notify when a reply is needed |
| `notifyBackgroundOnly` | boolean, `true` | notify only while the window is not in front |
| `notifyCompletionBody` | string, `''` | completion notification body; empty uses the built-in text (the status icon is prepended either way) |
| `notifyWaitingBody` | string, `''` | reply notification body; empty uses the built-in text (the status icon is prepended either way) |

The 8 built-in tones: `chime-up` (bright rise), `chime-down` (soft fall), `bell`, `ping`,
`double`, `triple`, `ask-up` (light rise), `ask-down` (light fall). `completionFile` and
`waitingFile` are written by the Settings page's file picker; setting one by hand means
pasting the whole data URL.

### Where a value comes from

Preferences are read in layers, each overriding the one before it:

1. built-in defaults in the browser half;
2. this entry's Config, injected into the page as `window.__DSH_VOICE_ALERT__` — so a
   `cordis.patch.yml` value or the Plugins page's config editor takes effect;
3. the browser's `localStorage` mirror, which is what the Settings page writes;
4. the durable Host settings namespace `voice-alert`, active when the profile composes a
   settings provider.

A profile without a settings provider still works: layer 4 is inactive, the page's writes are
browser-local (durable across reloads and app restarts, per browser), and the page says so.
Adding a settings provider needs no change here — the Host half already registers the
namespace, and the scope then outranks the mirror automatically.

## Development

```sh
npm install
npm test        # node tests/smoke.mjs && node tests/host.mjs
```

`tests/smoke.mjs` runs `lib/client.js` under stubbed browser globals and a stubbed Cordis
context, then drives the session-status and session-list observables: the Settings section
registers, controls write, both sidebar-dot alerts fire, and the no-alert cases stay silent —
including a subagent or teammate that finishes, a session with no catalog row, a parent
whose child still runs, a cancelled turn, and a stop whose event window the view has already
retired. `tests/host.mjs` runs `lib/index.js` against a stubbed Host context: the settings
namespace registers and the entry Config reaches the page. No browser, no keys, no build; CI
runs both on Linux, Windows and macOS.

### Layout

```
package.json          package name, ./client export, dsh.client + dsh.bundle.patch
cordis.patch.yml      the bundle layer: inserts row `voice-alert` naming this package
lib/index.js          Host half: settings namespace + page injection of the Config
lib/client.js         Browser half: loader bundle — sounds, Settings section, triggers
tests/smoke.mjs       keyless test of the browser half
tests/host.mjs        keyless test of the Host half
```

The browser half is authored directly in the bundle format the client module system serves
(`window.__ModuleLoader__.load({ id, factory })`) and requests only baseline module-table
entries (`react`, `@deepseek-ai/dsh-client-store`), so this package needs no build step.

`inject` is deliberately `['slots', 'locale']`. Everything else is read through `ctx.get(...)`:
a plugin that never receives an optional service stays active with a degraded feature, while
declaring one this composition lacks would hold the whole plugin — Settings page included —
pending forever.

**After editing the code:** `lib/client.js` — toggle the row off and on (`set_plugin` twice);
the re-scan gives the artifact a new revision and the browser fetches the fresh bundle.
`lib/index.js` — the Host module stays in Node's module cache, so the change lands on the
next start of dsh.

## Notes and limits

- The Host half imports `@deepseek-ai/schemastery`, the package's only dependency. A profile
  that links this checkout by path instead of fetching it needs that module resolvable from
  here.
- Sound plays in the browser page, so the page must have received a user gesture at least
  once (the ordinary browser autoplay rule). A pre-gesture `AudioContext` is resumed on the
  next gesture.
- Notification permission: the DeepSeek Harness desktop shell grants non-media permissions
  from the owned window, so the switch works without a prompt there. In a plain browser the
  first enable or the test button triggers the browser prompt, and a denial is shown in the
  block.
- A notification is raised only when the window is not in front by default, so an active user
  is not interrupted by a toast about the thing already on screen.
- Every open page of the profile alerts; the trigger is per profile, not per window.
- The dot the plugin reads is the sidebar's own derivation, copied into the plugin: the
  plugin never changes what the sidebar shows. Two deliberate differences follow from that:
  a session on screen still alerts when its readable window proves the turn ended (the
  sidebar clears its own completion reminder for the session you are reading), and a
  cancelled turn stays silent (the sidebar may still show the green dot).
- A custom sound is stored whole in the settings value, so keep it a notification-length
  clip. Larger files are rejected with a message.
- The built-in tones are Web Audio oscillators; nothing is fetched from the network.
- The completion debounce is a Config field (`completionDelayMs`, 1200 ms default, `0`
  disables it). It is not rendered on the Settings page; set it in the profile's
  `cordis.patch.yml` when a particular workflow pauses between turns for more than a second
  at a time.

## License

[MIT](LICENSE)
