# dsh-voice-alert

[![CI](https://github.com/BUGLAN/dsh-voice-alert/actions/workflows/ci.yml/badge.svg)](https://github.com/BUGLAN/dsh-voice-alert/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin: it plays one
sound when a turn finishes, plays another when dsh is waiting for you to answer or choose,
can raise a Windows/macOS system notification for either moment, and adds a **Sound alerts**
(语音提醒) page to Settings where all of it is configured.

[中文说明 →](README.zh-CN.md)

## What it does

| Alert | Trigger | Default |
|---|---|---|
| Completion sound (`chime-up`) | a turn stopped and stayed stopped, and it did not stop because you cancelled it | on |
| Reply-needed sound (`ask-up`) | a pending question or approval appears for a session | on |
| System notification | the same two moments, as a Windows/macOS notification | off (opt-in) |

Both moments come from the client's session-status snapshot (`uiSession.sessionStatus`),
which folds `api-session/status` events with the composer's pending interactions. When a
reply is needed and a turn ends in the same update, only the reply alert fires.

A turn end is not the same as a finished task, so the completion alert is qualified two
ways before it fires:

- **It must stay stopped.** The alert waits `completionDelayMs` (default 1200 ms) after the
  session goes idle. A turn that starts again inside that window — a goal round, an
  auto-continuation, a tool loop resuming — cancels its own alert, so an intermediate pause
  is never reported as a finished task.
- **It must not be a cancellation.** The session's durable log says why the turn ended
  (`turn/end` carries a reason): `completed`, `blocked` and `max-tokens` alert; `aborted`
  (the user, a parent agent, a hook or disposal), `interrupted` and `forked` stay silent;
  `error` alerts as a failure rather than as a completion.

### When it stays silent

- you pressed stop / cancelled the turn (`aborted`, reason `user` or `parent`);
- the turn was closed by a crash-repair or fork marker (`interrupted`, `forked`);
- the turn belongs to an internal run: a subagent or teammate session
  (`origin: 'subagent'`, or any session with a `parentId`), whose ends happen constantly
  during ordinary work;
- the turn resumed before the debounce elapsed;
- the matching switch is off, the master switch is off, or `notifyBackgroundOnly` is on and
  the window is in front.

## Requirements

- **DeepSeek Harness** — a build whose client exposes `uiSession.sessionStatus` and the
  `settings.section` slot (the 0.1.7 line and newer).
- **Node.js** 22.19+ or 24+ for the dsh process that loads the Host half.
- **Runtime** — the desktop app or the web UI. Sounds play in the page, so the page needs a
  user gesture at least once; notifications use the renderer's `Notification` API, which the
  desktop shell routes to the OS notification center.

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

### What a toast says

The body names the work, not the session: it is the newest prompt the user themselves sent
in that session, collapsed to one line and bounded to 120 characters, so a completion reads
as the thing you asked for rather than as the session's auto-generated title. A user-role
message is not always a prompt — injected context (workspace instructions, skill catalogs,
teammate framing) arrives in the user role too — so only `source.kind === 'user'` counts.

Body precedence per alert: your explicit text override, then (for a failed turn) the failure
message, then the latest prompt, then the session title, then the built-in copy.

## Configuration

Every preference is a Config field of this plugin's entry, so it can be set from the
profile's `cordis.yml` / `cordis.patch.yml` (or the Plugins page's config editor) as well as
from the Settings page:

| Key | Type and default | Meaning |
|---|---|---|
| `enabled` | boolean, `true` | master switch for both sounds |
| `volume` | number 0–1, `0.6` | playback volume, as a fraction of full scale |
| `completionEnabled` | boolean, `true` | play a sound when a turn finishes |
| `completionTone` | string, `chime-up` | built-in tone used when no custom file is set |
| `completionFile` | string, `''` | custom completion sound, as a data URL |
| `completionDelayMs` | number 0–60000, `1200` | debounce before the completion alert; `0` disables it |
| `waitingEnabled` | boolean, `true` | play a sound when a reply is needed |
| `waitingTone` | string, `ask-up` | built-in tone used when no custom file is set |
| `waitingFile` | string, `''` | custom reply-needed sound, as a data URL |
| `notifyEnabled` | boolean, `false` | raise a system notification in addition to the sound |
| `notifyCompletion` | boolean, `true` | notify when a turn finishes |
| `notifyWaiting` | boolean, `true` | notify when a reply is needed |
| `notifyBackgroundOnly` | boolean, `true` | notify only while the window is not in front |
| `notifyCompletionBody` | string, `''` | completion notification body; empty uses the built-in text |
| `notifyWaitingBody` | string, `''` | reply notification body; empty uses the built-in text |

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
context, then drives the session-status observable: the Settings section registers, controls
write, both sounds fire, and the no-alert cases stay silent. `tests/host.mjs` runs
`lib/index.js` against a stubbed Host context: the settings namespace registers and the entry
Config reaches the page. No browser, no keys, no build; CI runs both on Linux, Windows and
macOS.

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
- A custom sound is stored whole in the settings value, so keep it a notification-length
  clip. Larger files are rejected with a message.
- The built-in tones are Web Audio oscillators; nothing is fetched from the network.
- The completion debounce is a Config field (`completionDelayMs`, 1200 ms default, `0`
  disables it). It is not rendered on the Settings page; set it in the profile's
  `cordis.patch.yml` when a particular workflow pauses between turns for more than a second
  at a time.

## License

[MIT](LICENSE)
