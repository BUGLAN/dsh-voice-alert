/**
 * Browser half of dsh-voice-alert.
 *
 * Loaded by the client module system as the package's `./client` bundle (the
 * factory/CJS envelope is the protocol `window.__ModuleLoader__.load` expects).
 * It plays one sound when a turn finishes and another when the agent is waiting
 * for the user, and it registers the Settings section that configures both.
 *
 * Only baseline module-table entries are requested (`react`,
 * `@deepseek-ai/dsh-client-store`); every service arrives through Cordis
 * injection.
 */
window.__ModuleLoader__.load({
  id: 'dsh-voice-alert',
  factory: (require) => {
    const React = require('react')
    const { defineStore } = require('@deepseek-ai/dsh-client-store')

    /** Settings namespace registered by the Host half. */
    const NAMESPACE = 'voice-alert'
    /** Settings-section key; also the slot entry id the shell lists. */
    const SECTION_ID = 'voice-alert'
    /** Locale namespace owning this feature's copy. */
    const LOCALE_NS = 'settings.voiceAlert'
    /** Browser-local mirror used until, or instead of, the Host settings document. */
    const MIRROR_KEY = 'dsh-voice-alert/settings'
    /** Global the Host half injects into the page; it carries the entry Config. */
    const BOOT_GLOBAL = '__DSH_VOICE_ALERT__'
    /** Largest custom sound accepted, in bytes before base64 encoding. */
    const MAX_FILE_BYTES = 1536 * 1024
    /** Longest session prompt shown as a notification body, in characters. */
    const PROMPT_LIMIT = 120
    /**
     * Built-in tones. Each note is `[frequency Hz, start offset s, duration s]`
     * over a sine carrier with a short attack and an exponential decay.
     */
    const TONES = {
      'chime-up': { notes: [[523.25, 0, 0.45], [783.99, 0.11, 0.8]] },
      'chime-down': { notes: [[783.99, 0, 0.4], [523.25, 0.11, 0.75]] },
      bell: { notes: [[659.25, 0, 1.3]] },
      ping: { notes: [[880, 0, 0.28]] },
      double: { notes: [[880, 0, 0.16], [880, 0.2, 0.32]] },
      triple: { notes: [[523.25, 0, 0.22], [659.25, 0.14, 0.22], [783.99, 0.28, 0.45]] },
      'ask-up': { notes: [[587.33, 0, 0.3], [880, 0.16, 0.55]] },
      'ask-down': { notes: [[880, 0, 0.3], [587.33, 0.16, 0.55]] },
    }
    const TONE_IDS = Object.keys(TONES)
    /** Peak gain of one note before the user's volume is applied. */
    const TONE_PEAK = 0.32

    const DEFAULTS = Object.freeze({
      enabled: true,
      volume: 0.6,
      completionEnabled: true,
      completionTone: 'chime-up',
      completionFile: '',
      completionDelayMs: 1200,
      waitingEnabled: true,
      waitingTone: 'ask-up',
      waitingFile: '',
      notifyEnabled: false,
      notifyCompletion: true,
      notifyWaiting: true,
      notifyBackgroundOnly: true,
      notifyCompletionBody: '',
      notifyWaitingBody: '',
    })

    /** Keys the browser may read and write; everything else is ignored on read. */
    const SETTING_KEYS = Object.keys(DEFAULTS)

    // ---------------------------------------------------------------- locales

    const zh = {
      nav: '语音提醒',
      title: '语音提醒',
      description: '会话在侧边栏显示完成或需要你回复时提醒。',
      enabled: '启用提示音',
      volume: '音量',
      completion: '会话显示完成时',
      completionHint: '该会话在侧边栏出现绿色状态点时提醒；你主动取消的一轮不会提醒。',
      waiting: '需要你回复时',
      waitingHint: '该会话在侧边栏出现黄色状态点时提醒：dsh 向你提问或请求授权。',
      play: '试听',
      tone: '提示音',
      custom: '自定义音频',
      choose: '选择音频文件…',
      replace: '更换音频文件…',
      clear: '清除',
      using: '正在使用自定义音频，约 {kb} KB。',
      fileTooLarge: '音频文件过大，上限 1.5 MB。',
      fileReadError: '无法读取该音频文件。',
      fileApplied: '已应用自定义音频。',
      unavailable: '当前浏览器无法写入设置，改动只在本机生效。',
      notify: '系统通知',
      notifyHint: '在 Windows / macOS 的通知中心弹出提醒，窗口不在最前时特别有用。',
      notifyEnabled: '启用系统通知',
      notifyCompletion: '会话完成时通知',
      notifyWaiting: '需要你回复时通知',
      notifyBackgroundOnly: '仅当窗口不在最前时通知',
      notifyCompletionBody: '完成通知内容（留空用默认文案）',
      notifyWaitingBody: '回复通知内容（留空用默认文案）',
      notifyTest: '发送测试通知',
      notifyGranted: '系统通知权限已获得。',
      notifyPrompt: '尚未授权，点击上方开关或“发送测试通知”时系统会询问。',
      notifyDenied: '系统通知已被拒绝，请在系统设置里为 DeepSeek Harness 打开通知。',
      notifyUnsupported: '当前环境不支持系统通知。',
      notifySent: '测试通知已发送。',
      notifyDelivered: '系统已接收这条通知。',
      notifyNoReceipt: '系统没有回执：macOS 可能还没允许通知，或被“专注模式”拦截。请在“系统设置 → 通知”里允许 DeepSeek Harness。',
      'notify.completionTitle': '任务完成',
      'notify.completionBody': 'dsh 已完成一轮任务，可以查看了。',
      'notify.waitingBody': 'dsh 正在等待你的回答或授权。',
      'tone.chime-up': '清脆上行',
      'tone.chime-down': '柔和下行',
      'tone.bell': '铃音',
      'tone.ping': '单声提示',
      'tone.double': '双声提示',
      'tone.triple': '三连音',
      'tone.ask-up': '轻快上行',
      'tone.ask-down': '轻快下行',
    }
    const en = {
      nav: 'Sound alerts',
      title: 'Sound alerts',
      description: 'Alert when a session shows as finished or needs your reply.',
      enabled: 'Enable sounds',
      volume: 'Volume',
      completion: 'When a session shows as finished',
      completionHint: 'Raised when the session shows a green status dot in the sidebar; a turn you cancel stays silent.',
      waiting: 'When your reply is needed',
      waitingHint: 'Raised when the session shows a yellow status dot: dsh asks you a question or requests authorization.',
      play: 'Preview',
      tone: 'Tone',
      custom: 'Custom audio',
      choose: 'Choose an audio file…',
      replace: 'Replace audio file…',
      clear: 'Clear',
      using: 'Using a custom sound, about {kb} KB.',
      fileTooLarge: 'That audio file is too large; the limit is 1.5 MB.',
      fileReadError: 'That audio file could not be read.',
      fileApplied: 'Custom sound applied.',
      unavailable: 'This browser cannot write settings; changes stay local.',
      notify: 'System notifications',
      notifyHint: 'Raise a Windows/macOS notification, most useful while the window is behind another app.',
      notifyEnabled: 'Enable system notifications',
      notifyCompletion: 'Notify when a session finishes',
      notifyWaiting: 'Notify when your reply is needed',
      notifyBackgroundOnly: 'Only while the window is not in front',
      notifyCompletionBody: 'Completion text (empty uses the default)',
      notifyWaitingBody: 'Reply text (empty uses the default)',
      notifyTest: 'Send a test notification',
      notifyGranted: 'Notification permission is granted.',
      notifyPrompt: 'Not granted yet; the system asks when you use the switch or the test button.',
      notifyDenied: 'Notifications are blocked; allow them for DeepSeek Harness in your system settings.',
      notifyUnsupported: 'This environment does not support system notifications.',
      notifySent: 'Test notification sent.',
      notifyDelivered: 'The system accepted this notification.',
      notifyNoReceipt: 'No receipt from the system: macOS may not have allowed notifications yet, or Focus is silencing them. Allow DeepSeek Harness in System Settings → Notifications.',
      'notify.completionTitle': 'Task finished',
      'notify.completionBody': 'dsh finished a turn and is waiting for you.',
      'notify.waitingBody': 'dsh is waiting for your answer or authorization.',
      'tone.chime-up': 'Bright rise',
      'tone.chime-down': 'Soft fall',
      'tone.bell': 'Bell',
      'tone.ping': 'Single ping',
      'tone.double': 'Double ping',
      'tone.triple': 'Three notes',
      'tone.ask-up': 'Light rise',
      'tone.ask-down': 'Light fall',
    }

    // ------------------------------------------------------------------ audio

    let audio = null

    /** Read (and lazily create) the shared AudioContext, resuming it if suspended. */
    function audioContext() {
      if (audio !== null && audio.state === 'closed') audio = null
      if (audio === null) {
        const Ctor = window.AudioContext ?? window.webkitAudioContext
        if (Ctor === undefined) return null
        audio = new Ctor()
      }
      if (audio.state === 'suspended') void audio.resume()
      return audio
    }

    /** Clamp a value into 0..1; non-numbers fall back to the default volume. */
    function volumeOf(value) {
      return typeof value === 'number' && Number.isFinite(value)
        ? Math.min(1, Math.max(0, value))
        : DEFAULTS.volume
    }

    /**
     * Schedule one tone preset's notes on a running context.
     * @param context - a running AudioContext.
     * @param preset - tone preset from {@link TONES}.
     * @param volume - playback volume in 0..1.
     */
    function scheduleTone(context, preset, volume) {
      const now = context.currentTime + 0.01
      for (const [frequency, offset, duration] of preset.notes) {
        const oscillator = context.createOscillator()
        const gain = context.createGain()
        const start = now + offset
        oscillator.type = 'sine'
        oscillator.frequency.value = frequency
        gain.gain.setValueAtTime(0, start)
        gain.gain.linearRampToValueAtTime(Math.max(0.0001, TONE_PEAK * volume), start + 0.012)
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
        oscillator.connect(gain)
        gain.connect(context.destination)
        oscillator.start(start)
        oscillator.stop(start + duration + 0.02)
      }
    }

    /**
     * Play one built-in tone. A page that has not seen a gesture keeps its
     * AudioContext suspended: notes scheduled now land on a frozen timeline,
     * so the alert plays garbled — or not at all — once the context finally
     * resumes. A suspended context therefore waits for its resume to settle
     * and schedules afterwards, so the sound is heard the moment audio unlocks.
     * @param id - tone id from {@link TONES}; unknown ids play nothing.
     * @param volume - playback volume in 0..1.
     */
    function playTone(id, volume) {
      const preset = Object.hasOwn(TONES, id) ? TONES[id] : undefined
      if (preset === undefined) return
      const context = audioContext()
      if (context === null) return
      if (context.state === 'suspended') {
        void context.resume().then(
          () => { if (context.state === 'running') scheduleTone(context, preset, volume) },
          () => {},
        )
        return
      }
      scheduleTone(context, preset, volume)
    }

    /**
     * Play a custom sound from its data URL, falling back to a built-in tone when
     * the browser refuses to play it (unsupported codec, blocked autoplay).
     * @param dataUrl - `data:audio/...` URL stored in the settings document.
     * @param volume - playback volume in 0..1.
     * @param fallbackTone - built-in tone id to play instead.
     */
    function playFile(dataUrl, volume, fallbackTone) {
      let element
      try {
        element = new Audio(dataUrl)
      } catch {
        playTone(fallbackTone, volume)
        return
      }
      element.volume = volume
      const started = element.play()
      if (started !== undefined) started.catch(() => { playTone(fallbackTone, volume) })
    }

    // -------------------------------------------------- system notifications

    /** One shell-owned notification entry, so an alert replaces the previous one. */
    const NOTIFICATION_TAG = 'dsh-voice-alert'
    /**
     * How long a raised notification may stay unconfirmed before it counts as
     * lost. Electron forwards the notification's show event but not its failure
     * event, so "no receipt inside this window" is the only observable failure —
     * and macOS is the platform that produces it: it asks for notification
     * authorization the first time this app posts one and drops that very
     * request while the prompt is up.
     */
    const DELIVERY_GRACE_MS = 1500

    /** Where the last raised notification ended up, for the Settings diagnostics. */
    let delivery = 'idle'
    /** Whether macOS's one first-delivery retry has already been spent. */
    let firstDeliveryRetried = false

    /** Record a delivery transition. */
    function publishDelivery(next) {
      delivery = next
    }

    /** Whether this page runs on macOS, where the first post races the authorization prompt. */
    function platformIsMac() {
      if (typeof navigator !== 'object' || navigator === null) return false
      const hint = navigator.userAgentData?.platform ?? navigator.platform ?? navigator.userAgent ?? ''
      return /mac/i.test(String(hint))
    }

    /** Whether this environment can raise a system notification. */
    function notificationsSupported() {
      return typeof window.Notification === 'function'
    }

    /** @returns the current permission: granted, denied, default, or unsupported. */
    function notificationPermission() {
      return notificationsSupported() ? window.Notification.permission : 'unsupported'
    }

    /**
     * Ask for notification permission. Only meaningful from a user gesture: the
     * desktop shell grants the request, a plain browser may prompt.
     * @returns the permission after the request settles.
     */
    function requestNotificationPermission() {
      if (!notificationsSupported()) return Promise.resolve('unsupported')
      if (window.Notification.permission !== 'default') {
        return Promise.resolve(window.Notification.permission)
      }
      try {
        return Promise.resolve(window.Notification.requestPermission()).then(
          (result) => result ?? window.Notification.permission,
          () => window.Notification.permission,
        )
      } catch {
        return Promise.resolve(window.Notification.permission)
      }
    }

    /**
     * Raise one Windows/macOS notification.
     * @param title - notification title.
     * @param body - notification body.
     * @param silent - suppress the OS sound, set when this plugin already played one.
     * @returns the created notification.
     */
    function raise(title, body, silent) {
      const notification = new window.Notification(title, { body, silent, tag: NOTIFICATION_TAG })
      notification.onclick = () => {
        try {
          window.focus()
        } catch {
          // Focusing the shell window is best effort; the click itself still dismisses.
        }
      }
      return notification
    }

    /**
     * Follow one raised notification to its receipt. Electron forwards the show
     * event to the page but never the failure event, so an unconfirmed alert is
     * the only failure signal this scope has: it is reported as `failed` after
     * {@link DELIVERY_GRACE_MS} and, for the first macOS post, raised a second
     * time — after that wait the OS prompt has usually been answered, which is
     * what makes the second attempt land.
     * @param notification - the notification whose events to observe.
     * @param retry - re-raise once after the grace period, or undefined.
     */
    function watchDelivery(notification, retry) {
      publishDelivery('pending')
      let settled = false
      notification.onshow = () => { settled = true; publishDelivery('shown') }
      notification.onerror = () => { settled = true; publishDelivery('failed') }
      setTimeout(() => {
        if (settled) return
        publishDelivery('failed')
        if (retry !== undefined) retry()
      }, DELIVERY_GRACE_MS)
    }

    /**
     * Raise one Windows/macOS notification and watch its receipt. A permission of
     * `default` still attempts: Electron's desktop shell grants the request
     * without a prompt, and Chromium queues the notification behind it, so
     * bailing out here is what made a macOS alert vanish without a trace.
     * @param title - notification title.
     * @param body - notification body.
     * @param silent - suppress the OS sound, set when this plugin already played one.
     * @returns whether a notification was created.
     */
    function notify(title, body, silent) {
      if (!notificationsSupported()) {
        publishDelivery('unsupported')
        return false
      }
      if (notificationPermission() === 'denied') {
        publishDelivery('blocked')
        return false
      }
      try {
        // macOS asks for authorization while the first notification is already
        // in flight and drops it; spend the single retry on exactly that post.
        const retry = platformIsMac() && !firstDeliveryRetried && delivery !== 'shown'
        if (retry) firstDeliveryRetried = true
        const notification = raise(title, body, silent)
        watchDelivery(notification, retry ? () => {
          try {
            watchDelivery(raise(title, body, silent))
          } catch {
            publishDelivery('failed')
          }
        } : undefined)
        return true
      } catch {
        publishDelivery('failed')
        return false
      }
    }

    /** Whether the window is currently not in front of the user. */
    function windowIsBehind() {
      if (typeof document.hasFocus !== 'function') return false
      return !document.hasFocus()
    }

    // --------------------------------------------------------------- settings

    /** Known setting keys of one layer, type-matched to the defaults. */
    function layer(source) {
      const values = {}
      if (source === null || typeof source !== 'object') return values
      for (const key of SETTING_KEYS) {
        const value = source[key]
        if (value !== undefined && typeof value === typeof DEFAULTS[key]) values[key] = value
      }
      if (values.volume !== undefined) values.volume = volumeOf(values.volume)
      return values
    }

    /** The entry Config the Host half injected into this page, when it did. */
    function bootLayer() {
      return layer(window[BOOT_GLOBAL])
    }

    /** Read the browser-local mirror layer written by an earlier session. */
    function readMirror() {
      try {
        const raw = window.localStorage.getItem(MIRROR_KEY)
        return raw === null ? undefined : JSON.parse(raw)
      } catch {
        return undefined
      }
    }

    /** Merge a patch into the mirror layer; only touched keys are stored, so the Host layer still shows through. */
    function writeMirror(patch) {
      try {
        const stored = readMirror()
        const base = stored === null || typeof stored !== 'object' || Array.isArray(stored) ? {} : stored
        window.localStorage.setItem(MIRROR_KEY, JSON.stringify({ ...base, ...patch }))
      } catch {
        // A browser with storage disabled keeps the Host document as its only store.
      }
    }

    /** Resolved values without a settings provider: defaults, then the Host Config, then the mirror. */
    function localSettings() {
      return { ...DEFAULTS, ...bootLayer(), ...layer(readMirror()) }
    }

    /**
     * The accepted values: the built-in defaults, the Host entry Config, the
     * browser mirror, and finally the durable settings scope, each overriding the
     * one before it.
     *
     * The durable layer is the scope's `user` — the edits this profile actually
     * stores — not its resolved `value`, which carries a schema default for every
     * field. Layering those on top would silently revert a preference the browser
     * had already stored in its mirror, which is exactly the state a profile is in
     * the first time this plugin binds a Host settings scope. A scope that exposes
     * no `user` field at all (the local mirror scope) keeps contributing `value`.
     */
    function readSettings(form) {
      const snapshot = form.getSnapshot()
      if (snapshot.status !== 'ready') return localSettings()
      const durable = Object.hasOwn(snapshot, 'user') ? snapshot.user : snapshot.value
      return durable === undefined ? localSettings() : { ...localSettings(), ...layer(durable) }
    }

    /**
     * Persist a patch. The mirror always updates first so a browser that never
     * receives a writable namespace still remembers the choice; the Host write
     * is a separate accepted operation.
     */
    function writeSettings(form, patch) {
      writeMirror(patch)
      if (form.getSnapshot().status !== 'ready') return
      for (const key of Object.keys(patch)) void form.set(key, patch[key])
    }

    /**
     * Stand-in for the settings scope when no settings provider serves this
     * browser. It keeps the section working from the local mirror alone, so the
     * plugin degrades to browser-local preferences instead of failing to load.
     * @returns a scope-shaped object over the mirror.
     */
    function createMirrorScope() {
      const listeners = new Set()
      const notify = () => { for (const listener of listeners) listener() }
      return {
        getSnapshot: () => ({ status: 'ready', value: localSettings(), revision: 0, writable: false, mode: 'memory' }),
        subscribe: (listener) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        set: (field, value) => {
          writeMirror({ [field]: value })
          notify()
          return Promise.resolve(true)
        },
        unset: (field) => {
          writeMirror({ [field]: '' })
          notify()
          return Promise.resolve(true)
        },
      }
    }

    // ----------------------------------------------------------------- styles

    const CSS = [
      '.dshva{display:flex;flex-direction:column;gap:16px;padding:4px 0 24px;font-size:14px;line-height:22px}',
      '.dshva-title{font-size:16px;font-weight:500}',
      '.dshva-desc{opacity:.7}',
      '.dshva-group{border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));border-radius:10px;padding:14px 16px;display:flex;flex-direction:column;gap:12px}',
      '.dshva-group-head{display:flex;align-items:center;justify-content:space-between;gap:12px}',
      '.dshva-group-title{font-weight:500}',
      '.dshva-hint{opacity:.6;font-size:12px}',
      '.dshva-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.dshva-label{min-width:56px;opacity:.8}',
      '.dshva-control{font:inherit;color:inherit;background:transparent;border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));border-radius:6px;padding:4px 8px;cursor:pointer}',
      '.dshva-select{min-width:132px}',
      '.dshva-switch{display:flex;align-items:center;gap:10px;cursor:pointer}',
      '.dshva-switch input{width:16px;height:16px;cursor:pointer}',
      '.dshva-range{flex:1;min-width:120px;accent-color:var(--dsw-alias-brand-primary,#4d6bfe)}',
      '.dshva-value{opacity:.7;min-width:42px;text-align:right;font-variant-numeric:tabular-nums}',
      '.dshva-message{font-size:12px;opacity:.75}',
      '.dshva-text{flex:1;min-width:180px;max-width:320px}',
      '.dshva-file{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    ].join('')

    /** Inject this bundle's stylesheet once per page. */
    function installStyles() {
      const id = 'dsh-voice-alert/styles'
      if (typeof document === 'undefined') return
      if (document.querySelector(`style[data-plugin-css="${id}"]`) !== null) return
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-voice-alert'
      tag.dataset.pluginCss = id
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    // ------------------------------------------------------------ the section

    const h = React.createElement

    /** One labelled on/off row. */
    function SwitchRow(props) {
      return h('label', { className: 'dshva-switch' },
        h('input', {
          type: 'checkbox',
          checked: props.checked,
          'aria-label': props.label,
          onChange: (event) => { props.onChange(event.target.checked) },
        }),
        h('span', null, props.label))
    }

    /**
     * The Settings page: one master switch, the volume, and one block per sound.
     * @param props - composed slot props (store share, locale seat, injected face).
     * @returns the section element tree.
     */
    function VoiceAlertSection(props) {
      const t = props.t
      const update = props.update
      const values = props.useStore((state) => state.settings)
      const hostMissing = props.useStore((state) => state.hostMissing)
      const [message, setMessage] = React.useState('')
      const [permission, setPermission] = React.useState(
        typeof props.notificationPermission === 'function' ? props.notificationPermission() : 'unsupported',
      )

      /** Preview one event's current sound. */
      const preview = (kind) => {
        const file = kind === 'completion' ? values.completionFile : values.waitingFile
        const tone = kind === 'completion' ? values.completionTone : values.waitingTone
        const volume = volumeOf(values.volume)
        if (typeof file === 'string' && file !== '') playFile(file, volume, tone)
        else playTone(tone, volume)
      }

      /** Store a chosen audio file as a data URL in the settings document. */
      const chooseFile = (kind, event) => {        const input = event.target
        const file = input.files === null || input.files === undefined ? undefined : input.files[0]
        if (file === undefined) return
        if (file.size > MAX_FILE_BYTES) {
          setMessage(t('fileTooLarge'))
          input.value = ''
          return
        }
        const reader = new FileReader()
        reader.onload = () => {
          if (typeof reader.result !== 'string') {
            setMessage(t('fileReadError'))
            return
          }
          update({ [kind === 'completion' ? 'completionFile' : 'waitingFile']: reader.result })
          setMessage(t('fileApplied'))
        }
        reader.onerror = () => { setMessage(t('fileReadError')) }
        reader.readAsDataURL(file)
      }

      /** Copy for the current notification permission. */
      const permissionHint = () => {
        if (permission === 'granted') return t('notifyGranted')
        if (permission === 'denied') return t('notifyDenied')
        if (permission === 'unsupported') return t('notifyUnsupported')
        return t('notifyPrompt')
      }

      /** Copy for the last notification's receipt, or '' while there is nothing to report. */
      const deliveryHint = () => {
        if (delivery === 'shown') return t('notifyDelivered')
        if (delivery === 'failed') return t('notifyNoReceipt')
        if (delivery === 'blocked') return t('notifyDenied')
        if (delivery === 'unsupported') return t('notifyUnsupported')
        return ''
      }

      /** Ask the shell/browser for notification permission and show the outcome. */
      const requestPermission = async () => {
        if (typeof props.requestNotifications !== 'function') return permission
        const next = await props.requestNotifications()
        setPermission(next)
        return next
      }

      /** Raise a real notification so the user can see and place it. */
      const sendTest = async () => {
        await requestPermission()
        const sent = typeof props.testNotification === 'function' ? props.testNotification() : false
        if (!sent) {
          setMessage(permissionHint())
          return
        }
        setMessage(t('notifySent'))
        // The receipt is only knowable after the OS answers: without it a macOS
        // banner can be missing while the page believes it raised one.
        setTimeout(() => { setMessage(deliveryHint() || permissionHint()) }, DELIVERY_GRACE_MS + 300)
      }

      /** One text preference, written when the field loses focus. */
      const textField = (key, label) => h('label', { className: 'dshva-row', key },
        h('span', { className: 'dshva-label' }, label),
        h('input', {
          className: 'dshva-control dshva-text',
          type: 'text',
          defaultValue: values[key],
          placeholder: label,
          'aria-label': label,
          onBlur: (event) => { update({ [key]: event.target.value }) },
          onKeyDown: (event) => {
            if (event.key === 'Enter') event.target.blur()
          },
        }))

      /** The opt-in Windows/macOS notification block. */
      const notificationBlock = () => h('div', { className: 'dshva-group' },
        h('div', { className: 'dshva-group-head' },
          h('div', null,
            h('div', { className: 'dshva-group-title' }, t('notify')),
            h('div', { className: 'dshva-hint' }, t('notifyHint'))),
          h(SwitchRow, {
            label: t('notifyEnabled'),
            checked: values.notifyEnabled,
            onChange: (next) => {
              update({ notifyEnabled: next })
              if (next) void requestPermission()
            },
          })),
        h('div', { className: 'dshva-hint' }, permissionHint()),
        deliveryHint() === '' ? null : h('div', { className: 'dshva-hint' }, deliveryHint()),
        h(SwitchRow, {
          label: t('notifyCompletion'),
          checked: values.notifyCompletion,
          onChange: (next) => { update({ notifyCompletion: next }) },
        }),
        h(SwitchRow, {
          label: t('notifyWaiting'),
          checked: values.notifyWaiting,
          onChange: (next) => { update({ notifyWaiting: next }) },
        }),
        h(SwitchRow, {
          label: t('notifyBackgroundOnly'),
          checked: values.notifyBackgroundOnly,
          onChange: (next) => { update({ notifyBackgroundOnly: next }) },
        }),
        textField('notifyCompletionBody', t('notifyCompletionBody')),
        textField('notifyWaitingBody', t('notifyWaitingBody')),
        h('div', { className: 'dshva-row' },
          h('button', {
            type: 'button',
            className: 'dshva-control',
            onClick: () => { void sendTest() },
          }, t('notifyTest'))))

      /** One event block: switch, tone picker, preview, and custom audio. */
      const block = (kind, title, hint) => {
        const enabled = kind === 'completion' ? values.completionEnabled : values.waitingEnabled
        const tone = kind === 'completion' ? values.completionTone : values.waitingTone
        const file = kind === 'completion' ? values.completionFile : values.waitingFile
        const enabledKey = kind === 'completion' ? 'completionEnabled' : 'waitingEnabled'
        const toneKey = kind === 'completion' ? 'completionTone' : 'waitingTone'
        const fileKey = kind === 'completion' ? 'completionFile' : 'waitingFile'
        const hasFile = typeof file === 'string' && file !== ''
        return h('div', { className: 'dshva-group', key: kind },
          h('div', { className: 'dshva-group-head' },
            h('div', null,
              h('div', { className: 'dshva-group-title' }, title),
              h('div', { className: 'dshva-hint' }, hint)),
            h(SwitchRow, {
              label: t('enabled'),
              checked: enabled,
              onChange: (next) => { update({ [enabledKey]: next }) },
            })),
          h('div', { className: 'dshva-row' },
            h('span', { className: 'dshva-label' }, t('tone')),
            h('select', {
              className: 'dshva-control dshva-select',
              value: tone,
              'aria-label': t('tone'),
              onChange: (event) => {
                const next = event.target.value
                update({ [toneKey]: next })
                playTone(next, volumeOf(values.volume))
              },
            }, TONE_IDS.map((id) => h('option', { key: id, value: id }, t(`tone.${id}`)))),
            h('button', {
              type: 'button',
              className: 'dshva-control',
              onClick: () => { preview(kind) },
            }, t('play'))),
          h('div', { className: 'dshva-row' },
            h('span', { className: 'dshva-label' }, t('custom')),
            h('label', { className: 'dshva-control' },
              hasFile ? t('replace') : t('choose'),
              h('input', {
                type: 'file',
                accept: 'audio/*',
                style: { display: 'none' },
                'aria-label': t('custom'),
                onChange: (event) => { chooseFile(kind, event) },
              })),
            hasFile
              ? h('button', {
                type: 'button',
                className: 'dshva-control',
                onClick: () => {
                  update({ [fileKey]: '' })
                  setMessage('')
                },
              }, t('clear'))
              : null,
            hasFile
              ? h('span', { className: 'dshva-hint dshva-file' }, t('using', { kb: String(Math.round(file.length * 0.75 / 1024)) }))
              : null),
        )
      }

      return h('div', { className: 'dshva' },
        h('div', null,
          h('div', { className: 'dshva-title' }, t('title')),
          h('div', { className: 'dshva-desc' }, t('description'))),
        h(SwitchRow, {
          label: t('enabled'),
          checked: values.enabled,
          onChange: (next) => { update({ enabled: next }) },
        }),
        h('label', { className: 'dshva-row' },
          h('span', { className: 'dshva-label' }, t('volume')),
          h('input', {
            className: 'dshva-range',
            type: 'range',
            min: 0,
            max: 1,
            step: 0.05,
            value: values.volume,
            'aria-label': t('volume'),
            onChange: (event) => { update({ volume: Number(event.target.value) }) },
          }),
          h('span', { className: 'dshva-value' }, `${String(Math.round(values.volume * 100))}%`)),
        block('completion', t('completion'), t('completionHint')),
        block('waiting', t('waiting'), t('waitingHint')),
        notificationBlock(),
        hostMissing ? h('div', { className: 'dshva-hint' }, t('unavailable')) : null,
        message === '' ? null : h('div', { className: 'dshva-message' }, message))
    }

    // --------------------------------------------------------------- triggers

    /** Pending-interaction kinds the sidebar renders as a yellow status dot. */
    const VISIBLE_PENDING = new Set(['approval', 'plan-review', 'question'])

    /**
     * Status icon prefixed to every notification body, so the kind reads at a
     * glance: a finished turn, a turn that ended in an error, and a session that
     * needs the user. The title never carries one.
     */
    const ICON = Object.freeze({ completion: '🐳', error: '🌀', waiting: '❗' })

    /** Pending-interaction kind shown as a yellow dot, or undefined for the rest. */
    function visiblePendingKind(kind) {
      return typeof kind === 'string' && VISIBLE_PENDING.has(kind) ? kind : undefined
    }

    // ------------------------------------------------------------------ apply

    /**
     * Hard client services. The settings scope and the session-status source are
     * read through `ctx.get` instead: a plugin that never receives an optional
     * service stays ACTIVE with a degraded feature, while a declared dependency
     * on a service this composition lacks would hold the whole section back.
     */
    const inject = ['slots', 'locale']

    /**
     * Install the sounds, the Settings section, and the settings scope read.
     * @param ctx - client Cordis context.
     */
    function apply(ctx) {
      installStyles()

      // The settings binder seat: the current client serves it as `webUiSettings`
      // and keeps `settingsScope` only as a deprecated property on the binder
      // itself, so the older name alone finds nothing there and the whole section
      // silently falls back to the browser-local mirror. Probe both names, the
      // current one first, and degrade to the mirror only when neither exists.
      const binder = ctx.get('webUiSettings') ?? ctx.get('settingsScope')
      const mirrored = binder === undefined || typeof binder.bind !== 'function'
      const form = mirrored ? createMirrorScope() : binder.bind({ namespace: NAMESPACE })
      const store = defineStore({
        init: () => ({ settings: { ...DEFAULTS }, revision: -1, hostMissing: mirrored }),
        actions: {
          sync: (draft, settings, revision, hostMissing) => {
            draft.settings = settings
            draft.revision = revision
            draft.hostMissing = hostMissing
          },
        },
      })
      let bound
      let revision = 0
      const publish = () => {
        revision += 1
        const status = form.getSnapshot().status
        bound?.sync(readSettings(form), revision, mirrored || (status !== 'loading' && status !== 'ready'))
      }

      ctx.effect(() => form.subscribe(publish), 'voice-alert: settings sync')

      const t = ctx.locale.bind(LOCALE_NS)
      const sessions = ctx.get('sessions')

      /** @returns the catalog row of one session, or undefined while this browser has none. */
      const sessionRow = (sessionId) => {
        if (sessions === undefined || sessionId === undefined) return undefined
        return sessions.list.getSnapshot().byId[sessionId]
      }

      /** @returns the status-dot facts of one session, or undefined when none are published. */
      const sessionStatus = (sessionId) => {
        if (uiSession === undefined || uiSession.sessionStatus === undefined) return undefined
        return uiSession.sessionStatus.getSnapshot().get(sessionId)
      }

      /**
       * Whether one session can own a sidebar status dot, copying the sidebar's
       * own visibility rule (`sessionVisible`, tree.ts): a row must exist and be
       * an ordinary top-level session. A row this browser has not loaded — a
       * teammate catalog that arrived elsewhere — is unknown, so it stays
       * ineligible instead of alerting: the previous `!== undefined &&` test
       * admitted exactly the sessions it could not see.
       * @param sessionId - session to test.
       * @returns true only for a known top-level, unarchived, non-blank row.
       */
      const eligible = (sessionId) => {
        const row = sessionRow(sessionId)
        if (row === undefined) return false
        if (row.origin === 'subagent' || row.parentId !== undefined) return false
        if (row.blank === true) return false
        const workspaces = ctx.get('workspaces')
        const archived = workspaces === undefined || typeof workspaces.list?.getSnapshot !== 'function'
          ? undefined
          : workspaces.list.getSnapshot().archivedSessionIds
        return !(archived instanceof Set && archived.has(sessionId))
      }

      /**
       * How many direct children of one session are running, copied from the
       * sidebar's `runningChildCount` (tree.ts:390-395): the catalog names the
       * children and each one's running flag falls back from the status map to
       * its own row.
       * @param sessionId - parent session to count for.
       * @returns the number of running direct children.
       */
      const runningChildCount = (sessionId) => {
        if (sessions === undefined) return 0
        const catalog = sessions.list.getSnapshot().projectionsBySession?.[sessionId]?.values?.subagentCatalog
        if (catalog === undefined) return 0
        return catalog.reduce((count, child) => {
          const running = sessionStatus(child.id)?.running ?? sessionRow(child.id)?.running
          return count + (running === true ? 1 : 0)
        }, 0)
      }

      /**
       * The durable event window this browser holds for one session. Leaving a
       * session retires its binding, so a session running in the background has
       * no window here at all.
       * @param sessionId - session to inspect.
       * @returns the window entries, or undefined when the session is not materialized here.
       */
      const sessionEntries = (sessionId) => {
        if (sessions === undefined || typeof sessions.binding !== 'function' || sessionId === undefined) return undefined
        const binding = sessions.binding(sessionId)
        const source = binding === undefined ? undefined : binding.eventSource
        return source === undefined ? undefined : source.getSnapshot().entries
      }

      /** Newest-turn scan per session, reused while that session's window snapshot is unchanged. */
      const turnScans = new Map()

      /**
       * The newest turn in one session's durable log, when this browser holds
       * that log. The scan result is reused while the window snapshot is
       * unchanged: an evaluation point only has to look at sessions that are
       * eligible and stopped, but agent-team traffic publishes those points
       * constantly and a long log is expensive to rescan.
       * @param sessionId - session to inspect.
       * @returns the newest turn's number, seq and end reason, or null when the
       * log is unreadable here or holds no turn yet.
       */
      const latestTurn = (sessionId) => {
        const entries = sessionEntries(sessionId)
        if (entries === undefined) {
          turnScans.delete(sessionId)
          return null
        }
        const cached = turnScans.get(sessionId)
        if (cached !== undefined && cached.entries === entries) return cached.turn
        let turn = null
        for (const entry of entries) {
          if (entry.type !== 'event') continue
          // The wire entry carries no sequence of its own; the event does. Which
          // turn is newest still has to be answerable from a log without turn
          // numbers, because the episode is what keeps one turn to one alert.
          const seq = entry.event.seq ?? entry.seq
          if (entry.event.type === 'turn/start') {
            turn = { seq, number: entry.event.data.turn, reason: null }
          } else if (entry.event.type === 'turn/end') {
            turn = { seq, number: entry.event.data.turn, reason: entry.event.data.reason }
          }
        }
        turnScans.set(sessionId, { entries, turn })
        return turn
      }

      /**
       * Read how the newest turn of one session ended.
       * @param sessionId - session to inspect.
       * @returns `closed` with the turn's end reason, `open` while a newer turn is
       * still running, or `unknown` without a readable event window.
       */
      const turnState = (sessionId) => {
        const turn = latestTurn(sessionId)
        if (turn === null) return { state: 'unknown' }
        return turn.reason === null ? { state: 'open' } : { state: 'closed', reason: turn.reason }
      }

      /**
       * The identity of the turn episode whose end a completion alert would
       * report. Both `turn/start` and `turn/end` name their turn; the window
       * position is the fallback for a log without one.
       * @param sessionId - session to inspect.
       * @returns the episode id, or null without a readable turn.
       */
      const turnEpisode = (sessionId) => {
        const turn = latestTurn(sessionId)
        if (turn === null) return null
        return typeof turn.number === 'number' ? `turn:${String(turn.number)}` : `seq:${String(turn.seq)}`
      }

      /**
       * Text of the newest prompt the user themselves sent in one session. The
       * newest `user/message` is not always theirs: injected context (workspace
       * instructions, skill catalogs, teammate framing) arrives as user-role
       * messages too, so only `source.kind === 'user'` counts.
       * @param sessionId - session to inspect.
       * @returns one normalized line, bounded for a notification body, or ''.
       */
      const latestPrompt = (sessionId) => {
        const entries = sessionEntries(sessionId)
        if (entries === undefined) return ''
        let text = ''
        for (const entry of entries) {
          if (entry.type !== 'event' || entry.event.type !== 'user/message') continue
          const data = entry.event.data
          if (data.source === undefined || data.source.kind !== 'user') continue
          const parts = []
          for (const block of data.content) {
            if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
          }
          const line = parts.join(' ').replace(/\s+/g, ' ').trim()
          if (line !== '') text = line
        }
        return text.length > PROMPT_LIMIT ? `${text.slice(0, PROMPT_LIMIT - 1)}…` : text
      }

      /** Turn outcomes that mean the user (or the harness) cancelled it, so no alert is due. */
      const CANCELLED = new Set(['aborted', 'interrupted', 'forked'])

      /** @returns the message of a failed turn's reason, or '' for any other outcome. */
      const errorMessage = (reason) => {
        if (reason === null || reason === undefined || reason.kind !== 'error') return ''
        if (typeof reason.error !== 'object' || reason.error === null) return ''
        return typeof reason.error.message === 'string' ? reason.error.message : ''
      }

      /**
       * Whether one session's sidebar row shows the green completion dot: an
       * eligible top-level row with no pending interaction, not running itself,
       * and no running direct child. The first three arms copy the sidebar's
       * `sessionStatuses` precedence (Rows.tsx:389-396); the last is the turn
       * fact behind the dot.
       *
       * Only a status signal starts a completion: `completionUnread` when
       * another view observed the stop, or this browser's own
       * running-true→false observation when the session is the one on screen
       * (which is where `isMain` suppresses `completionUnread`). The durable
       * event window never starts one: opening a session for the first time
       * materializes its log, and a log whose last turn ended before this page
       * existed is not a completion.
       *
       * The two signals are then held to different standards, because only one
       * of them already means "finished". `completionUnread` is the sidebar's own
       * green dot, so it carries an alert by itself; a window this browser has
       * retired (a session the user left — from the sidebar's point of view an
       * unread completion) only refines it, and a cancelled turn still silences
       * it. This browser's own idle edge is not that dot: it is a stop as easily
       * as a finish, so it has to be proven — an open turn is not a finished one,
       * a cancelled turn stays silent, and a window the plugin cannot read (the
       * user stopped the session and its view retired the window before any
       * evaluation could read the end) proves nothing and alerts nothing.
       * @param sessionId - session to test.
       * @returns true while the row shows the green dot.
       */
      const completed = (sessionId) => {
        const row = sessionRow(sessionId)
        if (!eligible(sessionId)) return false
        if (visiblePendingKind(sessionStatus(sessionId)?.pendingInteraction?.kind) !== undefined) return false
        if ((sessionStatus(sessionId)?.running ?? row.running) === true) return false
        if (runningChildCount(sessionId) > 0) return false
        const unread = sessionStatus(sessionId)?.completionUnread === true
        if (!unread && !stopped.has(sessionId)) return false
        const turn = turnState(sessionId)
        if (turn.state === 'open') return false
        if (turn.state === 'closed' && CANCELLED.has(turn.reason.kind)) return false
        // The sidebar's unread mark is the one signal that may stand in for a
        // turn this browser cannot read; an idle edge it observed on its own may
        // not, or stopping a session would be reported as finishing it.
        if (turn.state === 'unknown') return unread
        return true
      }

      /** Pending completion alerts, keyed by session, so a resumed turn cancels its own. */
      const pending = new Map()

      /** Drop the scheduled completion alert of one session. */
      const cancelPending = (sessionId) => {
        const timer = pending.get(sessionId)
        if (timer === undefined) return
        clearTimeout(timer)
        pending.delete(sessionId)
      }

      ctx.effect(() => () => {
        for (const timer of pending.values()) clearTimeout(timer)
        pending.clear()
      }, 'voice-alert: pending completion timers')

      /**
       * Play one event's alert and raise its system notification, each from its
       * own switch. There are exactly two alerts; a failed turn is one of them,
       * so it carries the session title too and only its body source differs.
       * The body opens with the event's {@link ICON}; the title is the session
       * name alone.
       * @param kind - which alert: a finished turn, or a reply that is needed.
       * @param sessionId - session that produced it.
       * @param reason - the finished turn's end reason, when the window was readable.
       */
      const fire = (kind, sessionId, reason) => {
        const values = readSettings(form)
        const isReply = kind === 'waiting'
        const soundKey = isReply ? 'waitingEnabled' : 'completionEnabled'
        const fileKey = isReply ? 'waitingFile' : 'completionFile'
        const toneKey = isReply ? 'waitingTone' : 'completionTone'
        let soundPlayed = false
        if (values.enabled && values[soundKey]) {
          soundPlayed = true
          if (values[fileKey] !== '') playFile(values[fileKey], values.volume, values[toneKey])
          else playTone(values[toneKey], values.volume)
        }
        if (!values.notifyEnabled) return
        if (!values[isReply ? 'notifyWaiting' : 'notifyCompletion']) return
        if (values.notifyBackgroundOnly && !windowIsBehind()) return
        // A browser that has never been asked keeps permission at `default`; ask
        // now, so the next alert is not the first place the user hears about it.
        if (notificationPermission() === 'default') void requestNotificationPermission()
        const override = values[isReply ? 'notifyWaitingBody' : 'notifyCompletionBody']
        const prompt = latestPrompt(sessionId)
        const failure = errorMessage(reason)
        // The icon names the event, not the body source: a failed turn stays a
        // failed turn even when its reason carries no message to show.
        const failed = reason !== null && reason !== undefined && reason.kind === 'error'
        const icon = isReply ? ICON.waiting : failed ? ICON.error : ICON.completion
        const body = override !== ''
          ? override
          : failure !== ''
            ? failure
            : prompt !== '' ? prompt : t(isReply ? 'notify.waitingBody' : 'notify.completionBody')
        notify(sessionRow(sessionId)?.displayTitle ?? sessionId, `${icon} ${body}`, soundPlayed)
      }

      /**
       * Alert a finished turn once it is clear that the work stopped. A turn that
       * resumes inside the delay (a goal round, an auto-continuation) cancels its
       * own alert; a cancelled or orphaned turn is silent outright.
       * @param sessionId - session whose turn stopped.
       * @param immediate - report now when the debounce is off, instead of on a
       * timer; the winner of one evaluation point passes true so a burst of
       * completions still reports its first one at that moment.
       */
      const scheduleCompletion = (sessionId, immediate) => {
        cancelPending(sessionId)
        const decide = () => {
          pending.delete(sessionId)
          if (!completed(sessionId)) return
          const episode = turnEpisode(sessionId)
          const edge = stopEdges.get(sessionId) ?? 0
          const announced = announcedCompletion.get(sessionId)
          // One finished turn alerts once. Its turn episode names it whenever this
          // browser can read the log, and the stop edge that produced the alert
          // carries the credit when it cannot — so a window that only appears
          // afterwards (the user opens an already-notified session) does not report
          // the same stop again. Neither key moves when the running flag merely
          // blips: a status push and a lagging list row can disagree around one
          // stop, and re-arming the alert for it is what doubled a notification.
          if (announced !== undefined
            && ((episode !== null && announced.episode === episode) || announced.edge === edge)) return
          const turn = turnState(sessionId)
          const reason = turn.state === 'closed' ? turn.reason : null
          announcedCompletion.set(sessionId, { episode, edge })
          fire('completion', sessionId, reason)
        }
        const delay = Number(readSettings(form).completionDelayMs)
        const wait = Number.isFinite(delay) && delay > 0 ? delay : 0
        if (wait === 0 && immediate === true) {
          decide()
          return
        }
        pending.set(sessionId, setTimeout(decide, wait))
      }

      /** Session ids that showed a green row when this plugin first looked at them. */
      const seenCompleted = new Set()
      /**
       * Completion keys already announced per session, so one finished turn alerts
       * once: its turn episode when the log was readable, and the stop edge below.
       * The record is not cleared when the session runs again — a new turn carries a
       * new episode, and a new run a new edge — because clearing it on the running
       * edge alone is what let a blip re-report the turn it had just reported.
       */
      const announcedCompletion = new Map()
      /** Next stop-edge id: one running-true→false transition this browser watched. */
      let nextStopEdge = 0
      /** Stop edge per session; 0 while this browser has never watched it stop. */
      const stopEdges = new Map()
      /** Sessions this browser has watched running, so a later stop is a transition it saw. */
      const seenRunning = new Set()
      /** Sessions observed running and then not running, when no window proves the turn ended. */
      const stopped = new Set()
      /** Accepted pending-interaction key last seen per session; null while none is shown. */
      const seenPending = new Map()
      /** Pending-interaction key whose alert was raised per session, so one key alerts once. */
      const firedPending = new Map()
      /** Sessions already waiting when this plugin first looked at them: baseline, no alert. */
      const baselinePending = new Set()
      let initialized = false

      /** Materialized event windows this plugin is watching for turn boundaries. */
      const windowSources = new Map()

      /**
       * Keep one event-source subscription per session whose window this browser
       * holds. The list publishes a row before its window exists and retires the
       * binding when the session leaves, so the set is rebuilt on every
       * evaluation point; a window that lands after the row still gets watched.
       */
      const syncWindowSubscriptions = () => {
        if (sessions === undefined || typeof sessions.binding !== 'function') return
        const present = new Set()
        for (const sessionId of Object.keys(sessions.list.getSnapshot().byId)) {
          const binding = sessions.binding(sessionId)
          const source = binding === undefined ? undefined : binding.eventSource
          if (source === undefined || typeof source.subscribe !== 'function') continue
          present.add(sessionId)
          if (windowSources.has(sessionId)) continue
          const unsubscribe = source.subscribe(() => { evaluate() })
          windowSources.set(sessionId, { source, unsubscribe })
        }
        for (const [sessionId, entry] of windowSources) {
          if (present.has(sessionId)) continue
          entry.unsubscribe()
          windowSources.delete(sessionId)
        }
      }

      /**
       * Re-derive both triggers over the current snapshots and raise at most one
       * alert. Reaching the state again through any evaluation point is what
       * makes a completion debounce fire, so nothing is lost when several
       * sessions move together.
       */
      const evaluate = () => {
        const sessionsService = sessions
        const statusService = uiSession
        if (sessionsService === undefined || statusService === undefined || statusService.sessionStatus === undefined) return
        syncWindowSubscriptions()
        const statuses = statusService.sessionStatus.getSnapshot()
        const list = sessionsService.list.getSnapshot()
        const rows = list.byId
        // The list RPC is still in flight: nothing here is a real edge yet, and
        // a row that lands later must not be read as "this session just stopped".
        const baselineOnly = !initialized || list.phase === 'pending'
        const ids = new Set([...Object.keys(rows), ...statuses.keys()])
        const waiting = []
        const completions = []
        for (const sessionId of ids) {
          const status = statuses.get(sessionId)
          const running = status?.running ?? rows[sessionId]?.running
          if (running === true) {
            seenRunning.add(sessionId)
            stopped.delete(sessionId)
          } else if (running === false) {
            // Only a session this browser watched running can have stopped here:
            // a row that is merely not running (finished before the page opened)
            // is idle in the sidebar, not a completion.
            if (seenRunning.has(sessionId)) {
              // Each stop edge gets its own id, so a completion alert that could
              // not name its turn is still charged to the stop that produced it.
              if (!stopped.has(sessionId)) stopEdges.set(sessionId, nextStopEdge += 1)
              stopped.add(sessionId)
            }
          } else {
            stopped.delete(sessionId)
          }
          if (status === undefined) continue
          const key = visiblePendingKind(status.pendingInteraction?.kind) === undefined
            ? null
            : status.pendingInteraction.key
          const was = seenPending.get(sessionId) ?? null
          seenPending.set(sessionId, key)
          // A pending interaction already on screen when the plugin loaded is
          // baseline; once it clears, the next one is a real edge again.
          if (key === null) baselinePending.delete(sessionId)
          if (baselineOnly) {
            if (key !== null) baselinePending.add(sessionId)
            if (completed(sessionId)) seenCompleted.add(sessionId)
            continue
          }
          if (key !== null && key !== was && !baselinePending.has(sessionId) && eligible(sessionId)) {
            waiting.push(sessionId)
          }
          if (completed(sessionId)) {
            if (!seenCompleted.has(sessionId)) completions.push(sessionId)
          } else {
            seenCompleted.delete(sessionId)
          }
        }
        initialized = true
        if (waiting.length === 0 && completions.length === 0) return
        const newestFirst = (left, right) => (rows[right]?.updatedAt ?? 0) - (rows[left]?.updatedAt ?? 0)
          || (left < right ? -1 : 1)
        waiting.sort(newestFirst)
        completions.sort(newestFirst)
        // Every completion edge candidate gets its own debounce: the first one
        // reports now, the rest re-evaluate when their timer expires, so a
        // session that loses this evaluation point is deferred, never dropped.
        for (const sessionId of completions) seenCompleted.add(sessionId)
        if (waiting.length > 0) {
          const sessionId = waiting[0]
          const key = seenPending.get(sessionId)
          if (firedPending.get(sessionId) !== key) {
            cancelPending(sessionId)
            firedPending.set(sessionId, key)
            fire('waiting', sessionId, null)
          }
          for (const candidate of completions) scheduleCompletion(candidate, false)
          return
        }
        scheduleCompletion(completions[0], true)
        for (const candidate of completions.slice(1)) scheduleCompletion(candidate, false)
      }

      ctx.effect(() => () => {
        for (const entry of windowSources.values()) entry.unsubscribe()
        windowSources.clear()
      }, 'voice-alert: event-window subscriptions')

      const uiSession = ctx.get('uiSession')
      if (uiSession !== undefined && uiSession.sessionStatus !== undefined) {
        ctx.effect(() => {
          const status = uiSession.sessionStatus
          const unsubscribeStatus = status.subscribe(() => { evaluate() })
          return () => { unsubscribeStatus() }
        }, 'voice-alert: session status alerts')
      }

      if (sessions !== undefined && sessions.list !== undefined) {
        ctx.effect(() => {
          const unsubscribeList = sessions.list.subscribe(() => { evaluate() })
          return () => { unsubscribeList() }
        }, 'voice-alert: session list alerts')
      }

      // Browsers hold audio until the page has seen a gesture; the first one also
      // unlocks a context created before that gesture.
      ctx.effect(() => {
        const unlock = () => { audioContext() }
        document.addEventListener('pointerdown', unlock, { capture: true, once: true })
        document.addEventListener('keydown', unlock, { capture: true, once: true })
        return () => {
          document.removeEventListener('pointerdown', unlock, { capture: true })
          document.removeEventListener('keydown', unlock, { capture: true })
        }
      }, 'voice-alert: audio unlock')

      ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), 'voice-alert: dictionaries')

      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: SECTION_ID,
        order: 60,
        label: () => t('nav'),
        locale: LOCALE_NS,
        store,
        inject: (actions) => {
          bound = actions
          publish()
          return {
            update: (patch) => { writeSettings(form, patch) },
            requestNotifications: () => requestNotificationPermission(),
            /**
             * Raise the probe notification and, when the completion sound is on,
             * play it too: the button is the page's end-to-end self-check, so a
             * silent result has to mean a real permission or audio problem
             * rather than "this probe never made a sound by design".
             * @returns whether a notification was created.
             */
            testNotification: () => {
              const values = readSettings(form)
              let soundPlayed = false
              if (values.enabled && values.completionEnabled) {
                soundPlayed = true
                if (values.completionFile !== '') playFile(values.completionFile, values.volume, values.completionTone)
                else playTone(values.completionTone, values.volume)
              }
              return notify(
                t('notify.completionTitle'),
                t('notify.completionBody'),
                soundPlayed,
              )
            },
            notificationPermission,
            notificationDelivery: () => delivery,
          }
        },
      }, VoiceAlertSection))
    }

    return { apply, inject, name: 'voice-alert' }
  },
})
