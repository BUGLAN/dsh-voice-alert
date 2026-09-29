/**
 * Keyless smoke test for the browser half.
 *
 * Runs `lib/client.js` under stubbed browser globals and a stubbed Cordis
 * context, then drives the session-status observable to prove both sounds fire
 * and that the Settings section registers. No dependency beyond Node.
 *
 *   node tests/smoke.mjs
 */
import assert from 'node:assert/strict'

const tonePlays = []
const writes = []

/** Minimal React stand-in: the half only needs createElement and useState. */
const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useState: (initial) => [initial, () => {}],
}

class FakeAudioContext {
  state = 'running'
  currentTime = 0
  destination = {}
  resume() {}
  createOscillator() {
    tonePlays.push(this.currentTime)
    return { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} }
  }
  createGain() {
    return {
      gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
      connect() {},
    }
  }
}

const styleTags = []
let documentFocused = false
globalThis.document = {
  querySelector: () => null,
  createElement: () => ({ dataset: {}, textContent: '' }),
  head: { appendChild: (tag) => { styleTags.push(tag) } },
  addEventListener() {},
  removeEventListener() {},
  hasFocus: () => documentFocused,
}
const mirror = new Map()
globalThis.localStorage = {
  getItem: (key) => (mirror.has(key) ? mirror.get(key) : null),
  setItem: (key, value) => { mirror.set(key, value) },
}
/** System-notification stand-in: records every raised notification. */
const notifications = []
class FakeNotification {
  static permission = 'granted'
  static requestPermission = () => Promise.resolve('granted')
  constructor(title, options) {
    notifications.push({ title, options })
    this.onclick = undefined
  }
}
globalThis.Notification = FakeNotification
globalThis.window = {
  AudioContext: FakeAudioContext,
  Notification: FakeNotification,
  localStorage: globalThis.localStorage,
}
let registration
globalThis.window.__ModuleLoader__ = { load: (next) => { registration = next } }

await import('../lib/client.js')
assert.equal(registration.id, 'dsh-voice-alert', 'bundle registers under the package name')

const moduleExports = registration.factory((specifier) => {
  if (specifier === 'react') return React
  if (specifier === '@deepseek-ai/dsh-client-store') {
    return { defineStore: () => ({ sync: () => {} }) }
  }
  throw new Error(`unexpected module request: ${specifier}`)
})
assert.deepEqual(moduleExports.inject, ['slots', 'locale'])
assert.equal(typeof moduleExports.apply, 'function')

// ------------------------------------------------------------ fake client ctx

let values = {
  enabled: true,
  volume: 1,
  completionEnabled: true,
  completionTone: 'chime-up',
  completionFile: '',
  completionDelayMs: 0,
  waitingEnabled: true,
  waitingTone: 'ask-up',
  waitingFile: '',
}
let statusMap = new Map()
const statusListeners = new Set()
const scopeListeners = new Set()
const effects = []
const sections = []
let localized = ''

const scope = {
  getSnapshot: () => ({ status: 'ready', value: { ...values }, revision: 1, writable: true, mode: 'host' }),
  subscribe: (listener) => { scopeListeners.add(listener); return () => { scopeListeners.delete(listener) } },
  set: (field, value) => { writes.push([field, value]); values = { ...values, [field]: value }; return Promise.resolve(true) },
  unset: () => Promise.resolve(true),
  mutate: () => Promise.resolve(true),
}

/**
 * Durable log tail the session binding exposes, in the wire shape the client
 * module system actually delivers: every entry wraps a `{ type: 'event', event }`.
 * The newest turn is normally closed and the user's own prompt is the last one.
 */
const userMessage = (text, kind = 'user') => ({
  type: 'event',
  event: { type: 'user/message', data: { source: { kind }, content: [{ type: 'text', text }] } },
})
let turnEntries = [
  userMessage('帮我把登录流程重构一下，顺便补上测试'),
  { type: 'event', event: { type: 'turn/start', data: { turn: 1 } } },
  { type: 'event', event: { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } } },
]
/** Set one session's log tail to a turn closed for the given reason. */
const closedTurn = (reason) => {
  turnEntries = [
    userMessage('帮我把登录流程重构一下，顺便补上测试'),
    { type: 'event', event: { type: 'turn/start', data: { turn: 1 } } },
    { type: 'event', event: { type: 'turn/end', data: { turn: 1, reason } } },
  ]
}

