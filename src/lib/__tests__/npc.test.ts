import { describe, expect, it } from 'vitest'
import { generateTrack } from '../track/generate'
import { sampleTrack } from '../track/sample'
import { initialNpc, makeNpcs, racePosition, resolveCollisions, stepNpc, type NpcState } from '../physics/npc'
import { computeLean } from '../physics/ship'
import type { AudioFeatures } from '../audio/analyze'

function features(duration = 60): AudioFeatures {
  const frameInterval = 1024 / 44100
  const frames = Math.floor(duration / frameInterval)
  return {
    duration,
    sampleRate: 44100,
    bpm: 120,
    energy: new Float32Array(frames).fill(0.6),
    centroid: new Float32Array(frames).fill(0.5),
    frameInterval,
    onsets: Array.from({ length: 100 }, (_, i) => i * 0.6),
    sections: [
      { start: 0, end: 30, energy: 0.7, brightness: 0.5 },
      { start: 30, end: 60, energy: 0.3, brightness: 0.3 },
    ],
    mood: 'energetic',
    intensity: 0.6,
    events: [],
  }
}

const track = generateTrack(features())
const frames = sampleTrack(track, 3)

describe('NPC racers (T20, V13, V15)', () => {
  it('V15: specs and full sim runs are deterministic', () => {
    const specsA = makeNpcs(track)
    const specsB = makeNpcs(track)
    expect(specsA).toEqual(specsB)

    const run = () => {
      const states = specsA.map((_, i) => initialNpc(i))
      for (let step = 0; step < 10000; step++) {
        for (let i = 0; i < states.length; i++) stepNpc(states[i], specsA[i], track, frames)
      }
      return states
    }
    expect(run()).toEqual(run())
  })

  it('NPCs stay within walls and finish eventually', () => {
    const specs = makeNpcs(track)
    const states = specs.map((_, i) => initialNpc(i))
    // bound relative to the track, not wall-clock minutes — V2 rework sizes
    // tracks for play pace, so absolute caps rot. NPCs run REAL physics now
    // (cruise ≈ 0.75× pace + pads), so give them 2.6× design time.
    const maxSteps = 120 * Math.ceil((track.length / track.avgSpeed) * 2.6)
    for (let step = 0; step < maxSteps; step++) {
      for (let i = 0; i < states.length; i++) {
        stepNpc(states[i], specs[i], track, frames)
        // unified physics: walls follow the LOCAL width (T77); falling off a
        // rail-less ridge and the wreck pause are legal off-road states —
        // same rules as physics.test
        const st = states[i]
        if (st.falling || st.wrecked > 0 || st.s < 0) continue
        const fi = Math.min(frames.count - 1, Math.max(0, Math.round(st.s / frames.ds)))
        const limit = (track.width * frames.widths[fi]) / 2
        const margin = frames.walls[fi] > 0.5 ? 0.5 : 4.6
        if (!st.airborne) expect(Math.abs(st.d)).toBeLessThanOrEqual(limit + margin)
      }
    }
    expect(states.every((s) => s.finished)).toBe(true)
  })

  it('V13: racePosition counts racers strictly ahead', () => {
    const mk = (s: number): NpcState => {
      const ship = initialNpc(0)
      ship.s = s
      ship.d = 0
      return ship
    }
    expect(racePosition(100, [mk(50), mk(99.9), mk(101), mk(500)])).toBe(3)
    expect(racePosition(600, [mk(50), mk(99.9), mk(101), mk(500)])).toBe(1)
    expect(racePosition(0, [mk(1), mk(2), mk(3)])).toBe(4)
    expect(racePosition(100, [mk(100)])).toBe(1) // ties don't count as ahead
  })

  it('the field races as a pack — everyone finishes, tight spread', () => {
    // unified physics: pace is a throttle ceiling and skill is line quality +
    // braking margin. On a short synthetic track, pad luck exceeds the ~2%
    // deliberate spread — strict pro-beats-tail ordering is seed noise. The
    // design claim (T159) is the PACK: all finish, nobody is a parade float.
    const specs = makeNpcs(track)
    const states = specs.map(() => {
      const ship = initialNpc(0)
      ship.s = 0
      ship.d = 0
      return ship
    })
    for (let step = 0; step < 120 * 90; step++) {
      for (let i = 0; i < states.length; i++) stepNpc(states[i], specs[i], track, frames)
    }
    const times = states.map((s) => (s.finished ? s.time : Infinity))
    expect(times.every((t) => Number.isFinite(t))).toBe(true)
    // generous: a back-marker can eat a wreck cycle or two (pause + setback)
    // and still count as racing — this catches stuck/parade NPCs, not luck
    const spread = Math.max(...times) - Math.min(...times)
    expect(spread).toBeLessThan(Math.min(...times) * 0.5)
  })
})

describe('computeLean (V18, amends V14)', () => {
  it('steering right banks right (positive)', () => {
    expect(computeLean(0.5, 100)).toBeGreaterThan(0)
  })
  it('B6: no steer → no lean, at any speed', () => {
    expect(computeLean(0, 50)).toBe(0)
    expect(computeLean(0, 300)).toBe(0)
  })
  it('left steer banks left (negative)', () => {
    expect(computeLean(-0.5, 100)).toBeLessThan(0)
  })
})

