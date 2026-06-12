/**
 * T188: end-to-end multiplayer test — spawns a vite dev server + TWO real
 * Chrome instances (puppeteer/CDP), drives host + joiner through the full
 * flow: menu → track setup → host lobby → share link → join → song transfer
 * → handshake → BOTH ships racing (HUD clock advancing).
 *
 *   node scripts/e2e-mp.mjs            # full flow
 *   node scripts/e2e-mp.mjs --freeze   # also freeze the host tab 15s before
 *                                      # the join (app-switch emulation, B40)
 *
 * Headful on purpose: WebGPU + unthrottled rAF need visible windows.
 */
import puppeteer from 'puppeteer'
import { execSync, spawn } from 'node:child_process'

const PORT = 4997
const BASE = `http://localhost:${PORT}/`
const FREEZE = process.argv.includes('--freeze')

const log = (tag, msg) => console.log(`[${tag}] ${msg}`)
const fail = (msg) => {
  console.error(`\nFAIL: ${msg}`)
  process.exitCode = 1
}

/** wait until fn() is truthy in the page, polling — survives rAF-driven DOM */
async function waitFor(page, tag, desc, fn, timeoutMs = 60_000) {
  const t0 = Date.now()
  for (;;) {
    const v = await page.evaluate(fn).catch(() => null)
    if (v) {
      log(tag, `✓ ${desc}`)
      return v
    }
    if (Date.now() - t0 > timeoutMs) {
      await page.screenshot({ path: `/tmp/e2e-mp-${tag}-timeout.png` }).catch(() => {})
      throw new Error(`${tag}: timeout waiting for ${desc} (screenshot: /tmp/e2e-mp-${tag}-timeout.png)`)
    }
    await new Promise((r) => setTimeout(r, 400))
  }
}

async function clickByText(page, tag, text) {
  const ok = await page.evaluate((t) => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.includes(t))
    if (!b) return false
    b.click()
    return true
  }, text)
  if (!ok) throw new Error(`${tag}: button "${text}" not found`)
  log(tag, `clicked "${text}"`)
}

async function launchBrowser(x) {
  return puppeteer.launch({
    headless: false,
    args: [
      '--enable-unsafe-webgpu',
      // automation profiles can't resolve each other's mDNS .local ICE
      // candidates → data channel never opens. Expose real local IPs.
      '--disable-features=WebRtcHideLocalIpsWithMdns',
      `--window-position=${x},0`,
      '--window-size=920,640',
      '--autoplay-policy=no-user-gesture-required',
    ],
    defaultViewport: { width: 900, height: 560 },
  })
}

async function preparePage(browser) {
  const page = await browser.newPage()
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('wave-rider-flash-ack', '1')
  })
  page.on('pageerror', (e) => log('page', `JS error: ${e.message}`))
  page.on('console', (m) => {
    const t = m.text()
    if (/peer|webrtc|ice|connection|error/i.test(t)) log('console', t.slice(0, 200))
  })
  return page
}

// ---- server ------------------------------------------------------------
// freeze variant runs the PROD build via vite preview: the dev HMR client
// reloads the page when its websocket dies in a frozen tab — that reload
// (not PeerJS) is what the test would measure otherwise
if (FREEZE) {
  log('srv', 'building for preview (freeze test needs no-HMR prod page)…')
  execSync('npx vite build', { stdio: 'ignore' })
}
log('srv', `starting vite ${FREEZE ? 'preview' : 'dev'} on :${PORT}`)
const vite = spawn(
  'npx',
  FREEZE
    ? ['vite', 'preview', '--port', String(PORT), '--strictPort']
    : ['vite', '--port', String(PORT), '--strictPort'],
  { stdio: ['ignore', 'pipe', 'pipe'] },
)
const killServer = () => {
  try {
    vite.kill('SIGTERM')
  } catch {
    /* already dead */
  }
}
process.on('exit', killServer)
process.on('SIGINT', () => process.exit(130))

await new Promise((resolve, reject) => {
  const to = setTimeout(() => reject(new Error('vite never became ready')), 30_000)
  vite.stdout.on('data', (d) => {
    if (String(d).includes('Local:')) {
      clearTimeout(to)
      resolve()
    }
  })
  vite.on('exit', (c) => reject(new Error(`vite exited early (${c})`)))
})
log('srv', 'vite ready')

