/**
 * Input (T6, C4): keyboard + touch produce the same ShipInput. Touch zones
 * write into the same shared state the keyboard does — physics reads one
 * source and cannot tell devices apart.
 */
import type { ShipInput } from '../lib/physics/ship'

interface RawInput {
  left: boolean
  right: boolean
  thrust: boolean
  brakeLeft: boolean
  brakeRight: boolean
  /** T156: retro brake (S/↓) */
  retro: boolean
  /** analog steer from touch, overrides digital when non-null */
  touchSteer: number | null
  touchThrust: boolean
  /** T156: thrust dragged DOWN on touch */
  touchRetro: boolean
}

const raw: RawInput = {
  left: false,
  right: false,
  thrust: false,
  brakeLeft: false,
  brakeRight: false,
  retro: false,
  touchSteer: null,
  touchThrust: false,
  touchRetro: false,
}

type GameKeyEvent = 'camera' | 'pause' | 'mute'
const listeners = new Set<(e: GameKeyEvent) => void>()

export function onGameKey(fn: (e: GameKeyEvent) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function setKey(code: string, down: boolean): boolean {
  switch (code) {
    case 'ArrowLeft':
    case 'KeyA':
      raw.left = down
      return true
    case 'ArrowRight':
    case 'KeyD':
      raw.right = down
      return true
    case 'ArrowUp':
    case 'KeyW':
      raw.thrust = down
      return true
    case 'ArrowDown':
    case 'KeyS':
      raw.retro = down
      return true
    case 'KeyQ':
    case 'ShiftLeft':
      raw.brakeLeft = down
      return true
    case 'KeyE':
    case 'ShiftRight':
    case 'Space':
      raw.brakeRight = down
      return true
    default:
      return false
  }
}

export function attachKeyboard(): () => void {
  const down = (e: KeyboardEvent) => {
    if (e.repeat) return
    if (setKey(e.code, true)) e.preventDefault()
    if (e.code === 'KeyC') listeners.forEach((l) => l('camera'))
    if (e.code === 'Escape') listeners.forEach((l) => l('pause'))
    if (e.code === 'KeyM') listeners.forEach((l) => l('mute'))
  }
  const up = (e: KeyboardEvent) => {
    if (setKey(e.code, false)) e.preventDefault()
  }
  window.addEventListener('keydown', down)
  window.addEventListener('keyup', up)
  return () => {
    window.removeEventListener('keydown', down)
    window.removeEventListener('keyup', up)
  }
}

/** Touch zone writers — called by the TouchControls component. */
export const touch = {
  setSteer(v: number | null) {
    raw.touchSteer = v === null ? null : Math.max(-1, Math.min(1, v))
  },
  setThrust(on: boolean) {
    raw.touchThrust = on
  },
  setRetro(on: boolean) {
    raw.touchRetro = on
  },
  setBrakeLeft(on: boolean) {
    raw.brakeLeft = on
  },
  setBrakeRight(on: boolean) {
    raw.brakeRight = on
  },
  fireCamera() {
    listeners.forEach((l) => l('camera'))
  },
  firePause() {
    listeners.forEach((l) => l('pause'))
  },
}

export function readShipInput(out: ShipInput): ShipInput {
  out.steer = raw.touchSteer ?? (raw.left ? -1 : 0) + (raw.right ? 1 : 0)
  out.thrust = raw.thrust || raw.touchThrust ? 1 : 0
  out.brakeLeft = raw.brakeLeft
  out.brakeRight = raw.brakeRight
  out.retro = raw.retro || raw.touchRetro
  // T187: touch stick is analog — no digital-tap ramp needed
  out.analog = raw.touchSteer !== null
  return out
}

export function resetInput(): void {
  raw.left = raw.right = raw.thrust = raw.brakeLeft = raw.brakeRight = false
  raw.retro = false
  raw.touchSteer = null
  raw.touchThrust = false
  raw.touchRetro = false
}