describe('collisions (T32, V17)', () => {
  const makeRacers = () => [
    { s: 100, d: 0, v: 200 },
    { s: 103, d: 1.2, v: 120 },
    { s: 50, d: 0, v: 80 }, // far away, untouched
  ]

  it('deterministic, no energy creation, walls respected', () => {
    const a = makeRacers()
    const b = makeRacers()
    const ia = resolveCollisions(a, track)
    const ib = resolveCollisions(b, track)
    expect(a).toEqual(b)
    expect(ia).toBe(ib)
    expect(ia).toBeGreaterThan(0) // racers 0 and 1 overlap → player impact

    const sumBefore = makeRacers().reduce((x, r) => x + r.v, 0)
    const sumAfter = a.reduce((x, r) => x + r.v, 0)
    expect(sumAfter).toBeLessThanOrEqual(sumBefore + 1e-9)

    const limit = track.width / 2 - 1.5
    for (const r of a) expect(Math.abs(r.d)).toBeLessThanOrEqual(limit + 1e-9)
    // distant racer untouched
    expect(a[2]).toEqual(makeRacers()[2])
  })

  it('faster ship slows, slower ship speeds up (energy transfer)', () => {
    const racers = [
      { s: 100, d: 0, v: 150 },
      { s: 102, d: 0.5, v: 120 },
    ]
    resolveCollisions(racers, track)
    expect(racers[0].v).toBeLessThan(150)
    expect(racers[1].v).toBeGreaterThan(120)
  })

  it('collision hull damage scales with closing speed — ramming speed is fatal', () => {
    // gentle bump: both lose a sliver, rammer loses more
    const soft = [
      { s: 100, d: 0, v: 150, energy: 1, damageT: 9 },
      { s: 103, d: 0.5, v: 130, energy: 1, damageT: 9 },
    ]
    resolveCollisions(soft, track)
    expect(soft[0].energy).toBeLessThan(1)
    expect(soft[1].energy).toBeLessThan(1)
    expect(soft[0].energy).toBeLessThan(soft[1].energy) // rear eats more
    expect(soft[0].energy).toBeGreaterThan(0.8) // a nudge, not a wreck

    // 1000 kph closing ram: rammer's hull is GONE, victim near-dead
    const slam = [
      { s: 100, d: 0, v: 320, energy: 1, damageT: 9 },
      { s: 103, d: 0.5, v: 42, energy: 1, damageT: 9 },
    ]
    resolveCollisions(slam, track)
    expect(slam[0].energy).toBe(0) // explosion next step
    expect(slam[1].energy).toBeLessThan(0.45)
  })

  it('T112: airborne ship passes clean over a grounded one', () => {
    const racers = [
      { s: 100, d: 0, v: 200, air: 6 }, // flying high
      { s: 101, d: 0.3, v: 120 },
    ]
    const impact = resolveCollisions(racers, track)
    expect(impact).toBe(0)
    expect(racers[0].v).toBe(200)
    expect(racers[1].v).toBe(120)
    expect(racers[0].d).toBe(0) // no shove either
  })

  it('T79: closing speed > 55 m/s → wreck, both lose big', () => {
    const racers = [
      { s: 100, d: 0, v: 200 },
      { s: 102, d: 0.5, v: 100 },
    ]
    resolveCollisions(racers, track)
    expect(racers[0].v).toBeLessThanOrEqual(45)
    expect(racers[1].v).toBeLessThanOrEqual(100)
  })
})

describe('rubber-band (T189, V29)', () => {
  const specs = makeNpcs(track)

  /** run one npc N seconds with a fixed player gap, return DISTANCE covered
   * (final v samples a random track spot — corners alias it) */
  const runWithGap = (specIdx: number, gapAhead: number | undefined, secs = 20): number => {
    const st = initialNpc(specIdx)
    const steps = Math.round(secs * 120)
    for (let i = 0; i < steps; i++) {
      stepNpc(st, specs[specIdx], track, frames, gapAhead === undefined ? undefined : st.s - gapAhead)
    }
    return st.s
  }

  it('mid-field NPC ahead of a struggling player eases off', () => {
    const base = runWithGap(3, undefined)
    const eased = runWithGap(3, 700) // npc 700m AHEAD of player
    expect(eased).toBeLessThan(base * 0.985)
  })

  it('back-field NPC behind a flying player pushes harder', () => {
    const base = runWithGap(4, undefined)
    const pushed = runWithGap(4, -700) // npc 700m BEHIND player
    expect(pushed).toBeGreaterThan(base * 1.02)
  })

  it('V29: elite (VEKTOR) ignores the player entirely', () => {
    expect(specs[0].rubber).toBe(0)
    const base = runWithGap(0, undefined)
    const withGap = runWithGap(0, 700)
    expect(withGap).toBeCloseTo(base, 6)
  })

  it('V15 form preserved: same inputs → same trace with rubber-banding', () => {
    const a = runWithGap(2, 400)
    const b = runWithGap(2, 400)
    expect(a).toBe(b)
  })
})