const sessionRows = {}
const services = {
  settingsScope: { bind: (spec) => { assert.equal(spec.namespace, 'voice-alert'); return scope } },
  sessions: {
    list: { getSnapshot: () => ({ byId: sessionRows }) },
    binding: (id) => (id === 's1' ? { eventSource: { getSnapshot: () => ({ entries: turnEntries }) } } : undefined),
  },
  uiSession: {
    sessionStatus: {
      getSnapshot: () => statusMap,
      subscribe: (listener) => { statusListeners.add(listener); return () => { statusListeners.delete(listener) } },
    },
  },
}

const ctx = {
  effect: (fn) => { const disposer = fn(); effects.push(disposer); return () => {} },
  get: (name) => services[name],
  slots: {
    inject: (name, register) => {
      assert.equal(name, 'settings.section')
      register()
    },
    register: (options, component) => { sections.push({ options, component }); return () => {} },
  },
  locale: {
    register: (ns, dictionaries) => {
      assert.equal(ns, 'settings.voiceAlert')
      assert.deepEqual(Object.keys(dictionaries).sort(), ['en', 'zh'])
      assert.deepEqual(Object.keys(dictionaries.zh).sort(), Object.keys(dictionaries.en).sort())
      return () => {}
    },
    bind: () => (key, params) => {
      localized = key
      return params === undefined ? key : `${key}:${JSON.stringify(params)}`
    },
  },
}

moduleExports.apply(ctx)

const push = (next) => {
  statusMap = next
  for (const listener of statusListeners) listener()
}

// --------------------------------------------------------------- registration

assert.equal(sections.length, 1, 'one settings section registered')
assert.equal(sections[0].options.name, 'settings.section')
assert.equal(sections[0].options.id, 'voice-alert')
assert.equal(typeof sections[0].options.label, 'function')
assert.equal(sections[0].options.label(), 'nav', 'nav label resolves through the locale binding')
assert.equal(styleTags.length, 1, 'stylesheet injected once')
assert.ok(scopeListeners.size > 0, 'the settings scope is observed')

// -------------------------------------------------------------- section render

const props = {
  t: (key, params) => (params === undefined ? key : `${key}:${Object.keys(params).join(',')}`),
  update: (patch) => { for (const [field, value] of Object.entries(patch)) writes.push([field, value]) },
  useStore: (selector) => selector({ settings: { ...values }, revision: 1, hostMissing: false }),
}
const tree = sections[0].component(props)
assert.equal(tree.type, 'div')
assert.ok(JSON.stringify(tree).includes('"completion"'), 'the completion block renders')
assert.ok(JSON.stringify(tree).includes('"waiting"'), 'the waiting block renders')
assert.ok(JSON.stringify(tree).includes('"notifyEnabled"'), 'the system-notification block renders')
assert.ok(JSON.stringify(tree).includes('"notifyTest"'), 'the test-notification button renders')
assert.ok(!JSON.stringify(tree).includes('using'), 'no custom-sound note before a file is chosen')

// A stored custom sound renders its size note and the clear control.
values = { ...values, completionFile: `data:audio/wav;base64,${'A'.repeat(4096)}` }
const withFile = sections[0].component(props)
assert.ok(JSON.stringify(withFile).includes('using'), 'the custom-sound note renders')
assert.ok(JSON.stringify(withFile).includes('"clear"'), 'the clear control renders')
values = { ...values, completionFile: '' }

/** Drive every control the section exposes, so each writes through the scope. */
function walk(node) {
  if (node === null || typeof node !== 'object') return
  if (Array.isArray(node)) { for (const child of node) walk(child); return }
  const { type, props: nodeProps, children } = node
  if (typeof type === 'function') { walk(type(nodeProps)); return }
  if (typeof type === 'string' && typeof nodeProps.onChange === 'function') {
    if (type === 'input' && nodeProps.type === 'checkbox') nodeProps.onChange({ target: { checked: !nodeProps.checked } })
    else if (type === 'input' && nodeProps.type === 'range') nodeProps.onChange({ target: { value: '0.2' } })
    else if (type === 'select') nodeProps.onChange({ target: { value: 'bell' } })
  }
  if (typeof type === 'string' && typeof nodeProps.onClick === 'function') nodeProps.onClick()
  walk(children)
}
walk(tree)
assert.ok(writes.some(([field]) => field === 'enabled'), 'master switch writes')
assert.ok(writes.some(([field, value]) => field === 'volume' && value === 0.2), 'volume writes')
assert.ok(writes.some(([field]) => field === 'completionTone'), 'tone selection writes')

