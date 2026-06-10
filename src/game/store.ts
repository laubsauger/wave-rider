import { create } from 'zustand'
import type { TrackData } from '../lib/track/generate'
import type { AudioFeatures } from '../lib/audio/analyze'

export type Screen = 'boot' | 'unsupported' | 'menu' | 'analyzing' | 'race' | 'results'
export type CameraMode = 'chase' | 'cockpit'

export interface Settings {
  /** V10: scales screenshake + post fx. 0 disables entirely. */
  fxIntensity: number
  quality: 'low' | 'medium' | 'high'
}

export interface RaceResult {
  timeMs: number
  topSpeed: number
  boostsHit: number
  wallHits: number
  songTitle: string
  place: number
  totalRacers: number
}

interface GameState {
  screen: Screen
  settings: Settings
  cameraMode: CameraMode
  features: AudioFeatures | null
  track: TrackData | null
  songTitle: string
  /** decoded song for playback during race */
  songBuffer: AudioBuffer | null
  result: RaceResult | null
  analysisProgress: number

  setScreen: (s: Screen) => void
  setSettings: (s: Partial<Settings>) => void
  toggleCamera: () => void
  setAnalysis: (p: number) => void
  loadRace: (args: {
    features: AudioFeatures
    track: TrackData
    songBuffer: AudioBuffer | null
    songTitle: string
  }) => void
  finishRace: (r: RaceResult) => void
}

export const useGame = create<GameState>((set) => ({
  screen: 'boot',
  settings: { fxIntensity: 1, quality: 'high' },
  cameraMode: 'chase',
  features: null,
  track: null,
  songTitle: '',
  songBuffer: null,
  result: null,
  analysisProgress: 0,

  setScreen: (screen) => set({ screen }),
  setSettings: (s) => set((st) => ({ settings: { ...st.settings, ...s } })),
  toggleCamera: () =>
    set((st) => ({ cameraMode: st.cameraMode === 'chase' ? 'cockpit' : 'chase' })),
  setAnalysis: (analysisProgress) => set({ analysisProgress }),
  loadRace: ({ features, track, songBuffer, songTitle }) =>
    set({ features, track, songBuffer, songTitle, screen: 'race', result: null }),
  finishRace: (result) => set({ result, screen: 'results' }),
}))
