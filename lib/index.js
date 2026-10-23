/**
 * Host half of dsh-voice-alert.
 *
 * The plugin owns no host behavior beyond declaring its configuration: the
 * browser half plays the sounds and renders the Settings page. Registering the
 * namespace below is what makes the preferences durable and visible to the
 * browser, which reads and writes them through `ctx.settingsScope`.
 */
import z from '@deepseek-ai/schemastery'

/** Plugin name reported to the Loader. */
export const name = 'voice-alert'

/** Settings namespace the browser half binds; lowercase and hyphenated by contract. */
export const NAMESPACE = 'voice-alert'

/**
 * The preferences, used both as this entry's Config (the composition base a
 * cordis.yml edit overrides) and as the registered settings namespace schema.
 * `volume` is a fraction of full scale.
 */
export const Config = z.object({
  /** Master switch for both sounds. */
  enabled: z.boolean().default(true),
  /** Playback volume as a fraction of full scale. */
  volume: z.number().min(0).max(1).default(0.6),
  /** Play a sound when a turn finishes. */
  completionEnabled: z.boolean().default(true),
  /** Built-in tone id used when no custom file is set. */
  completionTone: z.string().default('chime-up'),
  /** Custom completion sound as a data URL; empty means use `completionTone`. */
  completionFile: z.string().default(''),
  /**
   * How long to wait after a turn stops before alerting, in milliseconds. A turn
   * that resumes inside this window (a goal round, an auto-continuation) never
   * alerts, so an intermediate pause is not reported as a finished task. 0 turns
   * the debounce off.
   */
  completionDelayMs: z.number().min(0).max(60000).default(1200),
  /** Play a sound when the agent waits for an answer or a decision. */
  waitingEnabled: z.boolean().default(true),
  /** Built-in tone id used when no custom file is set. */
  waitingTone: z.string().default('ask-up'),
  /** Custom waiting sound as a data URL; empty means use `waitingTone`. */
  waitingFile: z.string().default(''),
  /** Show a Windows/macOS system notification in addition to the sound. */
  notifyEnabled: z.boolean().default(false),
  /** Notify when a turn finishes. */
  notifyCompletion: z.boolean().default(true),
  /** Notify when the agent waits for an answer or a decision. */
  notifyWaiting: z.boolean().default(true),
  /** Only notify while the window is not in front, so an active user is not interrupted twice. */
  notifyBackgroundOnly: z.boolean().default(true),
  /** Notification body for a finished task; empty uses the built-in text. */
  notifyCompletionBody: z.string().default(''),
  /** Notification body for a pending reply; empty uses the built-in text. */
  notifyWaitingBody: z.string().default(''),
})

/** Global the Host half writes into every rendered page. */
export const BOOT_GLOBAL = '__DSH_VOICE_ALERT__'

/**
 * Register the durable settings namespace when a settings provider is composed,
 * and always publish the entry Config into the page.
 *
 * A profile without a settings provider would otherwise leave this entry's
 * Config inert: the browser half could not read the composition layer, so a
 * cordis.yml value would never reach the sounds. The injected global carries
 * that layer, and the browser mirror overrides it per field.
 *
 * The namespace registration is optional on purpose: the current runtime serves
 * `settings` as `SettingsForms`, which has no `register` method — there the
 * durable values live in this profile entry's own Config, which the browser half
 * binds through `webUiSettings`. Probing the method keeps this entry's startup
 * from erroring on a runtime that dropped it while still registering on one that
 * still offers it.
 * @param ctx - host plugin context.
 * @param config - validated entry Config, resolved below the user's own edits.
 */
export function apply(ctx, config) {
  ctx.inject(['settings'], (settingsCtx) => {
    if (typeof settingsCtx.settings?.register !== 'function') return
    settingsCtx.settings.register(NAMESPACE, Config, { base: config })
  })
  ctx.on('webserver/index-inject', (table) => {
    table.push({
      kind: 'script',
      placement: 'body',
      text: `window.${BOOT_GLOBAL}=${JSON.stringify(config).replaceAll('<', '\\u003c')}`,
    })
  }, { prepend: true })
}