// ------------------------------------------------------------------ the sounds

tonePlays.length = 0
push(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
assert.equal(tonePlays.length, 0, 'the first status establishes a baseline silently')

push(new Map([['s1', { running: true, pendingInteraction: { key: 'question:1' } }]]))
assert.ok(tonePlays.length > 0, 'a pending question plays the waiting sound')

tonePlays.length = 0
push(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
assert.equal(tonePlays.length, 0, 'answering leaves running state alone')

push(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
assert.ok(tonePlays.length > 0, 'a finished turn plays the completion sound')

tonePlays.length = 0
values = { ...values, enabled: false }
push(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
push(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
assert.equal(tonePlays.length, 0, 'the master switch silences both sounds')

values = { ...values, enabled: true, waitingEnabled: false, completionEnabled: false }
push(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
push(new Map([['s1', { running: false, pendingInteraction: { key: 'approval:1' } }]]))
assert.equal(tonePlays.length, 0, 'per-event switches silence each sound')

values = { ...values, waitingEnabled: true, completionEnabled: true }
tonePlays.length = 0
push(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
push(new Map([['s1', { running: false, pendingInteraction: { key: 'approval:1' } }]]))
assert.ok(tonePlays.length > 0, 'a pending approval plays the waiting sound')

// ------------------------------------------------- system notifications

notifications.length = 0
values = { ...values, notifyEnabled: true, notifyCompletion: true, notifyWaiting: true, notifyBackgroundOnly: false }
push(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
push(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
assert.equal(notifications.length, 1, 'a finished turn raises a system notification')
assert.equal(notifications[0].title, 'notify.completionTitle', 'the title comes from the dictionary')
assert.equal(notifications[0].options.body, '帮我把登录流程重构一下，顺便补上测试',
  'the body is the prompt the user sent for that turn, not the session title')
assert.equal(notifications[0].options.silent, true, 'the OS sound stays off while this plugin plays one')

// The opt-in default is off, so nothing is raised until the user turns it on.
values = { ...values, notifyEnabled: false }
notifications.length = 0
push(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
push(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
assert.equal(notifications.length, 0, 'notifications are opt-in')

// A body override wins over the built-in text.
values = { ...values, notifyEnabled: true, notifyCompletionBody: '部署完成了' }
notifications.length = 0
push(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
push(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
assert.equal(notifications[0].options.body, '部署完成了', 'the text override replaces the default body')

// The window-in-front rule suppresses the toast but not the event itself.
values = { ...values, notifyCompletionBody: '', notifyBackgroundOnly: true }
notifications.length = 0
documentFocused = true
push(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
push(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
assert.equal(notifications.length, 0, 'an in-focus window is not toasted')
documentFocused = false
push(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
push(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
assert.equal(notifications.length, 1, 'a window behind another app is toasted')

// A pending question notifies with its own title, and the reply switch gates it.
notifications.length = 0
values = { ...values, notifyBackgroundOnly: false }
push(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
push(new Map([['s1', { running: false, pendingInteraction: { key: 'q:1' } }]]))
assert.equal(notifications.length, 1, 'a pending question raises a notification')
assert.equal(notifications[0].title, 'notify.waitingTitle')
values = { ...values, notifyWaiting: false }
notifications.length = 0
push(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
push(new Map([['s1', { running: false, pendingInteraction: { key: 'q:2' } }]]))
assert.equal(notifications.length, 0, 'the reply-notification switch silences it')

// With the plugin's own sound off, the toast is allowed to carry the OS sound.
values = { ...values, enabled: false, notifyWaiting: true }
notifications.length = 0
push(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
push(new Map([['s1', { running: false, pendingInteraction: { key: 'q:3' } }]]))
assert.equal(notifications[0].options.silent, false, 'the OS sound is left on when this plugin plays nothing')
values = { ...values, enabled: true }

// The section's own test button and permission face.
notifications.length = 0
const notificationFace = sections[0].options.inject({ sync: () => {} })
assert.equal(notificationFace.notificationPermission(), 'granted')
assert.equal(notificationFace.testNotification(), true, 'the test button reports a raised notification')
assert.equal(notifications.length, 1, 'the test button raises one notification')

// The prompt the user sent for that turn outranks the session title.
sessionRows.s1 = { displayTitle: '重构登录流程' }
notifications.length = 0
values = { ...values, notifyEnabled: true, notifyBackgroundOnly: false, notifyCompletionBody: '' }
push(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
push(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
assert.equal(notifications[0].options.body, '帮我把登录流程重构一下，顺便补上测试',
  'the latest prompt outranks the session title')
delete sessionRows.s1

// An explicit override still outranks both.
sessionRows.s1 = { displayTitle: '重构登录流程' }
notifications.length = 0
values = { ...values, notifyCompletionBody: '搞定了' }
push(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
push(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
assert.equal(notifications[0].options.body, '搞定了', 'the user override outranks the prompt')
delete sessionRows.s1
values = { ...values, notifyCompletionBody: '' }

// ---------------------------------------------------- what must NOT alert

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms) })

// A turn the user cancelled reports `aborted`, so it stays silent.
closedTurn({ kind: 'aborted', reason: { kind: 'user' } })
tonePlays.length = 0
notifications.length = 0
push(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
push(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
assert.equal(tonePlays.length, 0, 'a cancelled turn plays nothing')
assert.equal(notifications.length, 0, 'a cancelled turn notifies nothing')

// A parent cancelling a child, and a turn closed by a crash, are equally silent.
for (const reason of [
  { kind: 'aborted', reason: { kind: 'parent' } },
  { kind: 'aborted', reason: { kind: 'disposed' } },
  { kind: 'interrupted' },
  { kind: 'forked' },
]) {
  closedTurn(reason)
  tonePlays.length = 0
  push(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
  push(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
  assert.equal(tonePlays.length, 0, `${reason.kind} stays silent`)
}

// A newer turn still open means the work continues: no "finished" alert.
turnEntries = [{ type: 'event', event: { type: 'turn/start', data: { turn: 2 } } }]
tonePlays.length = 0
push(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
push(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
assert.equal(tonePlays.length, 0, 'a turn that is still open does not alert')

// Internal runs (subagents, teammates) end constantly, so they never alert.
sessionRows.s2 = { displayTitle: '研究子代理', origin: 'subagent' }
tonePlays.length = 0
notifications.length = 0
values = { ...values, notifyEnabled: true, notifyBackgroundOnly: false, notifyWaiting: true }
push(new Map([
  ['s2', { running: true, pendingInteraction: undefined }],
  ['s1', { running: false, pendingInteraction: undefined }],
]))
push(new Map([
  ['s2', { running: false, pendingInteraction: undefined }],
  ['s1', { running: false, pendingInteraction: undefined }],
]))
assert.equal(tonePlays.length, 0, 'a subagent finishing alerts nothing')
push(new Map([
  ['s2', { running: false, pendingInteraction: { key: 'sub:1' } }],
  ['s1', { running: false, pendingInteraction: undefined }],
]))
assert.equal(notifications.length, 0, 'a subagent question alerts nothing')
delete sessionRows.s2

// A failed turn alerts as a failure, with the error text as the body.
values = { ...values, notifyEnabled: true }
closedTurn({ kind: 'error', error: { message: 'ENOSPC: no space left on device', code: 'UNKNOWN' } })
tonePlays.length = 0
notifications.length = 0
push(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
push(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
assert.ok(tonePlays.length > 0, 'a failed turn still calls you back')
assert.equal(notifications[0].title, 'notify.errorTitle', 'a failed turn is not labelled a completion')
assert.ok(notifications[0].options.body.includes('ENOSPC'), 'the failure text becomes the body')

// ------------------------------------------------------ the debounce itself

closedTurn({ kind: 'completed' })
values = { ...values, completionDelayMs: 60, notifyEnabled: false }
tonePlays.length = 0
push(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
push(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
assert.equal(tonePlays.length, 0, 'the completion alert waits out the delay')
await sleep(140)
assert.ok(tonePlays.length > 0, 'a turn that stays stopped alerts after the delay')

// A turn that resumes inside the delay reports nothing at all.
tonePlays.length = 0
push(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
push(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
push(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
await sleep(140)
assert.equal(tonePlays.length, 0, 'a resumed turn never reported the intermediate pause')

values = { ...values, completionDelayMs: 0 }
turnEntries = [
  userMessage('帮我把登录流程重构一下，顺便补上测试'),
  { type: 'event', event: { type: 'turn/start', data: { turn: 1 } } },
  { type: 'event', event: { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } } },
]
push(new Map([['s1', { running: false, pendingInteraction: undefined }]]))

// ------------------------------- the body names the turn the user asked for

// An injected context reminder is user-role too, and it must not become the body.
values = { ...values, notifyEnabled: true, notifyBackgroundOnly: false }
turnEntries = [
  userMessage('把登录页的错误提示统一一下'),
  { type: 'event', event: { type: 'turn/start', data: { turn: 1 } } },
  { type: 'event', event: { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } } },
  userMessage('<system-reminder>Additional instructions from: AGENTS.md</system-reminder>', 'agent-instructions'),
]
notifications.length = 0
push(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
push(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
assert.equal(notifications[0].options.body, '把登录页的错误提示统一一下',
  'injected context never becomes the body')

// The session title remains the fallback for a log with no user prompt at all.
sessionRows.s1 = { displayTitle: '重构登录流程' }
turnEntries = [
  { type: 'event', event: { type: 'turn/start', data: { turn: 1 } } },
  { type: 'event', event: { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } } },
]
notifications.length = 0
push(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
push(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
assert.equal(notifications[0].options.body, '重构登录流程', 'the session title is the fallback body')

// A multi-line prompt collapses to one bounded line.
turnEntries = [
  userMessage(`第一行\n\n第二行   ${'很长'.repeat(90)}`),
  { type: 'event', event: { type: 'turn/start', data: { turn: 1 } } },
  { type: 'event', event: { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } } },
]
notifications.length = 0
push(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
push(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
const collapsed = notifications[0].options.body
assert.ok(collapsed.startsWith('第一行 第二行'), 'a multi-line prompt collapses into one line')
assert.ok(collapsed.length <= 120, 'the body is bounded')
delete sessionRows.s1

// ------------------------------------------------- a composition without them

// Neither the settings provider nor the session-status source is mandatory: the
// section must still mount and keep its preferences in the local mirror.
const degradedSections = []
moduleExports.apply({
  effect: (fn) => { fn(); return () => {} },
  get: () => undefined,
  slots: {
    inject: (name, register) => { register() },
    register: (options, component) => { degradedSections.push({ options, component }); return () => {} },
  },
  locale: ctx.locale,
})
assert.equal(degradedSections.length, 1, 'the section registers without the settings scope or session status')

// The registration's own update face must still persist, through the mirror.
mirror.clear()
const degradedFace = degradedSections[0].options.inject({ sync: () => {} })
degradedFace.update({ enabled: false, volume: 0.25 })
const stored = JSON.parse(mirror.get('dsh-voice-alert/settings'))
assert.equal(stored.enabled, false, 'a degraded composition keeps the master switch')
assert.equal(stored.volume, 0.25, 'a degraded composition keeps the volume')
const degradedTree = degradedSections[0].component({
  t: (key) => key,
  update: degradedFace.update,
  useStore: (selector) => selector({ settings: { ...values }, revision: 1, hostMissing: true }),
})
assert.equal(degradedTree.type, 'div', 'the section renders in a degraded composition')

// The Host entry Config reaches the page as a global and layers under the mirror.
let synced
mirror.clear()
globalThis.window.__DSH_VOICE_ALERT__ = { completionTone: 'bell', volume: 0.9 }
degradedSections[0].options.inject({ sync: (settings) => { synced = settings } })
assert.equal(synced.completionTone, 'bell', 'the Host Config provides the tone')
assert.equal(synced.volume, 0.9, 'the Host Config provides the volume')
degradedFace.update({ completionTone: 'ping' })
degradedSections[0].options.inject({ sync: (settings) => { synced = settings } })
assert.equal(synced.completionTone, 'ping', 'the browser mirror overrides the field the user touched')
assert.equal(synced.volume, 0.9, 'untouched fields still come from the Host Config')
delete globalThis.window.__DSH_VOICE_ALERT__

console.log('smoke: ok — sections, writes, both alerts, and the no-alert cases behave')