let hostBrowser, joinBrowser
let probe = null
const probePage = (page, tag) => async () => {
  const j = await page
    .evaluate(() => {
      const n = window.__net
      if (!n) return 'no __net'
      const pc = n.conn?.peerConnection
      const t = window.__telemetry
      return JSON.stringify({
        state: n.state,
        connOpen: n.conn?.open,
        ice: pc?.iceConnectionState,
        sync: t?.syncState,
        countdown: t?.countdown?.toFixed?.(1),
        timeMs: Math.round(t?.timeMs ?? -1),
        waitingText: (document.body.textContent ?? '').includes('WAITING FOR OPPONENT'),
      })
    })
    .catch(() => 'page gone')
  log('probe', `${tag} ${j}`)
}
try {
  // ---- host ----------------------------------------------------------------
  hostBrowser = await launchBrowser(0)
  const host = await preparePage(hostBrowser)
  await host.goto(BASE, { waitUntil: 'domcontentloaded' })

  // WebGPU gate — if this chrome can't do WebGPU the whole app is walled off
  await waitFor(host, 'host', 'menu (WebGPU ok)', () => document.body.textContent?.includes('SELECT FREQUENCY'), 30_000).catch(
    async (e) => {
      const unsupported = await host.evaluate(() => document.body.textContent?.includes('unsupported') || document.body.textContent?.includes('WebGPU'))
      throw unsupported ? new Error('this Chrome has no WebGPU — cannot e2e the app') : e
    },
  )

  await clickByText(host, 'host', 'NITS')
  await waitFor(host, 'host', 'track setup', () => document.body.textContent?.includes('TRACK SETUP'), 90_000)
  await clickByText(host, 'host', 'HOST MULTIPLAYER')
  const joinUrl = await waitFor(
    host,
    'host',
    'share link from broker',
    () => {
      const i = document.querySelector('input[readonly]')
      const v = i && 'value' in i ? i.value : ''
      return v.includes('?join=') ? v : null
    },
    30_000,
  )
  log('host', `join url: ${joinUrl}`)

  // ---- app-switch emulation (B40): the REALISTIC order — host backgrounds
  // to share the link, and the friend opens it WHILE the host is still away.
  // The joiner must survive that (retry, V30) until the host returns and the
  // peer reconnects.
  let hostCdp = null
  if (FREEZE) {
    log('host', 'FREEZING host tab (app-switched to share the link)…')
    hostCdp = await host.createCDPSession()
    await hostCdp.send('Page.setWebLifecycleState', { state: 'frozen' })
  }

  // ---- joiner ----------------------------------------------------------------
  joinBrowser = await launchBrowser(930)
  const joiner = await preparePage(joinBrowser)
  await joiner.goto(joinUrl, { waitUntil: 'domcontentloaded' })

  if (FREEZE) {
    // friend already opened the link; host comes back 12s later
    await new Promise((r) => setTimeout(r, 12_000))
    const during = await joiner.evaluate(() => (document.body.textContent ?? '').slice(0, 300))
    log('join', `while host frozen: ${during.replace(/\s+/g, ' ').slice(0, 140)}`)
    await hostCdp.send('Page.setWebLifecycleState', { state: 'active' })
    log('host', 'host returned to foreground — reconnect should pick the join up')
  }

  // probe both peers while waiting (dev-only window.__net)
  const pj = probePage(joiner, 'joiner')
  const ph = probePage(host, 'host  ')
  probe = setInterval(() => {
    void pj()
    void ph()
  }, 5_000)

  // stale-link failure surfaces in the lobby (T87) — catch it explicitly
  const joined = await waitFor(
    joiner,
    'join',
    'connected to host (or race underway)',
    () => {
      const t = document.body.textContent ?? ''
      if (t.includes('HOST NOT FOUND')) return 'STALE'
      if (t.includes('CONNECTED TO HOST') || t.includes('ANALYZING') || t.includes('BUILDING TRACK') || t.includes('TIME')) return 'OK'
      return null
    },
    90_000,
  )
  if (joined === 'STALE') throw new Error('join link was STALE (B40 repro — reconnect did not hold the id)')

  // ---- both reach the race scene --------------------------------------------
  await waitFor(host, 'host', 'race scene', () => document.body.textContent?.includes('MUTE'), 60_000)
  await waitFor(joiner, 'join', 'race scene (auto-join, T186)', () => document.body.textContent?.includes('MUTE'), 120_000)

  // ---- handshake fires: countdown runs and the HUD clock advances on BOTH ----
  const clock = () => {
    const m = (document.body.textContent ?? '').match(/\d:\d\d\.\d\d/)
    return m ? m[0] : null
  }
  const h1 = await waitFor(host, 'host', 'HUD clock visible', clock, 60_000)
  const j1 = await waitFor(joiner, 'join', 'HUD clock visible', clock, 60_000)
  // launch = T88 arbitration (~1.5s) + countdown (3.8s) AFTER the clock first
  // renders — poll for movement instead of a fixed delta
  const h2 = await waitFor(host, 'host', `clock advancing past ${h1}`, clock).then(() =>
    waitFor(host, 'host', 'sim time > 0', () => {
      const m = (document.body.textContent ?? '').match(/\d:\d\d\.\d\d/)
      return m && m[0] !== '0:00.00' ? m[0] : null
    }, 30_000),
  )
  const j2 = await waitFor(joiner, 'join', 'sim time > 0', () => {
    const m = (document.body.textContent ?? '').match(/\d:\d\d\.\d\d/)
    return m && m[0] !== '0:00.00' ? m[0] : null
  }, 30_000)
  log('both', `✓ clocks advancing (host ${h1}→${h2}, joiner ${j1}→${j2})`)

  // ---- V30: launch skew — sample both race clocks back-to-back ---------------
  const toMs = (s) => {
    const m = s.match(/(\d):(\d\d)\.(\d\d)/)
    return m ? (+m[1] * 60 + +m[2]) * 1000 + +m[3] * 10 : NaN
  }
  const [hc, jc] = await Promise.all([host.evaluate(clock), joiner.evaluate(clock)])
  const skew = Math.abs(toMs(hc) - toMs(jc))
  log('both', `launch skew ${skew}ms (host ${hc} vs joiner ${jc})`)
  if (skew > 350) throw new Error(`countdowns desynced by ${skew}ms — V30 rtt compensation not working`)

  // ---- MP rank wired: POS shows /2 on both -----------------------------------
  await waitFor(host, 'host', 'POS …/2 (opponent ranked)', () => /\/2/.test(document.body.textContent ?? ''), 15_000)
  await waitFor(joiner, 'join', 'POS …/2 (opponent ranked)', () => /\/2/.test(document.body.textContent ?? ''), 15_000)

  console.log(`\nPASS: full multiplayer flow works${FREEZE ? ' (incl. 15s host freeze before join)' : ''}`)
} catch (e) {
  fail(e instanceof Error ? e.message : String(e))
} finally {
  if (probe) clearInterval(probe)
  await hostBrowser?.close().catch(() => {})
  await joinBrowser?.close().catch(() => {})
  killServer()
  process.exit(process.exitCode ?? 0)
}
