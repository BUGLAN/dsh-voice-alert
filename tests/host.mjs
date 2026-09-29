/**
 * Keyless test for the Host half.
 *
 * Runs `lib/index.js` against a stubbed Cordis context and proves the two host
 * contracts: the settings namespace registration and the page injection that
 * carries the entry Config to the browser. No dependency beyond Node.
 *
 *   node tests/host.mjs
 */
import assert from 'node:assert/strict'

const moduleExports = await import('../lib/index.js')
assert.equal(moduleExports.name, 'voice-alert')
assert.equal(moduleExports.NAMESPACE, 'voice-alert')
assert.equal(moduleExports.BOOT_GLOBAL, '__DSH_VOICE_ALERT__')

/** Minimal Cordis context: record the settings registration and the index injections. */
function run(config) {
  const registrations = []
  const listeners = new Map()
  const ctx = {
    inject: (deps, callback) => {
      assert.deepEqual(deps, ['settings'])
      callback({
        settings: {
          register: (ns, schema, options) => { registrations.push({ ns, schema, options }) },
        },
      })
      return () => {}
    },
    on: (name, listener, options) => {
      listeners.set(name, { listener, options })
      return () => {}
    },
  }
  moduleExports.apply(ctx, config)
  return { registrations, listeners }
}

const defaults = moduleExports.Config({})
const { registrations, listeners } = run(defaults)

// The namespace registration is what makes the settings durable when a provider is composed.
assert.equal(registrations.length, 1, 'one namespace registered')
assert.equal(registrations[0].ns, 'voice-alert')
assert.equal(registrations[0].schema, moduleExports.Config, 'the namespace reuses the entry schema')
assert.deepEqual(registrations[0].options.base, defaults, 'the entry Config becomes the composition base')
assert.equal(registrations[0].schema({}).volume, 0.6, 'schema defaults resolve')
assert.equal(registrations[0].schema({}).completionDelayMs, 1200, 'the completion debounce is configurable')

// The index injection carries the composition layer into the page.
const injection = listeners.get('webserver/index-inject')
assert.ok(injection !== undefined, 'the webserver index-inject listener is registered')
assert.equal(injection.options.prepend, true)
const table = []
injection.listener(table)
assert.equal(table.length, 1, 'one injection row')
assert.equal(table[0].kind, 'script')
assert.equal(table[0].placement, 'body')
assert.ok(table[0].text.startsWith('window.__DSH_VOICE_ALERT__='), 'the row assigns the boot global')
assert.ok(table[0].text.includes('"completionTone":"chime-up"'), 'the row carries the resolved Config')

// A configured value reaches the page, and `<` cannot break out of the script body.
const configured = moduleExports.Config({ completionTone: 'bell', waitingFile: 'data:audio/wav;base64,</script>' })
const second = run(configured)
const configuredTable = []
second.listeners.get('webserver/index-inject').listener(configuredTable)
assert.ok(configuredTable[0].text.includes('"completionTone":"bell"'), 'a configured tone reaches the page')
assert.ok(!configuredTable[0].text.includes('</script>'), 'a payload cannot close the script element')
assert.ok(configuredTable[0].text.includes('\\u003c'), 'the payload escapes the angle bracket')

console.log('host: ok — namespace registration and page injection behave')
