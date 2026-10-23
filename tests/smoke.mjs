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
// Node publishes its own `navigator` (MacIntel on a Mac host), which would make
// the platform checks under test depend on where the suite runs.
/** Pin the platform the plugin reads, independent of the host running this suite. */
function stubPlatform(platform) {
  try {
    Object.defineProperty(globalThis, 'navigator', { value: { platform }, writable: true, configurable: true })
  } catch {
    Object.defineProperty(globalThis.navigator, 'platform', { value: platform, configurable: true })
  }
  assert.equal(globalThis.navigator.platform, platform, 'the suite pins the platform it tests')
}
stubPlatform('Win32')
const mirror = new Map()
globalThis.localStorage = {
  getItem: (key) => (mirror.has(key) ? mirror.get(key) : null),
  setItem: (key, value) => { mirror.set(key, value) },
}
/** System-notification stand-in: records every raised notification and permission ask. */
const notifications = []
const permissionRequests = []
class FakeNotification {
  static permission = 'granted'
  static requestPermission = () => {
    permissionRequests.push(true)
    return Promise.resolve(FakeNotification.permission)
  }
  /** Whether a constructed notification confirms itself, as a shown banner would. */
  static autoShow = false
  constructor(title, options) {
    notifications.push({ title, options })
    this.onclick = undefined
    this.onshow = undefined
    this.onerror = undefined
    if (FakeNotification.autoShow) setTimeout(() => { this.onshow?.() }, 0)
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
/** Whether the stub settings scope reports a durable `user` layer, and what it holds. */
let scopeHasUser = false
let scopeUser
const statusListeners = new Set()
const listListeners = new Set()
const scopeListeners = new Set()
const effects = []
const sections = []
let localized = ''
/** Dictionaries the bundle registered, for the copy assertions below. */
let registered

const scope = {
  // `value` is the resolved config (schema defaults included); `user` is the
  // durable edit layer a Host scope reports, present-but-empty when the profile
  // stores nothing for this entry yet.
  getSnapshot: () => ({
    status: 'ready',
    value: { ...values },
    ...scopeHasUser ? { user: scopeUser } : {},
    revision: 1,
    writable: true,
    mode: 'host',
  }),
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
/** Turn number the next fixture writes; every fixture advance is a new episode. */
let fixtureTurn = 0
const nextFixtureTurn = () => (fixtureTurn += 1)
let turnEntries = [
  userMessage('帮我把登录流程重构一下，顺便补上测试'),
  { type: 'event', event: { type: 'turn/start', data: { turn: nextFixtureTurn() } } },
  { type: 'event', event: { type: 'turn/end', data: { turn: fixtureTurn, reason: { kind: 'completed' } } } },
]
/**
 * Set one session's log tail to a turn closed for the given reason. Each call
 * writes a new turn number, because the plugin tells turns apart by it; pass
 * `null` for a tail whose log carries no user prompt at all.
 */
const closedTurn = (reason, text = '帮我把登录流程重构一下，顺便补上测试') => {
  const turn = nextFixtureTurn()
  turnEntries = [
    ...text === null ? [] : [userMessage(text)],
    { type: 'event', event: { type: 'turn/start', data: { turn } } },
    { type: 'event', event: { type: 'turn/end', data: { turn, reason } } },
  ]
}
/** Set one session's log tail to a turn that is still running. */
const openTurn = (text = '帮我把登录流程重构一下，顺便补上测试') => {
  const turn = nextFixtureTurn()
  turnEntries = [
    ...text === null ? [] : [userMessage(text)],
    { type: 'event', event: { type: 'turn/start', data: { turn } } },
  ]
}
/**
 * Close one more turn on top of the current log tail. Re-arming a completion by
 * flipping `running` back on is only a new completion if the log advanced with
 * it — a status push and a lagging list row can disagree about one stop, and
 * that disagreement is what used to report a single turn twice. The turn number
 * comes from the same counter as every other fixture, so no later fixture can
 * reuse an episode that already alerted.
 */
const finishTurn = (reason = { kind: 'completed' }) => {
  const turn = nextFixtureTurn()
  turnEntries = [
    ...turnEntries,
    { type: 'event', event: { type: 'turn/start', data: { turn } } },
    { type: 'event', event: { type: 'turn/end', data: { turn, reason } } },
  ]
}

const sessionRows = {}
/** Durable event windows this browser holds, keyed by session. */
const bindings = {}
/** Subagent catalogs (direct children) keyed by parent session. */
const projections = {}
/** Session-list arrival lifecycle: `pending` while the list RPC is in flight. */
let listPhase = 'ready'
/** Which settings-binder seat the plugin bound, to prove the current one wins. */
let boundSeat = ''

// Only a known top-level session row can own a sidebar status dot, so the
// session under test needs one before anything may alert for it.
sessionRows.s1 = { displayTitle: '重构登录流程', running: true, blank: false, updatedAt: 1 }
/** Push one session-status snapshot into the subscribed plugin. */
const pushStatus = (next) => {
  statusMap = next
  for (const listener of statusListeners) listener()
}
/** Push one session-list update into the subscribed plugin. */
const pushRows = () => {
  for (const listener of listListeners) listener()
}
/**
 * One pending interaction in the shape the client publishes: `key` identifies
 * the interaction and `kind` is the sidebar's pending kind. Only `approval`,
 * `plan-review` and `question` turn the sidebar row yellow.
 */
const pending = (key, kind = 'question') => ({ key, kind })
const services = {
  // The current client serves the binder as `webUiSettings`; `settingsScope` is
  // only a deprecated property on that same object, so a plugin probing the old
  // seat alone binds nothing and silently degrades to the local mirror.
  webUiSettings: { bind: (spec) => { assert.equal(spec.namespace, 'voice-alert'); boundSeat = 'webUiSettings'; return scope } },
  settingsScope: { bind: (spec) => { assert.equal(spec.namespace, 'voice-alert'); boundSeat = 'settingsScope'; return scope } },
  sessions: {
    list: {
      getSnapshot: () => ({ byId: sessionRows, projectionsBySession: projections, phase: listPhase }),
      subscribe: (listener) => { listListeners.add(listener); return () => { listListeners.delete(listener) } },
    },
    binding: (id) => bindings[id],
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
      registered = dictionaries
      return () => {}
    },
    bind: () => (key, params) => {
      localized = key
      return params === undefined ? key : `${key}:${JSON.stringify(params)}`
    },
  },
}

/** The event window of the session under test; other sessions have none. */
const windowSource = {
  getSnapshot: () => ({ entries: turnEntries }),
  subscribe: () => () => {},
}
bindings.s1 = { eventSource: windowSource }

moduleExports.apply(ctx)

// --------------------------------------------------------------- registration

assert.equal(sections.length, 1, 'one settings section registered')
assert.equal(sections[0].options.name, 'settings.section')
assert.equal(sections[0].options.id, 'voice-alert')
assert.equal(typeof sections[0].options.label, 'function')
assert.equal(sections[0].options.label(), 'nav', 'nav label resolves through the locale binding')
assert.equal(styleTags.length, 1, 'stylesheet injected once')
assert.ok(scopeListeners.size > 0, 'the settings scope is observed')

// The alert titles come from the session row, so the per-event title copy is
// dead and must not come back; the test button still needs the completion pair.
for (const [language, dictionary] of Object.entries(registered)) {
  assert.ok(!Object.hasOwn(dictionary, 'notify.waitingTitle'),
    `${language} carries no dead reply title`)
  assert.ok(!Object.hasOwn(dictionary, 'notify.errorTitle') && !Object.hasOwn(dictionary, 'notify.errorBody'),
    `${language} carries no error copy`)
  assert.ok(Object.hasOwn(dictionary, 'notify.completionTitle') && Object.hasOwn(dictionary, 'notify.completionBody'),
    `${language} keeps the copy the test notification uses`)
  assert.ok(Object.hasOwn(dictionary, 'notify.waitingBody'), `${language} keeps the default reply body`)
}

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
pushStatus(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
assert.equal(tonePlays.length, 0, 'the first status establishes a baseline silently')

pushStatus(new Map([['s1', { running: true, pendingInteraction: pending('question:1') }]]))
assert.ok(tonePlays.length > 0, 'a pending question plays the waiting sound')

tonePlays.length = 0
pushStatus(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
assert.equal(tonePlays.length, 0, 'answering leaves running state alone')

pushStatus(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
assert.ok(tonePlays.length > 0, 'a finished turn plays the completion sound')

tonePlays.length = 0
values = { ...values, enabled: false }
finishTurn()
pushStatus(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
pushStatus(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
assert.equal(tonePlays.length, 0, 'the master switch silences both sounds')

values = { ...values, enabled: true, waitingEnabled: false, completionEnabled: false }
pushStatus(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
pushStatus(new Map([['s1', { running: false, pendingInteraction: pending('approval:1') }]]))
assert.equal(tonePlays.length, 0, 'per-event switches silence each sound')

values = { ...values, waitingEnabled: true, completionEnabled: false }
tonePlays.length = 0
pushStatus(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
pushStatus(new Map([['s1', { running: false, pendingInteraction: pending('approval:1') }]]))
assert.equal(tonePlays.length, 0, 'a reply key that already alerted does not alert again')
pushStatus(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
pushStatus(new Map([['s1', { running: false, pendingInteraction: pending('approval:2') }]]))
assert.ok(tonePlays.length > 0, 'a new pending approval plays the waiting sound')
values = { ...values, completionEnabled: true }

// ------------------------------------------------- system notifications

notifications.length = 0
values = { ...values, notifyEnabled: true, notifyCompletion: true, notifyWaiting: true, notifyBackgroundOnly: false }
finishTurn()
pushStatus(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
pushStatus(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
assert.equal(notifications.length, 1, 'a finished turn raises a system notification')
assert.equal(notifications[0].title, '重构登录流程', 'the title is the session display title')
assert.equal(notifications[0].options.body, '🐳 帮我把登录流程重构一下，顺便补上测试',
  'the body is the completion icon plus the prompt the user sent, not the session title')
assert.equal(notifications[0].options.silent, true, 'the OS sound stays off while this plugin plays one')

// Re-reaching the same finished state is not a new turn: one episode, one alert.
pushStatus(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
assert.equal(notifications.length, 1, 'a repeated evaluation does not repeat the completion alert')

// Nor is a running edge that only blips: a status push and a lagging list row
// can disagree about one stop, and re-arming the alert on the edge alone used to
// report the same finished turn a second time.
pushStatus(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
pushStatus(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
assert.equal(notifications.length, 1, 'a running blip around one stop does not alert again')

// A windowless completion alerts once too, even though opening the session
// afterwards makes the very same turn readable: the stop that could not name its
// turn keeps the credit, so the window cannot report it again.
values = { ...values, notifyEnabled: true, notifyCompletion: true, notifyBackgroundOnly: false }
sessionRows.bg2 = { displayTitle: '后台完成', running: true, blank: false, updatedAt: 10 }
closedTurn({ kind: 'completed' })
notifications.length = 0
pushStatus(new Map([['bg2', { running: true, pendingInteraction: undefined }]]))
pushStatus(new Map([['bg2', { running: false, completionUnread: true, pendingInteraction: undefined }]]))
assert.equal(notifications.length, 1, 'a windowless completion alerts once')
notifications.length = 0
const emptyWindow = { getSnapshot: () => ({ entries: [] }), subscribe: () => () => {} }
bindings.bg2 = { eventSource: emptyWindow }
pushStatus(new Map([['bg2', { running: false, completionUnread: false, pendingInteraction: undefined }]]))
bindings.bg2 = { eventSource: windowSource }
pushRows()
assert.equal(notifications.length, 0, 'opening the alerted session does not report the turn again')
delete sessionRows.bg2
delete bindings.bg2

// A log that carries no turn number still tells its turns apart by event seq, so
// two finished turns stay two alerts instead of collapsing into one episode.
turnEntries = [
  { type: 'event', event: { type: 'turn/start', seq: 41, data: {} } },
  { type: 'event', event: { type: 'turn/end', seq: 42, data: { reason: { kind: 'completed' } } } },
]
notifications.length = 0
pushStatus(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
pushStatus(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
assert.equal(notifications.length, 1, 'a turn named only by its event seq alerts')
turnEntries = [
  { type: 'event', event: { type: 'turn/start', seq: 43, data: {} } },
  { type: 'event', event: { type: 'turn/end', seq: 44, data: { reason: { kind: 'completed' } } } },
]
pushStatus(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
pushStatus(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
assert.equal(notifications.length, 2, 'and the next turn is a new episode, not the same one')
closedTurn({ kind: 'completed' })

// The opt-in default is off, so nothing is raised until the user turns it on.
values = { ...values, notifyEnabled: false }
notifications.length = 0
pushStatus(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
pushStatus(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
assert.equal(notifications.length, 0, 'notifications are opt-in')

// A body override wins over the built-in text.
values = { ...values, notifyEnabled: true, notifyCompletionBody: '部署完成了' }
notifications.length = 0
finishTurn()
pushStatus(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
pushStatus(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
assert.equal(notifications[0].options.body, '🐳 部署完成了',
  'a completion override keeps the completion icon in front of it')

// The window-in-front rule suppresses the toast but not the event itself.
values = { ...values, notifyCompletionBody: '', notifyBackgroundOnly: true }
notifications.length = 0
documentFocused = true
pushStatus(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
pushStatus(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
assert.equal(notifications.length, 0, 'an in-focus window is not toasted')
documentFocused = false
finishTurn()
pushStatus(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
pushStatus(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
assert.equal(notifications.length, 1, 'a window behind another app is toasted')

// A pending question notifies with its own title, and the reply switch gates it.
notifications.length = 0
values = { ...values, notifyBackgroundOnly: false }
pushStatus(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
pushStatus(new Map([['s1', { running: false, pendingInteraction: pending('q:1') }]]))
assert.equal(notifications.length, 1, 'a pending question raises a notification')
assert.equal(notifications[0].title, '重构登录流程', 'a reply alert carries the session title too')
assert.equal(notifications[0].options.body, '❗ 帮我把登录流程重构一下，顺便补上测试',
  'a reply alert opens with the attention icon and keeps the prompt precedence')

// The same pending interaction re-published is not a new request for a reply.
pushStatus(new Map([['s1', { running: false, pendingInteraction: pending('q:1') }]]))
assert.equal(notifications.length, 1, 'the same pending key does not notify twice')

// A reply body override keeps the attention icon in front of it too.
values = { ...values, notifyWaitingBody: '等你拍板' }
notifications.length = 0
pushStatus(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
pushStatus(new Map([['s1', { running: false, pendingInteraction: pending('q:1b') }]]))
assert.equal(notifications[0].options.body, '❗ 等你拍板',
  'a reply override keeps the attention icon in front of it')
values = { ...values, notifyWaitingBody: '' }

values = { ...values, notifyWaiting: false }
notifications.length = 0
pushStatus(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
pushStatus(new Map([['s1', { running: false, pendingInteraction: pending('q:2') }]]))
assert.equal(notifications.length, 0, 'the reply-notification switch silences it')

// With the plugin's own sound off, the toast is allowed to carry the OS sound.
values = { ...values, enabled: false, notifyWaiting: true }
notifications.length = 0
pushStatus(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
pushStatus(new Map([['s1', { running: false, pendingInteraction: pending('q:3') }]]))
assert.equal(notifications[0].options.silent, false, 'the OS sound is left on when this plugin plays nothing')
values = { ...values, enabled: true }

// The section's own test button and permission face.
notifications.length = 0
const notificationFace = sections[0].options.inject({ sync: () => {} })
assert.equal(notificationFace.notificationPermission(), 'granted')
assert.equal(notificationFace.testNotification(), true, 'the test button reports a raised notification')
assert.equal(notifications.length, 1, 'the test button raises one notification')
assert.equal(notifications[0].options.body, 'notify.completionBody',
  'the test button is not an alert, so its body carries no status icon')
assert.equal(notifications[0].title, 'notify.completionTitle', 'the test button keeps its dictionary title')

// The current binder seat is the one used; binding the deprecated name alone
// used to leave the whole section on the browser-local mirror.
assert.equal(boundSeat, 'webUiSettings', 'the current settings binder seat is bound')

// A receipt is only reported once the OS confirms the notification.
FakeNotification.autoShow = true
notifications.length = 0
assert.equal(notificationFace.testNotification(), true, 'the test button still reports a raised notification')
await new Promise((resolve) => { setTimeout(resolve, 20) })
assert.equal(notificationFace.notificationDelivery(), 'shown', 'a confirmed notification reports a receipt')

// An unconfirmed one reports the missing receipt instead of claiming success.
FakeNotification.autoShow = false
notifications.length = 0
finishTurn()
pushStatus(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
pushStatus(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
assert.equal(notifications.length, 1, 'a completion alert is raised')
assert.equal(notificationFace.notificationDelivery(), 'pending', 'an unconfirmed alert reports no receipt yet')
await new Promise((resolve) => { setTimeout(resolve, 1700) })
assert.equal(notificationFace.notificationDelivery(), 'failed', 'the missing receipt is reported')

// A page that has never been asked keeps permission at `default`; the alert is
// still raised (the desktop shell grants it) and the permission is requested,
// instead of the alert disappearing without a trace.
FakeNotification.permission = 'default'
notifications.length = 0
permissionRequests.length = 0
values = { ...values, notifyEnabled: true, notifyCompletion: true, notifyBackgroundOnly: false, completionDelayMs: 0 }
finishTurn()
pushStatus(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
pushStatus(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
assert.equal(permissionRequests.length, 1, 'an alert due on the default permission asks for it')
assert.equal(notifications.length, 1, 'a default permission still raises the alert')

// A denied permission is reported, and nothing is raised.
FakeNotification.permission = 'denied'
notifications.length = 0
finishTurn()
pushStatus(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
pushStatus(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
assert.equal(notifications.length, 0, 'a denied permission raises nothing')
assert.equal(notificationFace.notificationDelivery(), 'blocked', 'the denial is reported to the section')
FakeNotification.permission = 'granted'

// macOS asks for authorization while the first notification is already in
// flight, so the OS drops exactly that one: the page retries the first
// unconfirmed macOS post once, and never again.
stubPlatform('MacIntel')
notifications.length = 0
finishTurn()
pushStatus(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
pushStatus(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
assert.equal(notifications.length, 1, 'the first macOS alert is raised once')
await new Promise((resolve) => { setTimeout(resolve, 1700) })
assert.equal(notifications.length, 2, 'an unconfirmed first macOS alert is raised a second time')
finishTurn()
pushStatus(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
pushStatus(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
assert.equal(notifications.length, 3, 'a later macOS alert is raised once')
await new Promise((resolve) => { setTimeout(resolve, 1700) })
assert.equal(notifications.length, 3, 'the macOS retry is spent once per page')
stubPlatform('Win32')

// Durable layering: only the scope's own `user` layer may override the browser
// mirror. Its resolved `value` carries schema defaults for every field, and
// layering those on top would revert a preference this browser already stored the
// first time a Host settings scope is bound.
scopeHasUser = true
scopeUser = undefined
notificationFace.update({ notifyEnabled: true })
values = { ...values, notifyEnabled: false, notifyWaiting: true, notifyBackgroundOnly: false }
notifications.length = 0
pushStatus(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
pushStatus(new Map([['s1', { running: false, pendingInteraction: pending('durable:1') }]]))
assert.equal(notifications.length, 1, 'a mirrored preference survives a scope that stores no user edit')

// A durable edit of the same field outranks the mirror, in both directions.
scopeUser = { notifyEnabled: false }
notifications.length = 0
pushStatus(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
pushStatus(new Map([['s1', { running: false, pendingInteraction: pending('durable:2') }]]))
assert.equal(notifications.length, 0, 'a durable user edit outranks the mirror')
scopeUser = { notifyEnabled: true }
notifications.length = 0
pushStatus(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
pushStatus(new Map([['s1', { running: false, pendingInteraction: pending('durable:3') }]]))
assert.equal(notifications.length, 1, 'a durable user edit raises the alert')
scopeHasUser = false
scopeUser = undefined
mirror.delete('dsh-voice-alert/settings')

// The prompt the user sent for that turn outranks the session title.
notifications.length = 0
values = { ...values, notifyEnabled: true, notifyBackgroundOnly: false, notifyCompletionBody: '' }
finishTurn()
pushStatus(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
pushStatus(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
assert.equal(notifications[0].options.body, '🐳 帮我把登录流程重构一下，顺便补上测试',
  'the latest prompt outranks the session title')

// An explicit override still outranks both.
notifications.length = 0
values = { ...values, notifyCompletionBody: '搞定了' }
finishTurn()
pushStatus(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
pushStatus(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
assert.equal(notifications[0].options.body, '🐳 搞定了', 'the user override outranks the prompt')
values = { ...values, notifyCompletionBody: '' }

// ---------------------------------------------------- what must NOT alert

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms) })

// A turn the user cancelled reports `aborted`, so it stays silent.
closedTurn({ kind: 'aborted', reason: { kind: 'user' } })
tonePlays.length = 0
notifications.length = 0
pushStatus(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
pushStatus(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
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
  pushStatus(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
  pushStatus(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
  assert.equal(tonePlays.length, 0, `${reason.kind} stays silent`)
}

// A newer turn still open means the work continues: no "finished" alert.
openTurn(null)
tonePlays.length = 0
pushStatus(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
pushStatus(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
assert.equal(tonePlays.length, 0, 'a turn that is still open does not alert')

// Internal runs (subagents, teammates) end constantly, so they never alert.
sessionRows.s2 = { displayTitle: '研究子代理', origin: 'subagent', running: true, blank: false, updatedAt: 2 }
tonePlays.length = 0
notifications.length = 0
values = { ...values, notifyEnabled: true, notifyBackgroundOnly: false, notifyWaiting: true }
pushStatus(new Map([
  ['s2', { running: true, pendingInteraction: undefined }],
  ['s1', { running: false, pendingInteraction: undefined }],
]))
pushStatus(new Map([
  ['s2', { running: false, pendingInteraction: undefined }],
  ['s1', { running: false, pendingInteraction: undefined }],
]))
assert.equal(tonePlays.length, 0, 'a subagent finishing alerts nothing')
pushStatus(new Map([
  ['s2', { running: false, pendingInteraction: pending('sub:1') }],
  ['s1', { running: false, pendingInteraction: undefined }],
]))
assert.equal(notifications.length, 0, 'a subagent question alerts nothing')
delete sessionRows.s2

// A failed turn is the completion trigger, not a third one: same switch, same
// session title, and only the body source differs.
values = { ...values, notifyEnabled: true }
closedTurn({ kind: 'error', error: { message: 'ENOSPC: no space left on device', code: 'UNKNOWN' } })
tonePlays.length = 0
notifications.length = 0
pushStatus(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
pushStatus(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
assert.ok(tonePlays.length > 0, 'a failed turn still calls you back')
assert.equal(notifications.length, 1, 'a failed turn raises one notification')
assert.equal(notifications[0].title, '重构登录流程', 'a failed turn carries the session title, not an error title')
assert.ok(notifications[0].options.body.startsWith('🌀 '),
  'a failed turn opens with the failure icon')
assert.ok(notifications[0].options.body.includes('ENOSPC'), 'the failure text becomes the body')

// An error reason without a message falls back to the prompt like any other end.
closedTurn({ kind: 'error' })
tonePlays.length = 0
notifications.length = 0
pushStatus(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
pushStatus(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
assert.equal(notifications[0].options.body, '🌀 帮我把登录流程重构一下，顺便补上测试',
  'an error without a message keeps the failure icon and uses the prompt')

// A completion override on a failed turn still opens with the failure icon.
values = { ...values, notifyCompletionBody: '这轮炸了' }
tonePlays.length = 0
notifications.length = 0
finishTurn({ kind: 'error' })
pushStatus(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
pushStatus(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
assert.equal(notifications[0].options.body, '🌀 这轮炸了',
  'a failure override keeps the failure icon in front of it')
values = { ...values, notifyCompletionBody: '' }

// ------------------------------------------------------ the debounce itself

closedTurn({ kind: 'completed' })
values = { ...values, completionDelayMs: 60, notifyEnabled: false }
tonePlays.length = 0
pushStatus(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
pushStatus(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
assert.equal(tonePlays.length, 0, 'the completion alert waits out the delay')
await sleep(140)
assert.ok(tonePlays.length > 0, 'a turn that stays stopped alerts after the delay')

// A turn that resumes inside the delay reports nothing at all.
tonePlays.length = 0
pushStatus(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
pushStatus(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
pushStatus(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
await sleep(140)
assert.equal(tonePlays.length, 0, 'a resumed turn never reported the intermediate pause')

values = { ...values, completionDelayMs: 0 }
closedTurn({ kind: 'completed' })
pushStatus(new Map([['s1', { running: false, pendingInteraction: undefined }]]))

// ------------------------------- the body names the turn the user asked for

// An injected context reminder is user-role too, and it must not become the body.
values = { ...values, notifyEnabled: true, notifyBackgroundOnly: false }
closedTurn({ kind: 'completed' }, '把登录页的错误提示统一一下')
turnEntries = [
  ...turnEntries,
  userMessage('<system-reminder>Additional instructions from: AGENTS.md</system-reminder>', 'agent-instructions'),
]
notifications.length = 0
pushStatus(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
pushStatus(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
assert.equal(notifications[0].options.body, '🐳 把登录页的错误提示统一一下',
  'injected context never becomes the body')

// Without a user prompt the body falls back to the built-in copy, never to the
// session title: the title is the notification's title and nothing else.
closedTurn({ kind: 'completed' }, null)
notifications.length = 0
pushStatus(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
pushStatus(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
assert.equal(notifications[0].title, '重构登录流程', 'the title stays the session display title')
assert.equal(notifications[0].options.body, '🐳 notify.completionBody',
  'a log without a user prompt falls back to the default body, still behind the icon')

// A multi-line prompt collapses to one bounded line.
closedTurn({ kind: 'completed' }, `第一行\n\n第二行   ${'很长'.repeat(90)}`)
notifications.length = 0
pushStatus(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
pushStatus(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
const collapsed = notifications[0].options.body
assert.ok(collapsed.startsWith('🐳 第一行 第二行'), 'a multi-line prompt collapses into one line behind the icon')
assert.ok(collapsed.length <= 123, 'the body is the icon plus a prompt bounded to 120')

// ------------------------------------------ what the sidebar can and cannot see

// A row this browser has not loaded owns no sidebar dot, so it must stay silent
// even when the turn ends: the row check fails closed, not open.
closedTurn({ kind: 'completed' }, null)
delete sessionRows.s1
tonePlays.length = 0
notifications.length = 0
pushStatus(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
pushStatus(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
await sleep(20)
assert.equal(tonePlays.length, 0, 'a session without a catalog row plays nothing')
assert.equal(notifications.length, 0, 'a session without a catalog row notifies nothing')

// A stop this browser can no longer read is not a completion. The row is still
// an ordinary top-level session, but the view has retired the event window, so
// the idle edge has nothing to prove it was a finish: reporting one is the
// false alert this guards against.
sessionRows.s1 = { displayTitle: '重构登录流程', running: true, blank: false, updatedAt: 1 }
delete bindings.s1
pushStatus(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
tonePlays.length = 0
notifications.length = 0
pushStatus(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
await sleep(20)
assert.equal(tonePlays.length, 0, 'a stop with no readable window plays nothing')
assert.equal(notifications.length, 0, 'a stop with no readable window notifies nothing')

// The reported shape: the session is stopped while on screen, the user leaves
// it, and a later evaluation point — any other session's traffic — arrives once
// the window is already retired. That stop must not be re-read as a finish.
openTurn('继续')
bindings.s1 = { eventSource: windowSource }
tonePlays.length = 0
notifications.length = 0
pushStatus(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
pushStatus(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
assert.equal(tonePlays.length, 0, 'a stop whose window still shows the open turn plays nothing')
delete bindings.s1
pushStatus(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
await sleep(20)
assert.equal(tonePlays.length, 0, 'leaving the stopped session does not turn the stop into a completion')
assert.equal(notifications.length, 0, 'leaving the stopped session notifies nothing either')

// A reply that is needed needs no window either.
notifications.length = 0
pushStatus(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
pushStatus(new Map([['s1', { running: false, pendingInteraction: pending('q:9') }]]))
assert.equal(notifications.length, 1, 'a windowless session still raises the reply notification')
pushStatus(new Map([['s1', { running: false, pendingInteraction: undefined }]]))

// Back to a readable window for the cases that need one.
bindings.s1 = { eventSource: windowSource }
closedTurn({ kind: 'completed' })

// A teammate session is a subagent child: its own end and its own question are
// never sidebar dots, and it owns no trigger even while its row is loaded.
sessionRows.child = { displayTitle: 'teammate', parentId: 's1', running: true, blank: false, updatedAt: 2 }
tonePlays.length = 0
notifications.length = 0
pushStatus(new Map([
  ['child', { running: true, pendingInteraction: undefined }],
  ['s1', { running: true, pendingInteraction: undefined }],
]))
pushStatus(new Map([
  ['child', { running: false, pendingInteraction: undefined }],
  ['s1', { running: true, pendingInteraction: undefined }],
]))
await sleep(20)
assert.equal(tonePlays.length, 0, 'a teammate session finishing alerts nothing')
pushStatus(new Map([
  ['child', { running: false, pendingInteraction: pending('child:1') }],
  ['s1', { running: true, pendingInteraction: undefined }],
]))
assert.equal(notifications.length, 0, 'a teammate session question alerts nothing')
delete sessionRows.child

// The parent stops first while a child still runs: the sidebar row spins, so no
// completion alert. The last child stopping is the moment the row turns green,
// and it alerts exactly once.
projections.s1 = { values: { subagentCatalog: [{ id: 'child', createdAt: 0, mode: 'one-shot' }] } }
sessionRows.child = { displayTitle: 'teammate', parentId: 's1', running: true, blank: false, updatedAt: 2 }
tonePlays.length = 0
notifications.length = 0
pushStatus(new Map([
  ['child', { running: true, pendingInteraction: undefined }],
  ['s1', { running: true, pendingInteraction: undefined }],
]))
pushStatus(new Map([
  ['child', { running: true, pendingInteraction: undefined }],
  ['s1', { running: false, pendingInteraction: undefined }],
]))
await sleep(20)
assert.equal(tonePlays.length, 0, 'a parent with a running child does not alert when it stops')
assert.equal(notifications.length, 0, 'a parent with a running child notifies nothing')

pushStatus(new Map([
  ['child', { running: false, pendingInteraction: undefined }],
  ['s1', { running: false, pendingInteraction: undefined }],
]))
await sleep(20)
assert.equal(notifications.length, 1, 'the last child stopping is the moment the row turns green')

pushStatus(new Map([
  ['child', { running: false, pendingInteraction: undefined }],
  ['s1', { running: false, pendingInteraction: undefined }],
]))
await sleep(20)
assert.equal(notifications.length, 1, 'that completion alerts exactly once')
delete projections.s1
delete sessionRows.child

// The child row alone says it runs, with no status entry: the catalog fallback
// still counts it, so the parent stays in the spinning state.
closedTurn({ kind: 'completed' }, null)
projections.s1 = { values: { subagentCatalog: [{ id: 'child', createdAt: 0, mode: 'one-shot' }] } }
sessionRows.child = { displayTitle: 'teammate', parentId: 's1', running: true, blank: false, updatedAt: 2 }
notifications.length = 0
pushStatus(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
pushStatus(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
await sleep(20)
assert.equal(notifications.length, 0, 'a child row still marked running suppresses the parent alert')
sessionRows.child.running = false
pushRows()
await sleep(20)
assert.equal(notifications.length, 1, 'the child row stopping releases the parent alert')
delete projections.s1
delete sessionRows.child

// A session on screen is still worth alerting for: the sidebar shows its dot
// whether or not it is the one you are looking at.
sessionRows.s1 = { displayTitle: '重构登录流程', running: true, blank: false, updatedAt: 1 }
closedTurn({ kind: 'completed' })
notifications.length = 0
pushStatus(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
pushStatus(new Map([['s1', { running: false, pendingInteraction: undefined }]]))
assert.equal(notifications.length, 1, 'the session in the main view still alerts when it finishes')
assert.equal(notifications[0].options.body, '🐳 帮我把登录流程重构一下，顺便补上测试',
  'its body is still the prompt the user sent, behind the completion icon')

// ------------------------------------------------ boot races and unknown kinds

// A plugin that initialized before the session list landed must not read the
// rows arriving later as sessions that just stopped: a session that finished
// before this page opened is idle in the sidebar, not a completion.
delete sessionRows.s1
sessionRows.s0 = { displayTitle: '别的会话', running: true, blank: false, updatedAt: 1 }
tonePlays.length = 0
notifications.length = 0
pushStatus(new Map([['s0', { running: true, pendingInteraction: undefined }]]))
sessionRows.dead = { displayTitle: '上个月就完成的', running: false, blank: false, updatedAt: 5 }
pushStatus(new Map([
  ['s0', { running: true, pendingInteraction: undefined }],
  ['dead', { running: false, pendingInteraction: undefined }],
]))
pushRows()
await sleep(20)
assert.equal(tonePlays.length, 0, 'a session that lands already stopped plays nothing')
assert.equal(notifications.length, 0, 'a session that lands already stopped notifies nothing')

// Later evaluation points must not report it either: one stop is one episode.
pushStatus(new Map([
  ['s0', { running: true, pendingInteraction: undefined }],
  ['dead', { running: false, pendingInteraction: undefined }],
]))
pushRows()
await sleep(20)
assert.equal(notifications.length, 0, 'later evaluation points do not report it either')
delete sessionRows.dead

// While the list RPC is still in flight the plugin only builds a baseline.
listPhase = 'pending'
notifications.length = 0
pushStatus(new Map([['s0', { running: true, pendingInteraction: undefined }]]))
pushStatus(new Map([['s0', { running: false, pendingInteraction: undefined }]]))
await sleep(20)
assert.equal(notifications.length, 0, 'a stop during the pending list phase stays silent')
listPhase = 'ready'

// ...and the same transition once the list is ready is still a stop, not a
// finish: no window can be read and the sidebar marks no unread completion, so
// nothing proves the turn ended and the plugin must stay silent.
pushStatus(new Map([['s0', { running: true, pendingInteraction: undefined }]]))
pushStatus(new Map([['s0', { running: false, pendingInteraction: undefined }]]))
await sleep(20)
assert.equal(notifications.length, 0, 'a windowless stop after the list is ready stays silent')

// The sidebar's own unread mark is the status signal that carries the alert,
// window or no window; only the idle edge needs a durable turn to prove itself.
pushStatus(new Map([['s0', { running: true, pendingInteraction: undefined }]]))
pushStatus(new Map([['s0', { running: false, completionUnread: true, pendingInteraction: undefined }]]))
await sleep(20)
assert.equal(notifications.length, 1, 'the unread mark carries a windowless completion')
delete sessionRows.s0

// A pending interaction the sidebar does not turn yellow for is not a request
// for a reply, and it must not hold back the completion alert either.
sessionRows.s1 = { displayTitle: '重构登录流程', running: true, blank: false, updatedAt: 1 }
bindings.s1 = { eventSource: windowSource }
closedTurn({ kind: 'completed' })
notifications.length = 0
pushStatus(new Map([['s1', { running: true, pendingInteraction: undefined }]]))
pushStatus(new Map([['s1', { running: true, pendingInteraction: pending('wf:1', 'workflow-review') }]]))
assert.equal(notifications.length, 0, 'a pending kind the sidebar ignores alerts nothing')
pushStatus(new Map([['s1', { running: false, pendingInteraction: pending('wf:1', 'workflow-review') }]]))
await sleep(20)
assert.equal(notifications.length, 1, 'and it does not hold back the completion alert')
pushStatus(new Map([['s1', { running: false, pendingInteraction: undefined }]]))

// Two sessions stopping in the same evaluation point: the newest one reports at
// once, and the other is deferred to its own debounce rather than dropped. Both
// windows are readable, so both ends are proven and neither is a stop.
const finishedWindow = (text) => {
  const turn = nextFixtureTurn()
  return {
    getSnapshot: () => ({
      entries: [
        userMessage(text),
        { type: 'event', event: { type: 'turn/start', data: { turn } } },
        { type: 'event', event: { type: 'turn/end', data: { turn, reason: { kind: 'completed' } } } },
      ],
    }),
    subscribe: () => () => {},
  }
}
sessionRows.a = { displayTitle: 'A', running: true, blank: false, updatedAt: 1 }
sessionRows.b = { displayTitle: 'B', running: true, blank: false, updatedAt: 2 }
bindings.a = { eventSource: finishedWindow('A 的提问') }
bindings.b = { eventSource: finishedWindow('B 的提问') }
notifications.length = 0
pushStatus(new Map([
  ['a', { running: true, pendingInteraction: undefined }],
  ['b', { running: true, pendingInteraction: undefined }],
]))
pushStatus(new Map([
  ['a', { running: false, pendingInteraction: undefined }],
  ['b', { running: false, pendingInteraction: undefined }],
]))
assert.equal(notifications.length, 1, 'one evaluation point reports one completion')
assert.equal(notifications[0].title, 'B', 'the newest row leads the tie-break')
await sleep(20)
assert.equal(notifications.length, 2, 'the losing candidate is deferred, not dropped')
assert.equal(notifications[1].title, 'A', 'and it reports for its own session')
delete sessionRows.a
delete sessionRows.b
delete bindings.a
delete bindings.b

// The newest-turn scan is reused while a session's window snapshot is
// unchanged: an evaluation point must not rescan every long log it can see.
// The row is watched running and then stopping, so the window is actually
// consulted; its newest turn is open, so the completion is vetoed.
let windowScans = 0
const probeEntries = [{ type: 'event', event: { type: 'turn/start', data: { turn: 1 } } }]
const countingEntries = {
  [Symbol.iterator]: function* () { windowScans += 1; yield* probeEntries },
}
bindings.probe = {
  eventSource: { getSnapshot: () => ({ entries: countingEntries }), subscribe: () => () => {} },
}
sessionRows.probe = { displayTitle: '探针', running: true, blank: false, updatedAt: 3 }
const probeStatus = (running) => pushStatus(new Map([
  ['probe', { running, pendingInteraction: undefined }],
  ['s1', { running: true, pendingInteraction: undefined }],
]))
probeStatus(true)
probeStatus(false)
const firstScanCount = windowScans
assert.equal(firstScanCount, 1, 'the first evaluation scans the window once')
probeStatus(false)
assert.equal(windowScans, firstScanCount, 'an unchanged window snapshot is not rescanned')
delete sessionRows.probe
delete bindings.probe

// ------------------------------------------- the window never starts an alert

// A session that ended before this plugin looked at it is idle here: no green
// dot, no window. Opening it for the first time materializes its log, whose
// last turn is a `turn/end` from before this page existed — that is not a
// completion, so it must stay silent.
closedTurn({ kind: 'completed' }, '这是很久以前的提问')
sessionRows.idle = { displayTitle: '早就结束的会话', running: false, blank: false, updatedAt: 4 }
tonePlays.length = 0
notifications.length = 0
pushStatus(new Map([
  ['idle', { running: false, completionUnread: false, pendingInteraction: undefined }],
]))
assert.equal(notifications.length, 0, 'an idle row with no window alerts nothing')
// First click: the session is retained and its durable log materializes.
bindings.idle = { eventSource: windowSource }
pushStatus(new Map([
  ['idle', { running: false, completionUnread: false, pendingInteraction: undefined }],
]))
pushRows()
await sleep(20)
assert.equal(tonePlays.length, 0, 'materializing the log of an idle session plays nothing')
assert.equal(notifications.length, 0, 'materializing the log of an idle session notifies nothing')
delete sessionRows.idle
delete bindings.idle

// The status signal alone is enough when this browser never saw the session
// run: an unread completion with no window still alerts (the window is not
// required), and opening it afterwards must not report the same finish twice.
sessionRows.bg = { displayTitle: '后台完成的会话', running: false, blank: false, updatedAt: 6 }
notifications.length = 0
pushStatus(new Map([
  ['bg', { running: false, completionUnread: true, pendingInteraction: undefined }],
]))
assert.equal(notifications.length, 1, 'an unread completion with no window still alerts')
assert.equal(notifications[0].title, '后台完成的会话', 'and it carries the session title')
bindings.bg = { eventSource: windowSource }
pushStatus(new Map([
  ['bg', { running: false, completionUnread: false, pendingInteraction: undefined }],
]))
pushRows()
await sleep(20)
assert.equal(notifications.length, 1, 'opening the alerted session does not report it again')
delete sessionRows.bg
delete bindings.bg

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

console.log('smoke: ok — sections, writes, both sidebar-dot alerts, and the no-alert cases behave')
