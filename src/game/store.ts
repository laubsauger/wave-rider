import { create } from 'zustand'
import type { TrackData } from '../lib/track/generate'
import type { AudioFeatures } from '../lib/audio/analyze'

export type Screen = 'boot' | 'unsupported' | 'menu' | 'multiplayer-lobby' | 'ghost-lobby' | 'track-setup' | 'analyzing' | 'race' | 'results'
export type CameraMode = 'chase' | 'cockpit'

export interface Settings {
  /** V10: scales screenshake + post fx. 0 disables entirely. */
  fxIntensity: number
  quality: 'low' | 'medium' | 'high'
}

/** session library entry for an uploaded song (T34) */
export interface UserSong {
  id: string
  title: string
  bpm: number
  durationLabel: string
  waveform: number[]
  bytes: ArrayBuffer
  mood?: string
  intensity?: number
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
  userSongs: UserSong[]
  
  // Multiplayer & Ghost
  isMultiplayer: boolean
  isHost: boolean
  opponentFinished: boolean
  opponentTimeMs: number | null
  
  ghostData: import('../lib/network/ghost').GhostData | null
  ghostPlayback: import('../lib/network/ghost').GhostData | null

  addUserSong: (song: UserSong) => void
  setScreen: (s: Screen) => void
  setSettings: (s: Partial<Settings>) => void
  toggleCamera: () => void
  setAnalysis: (p: number) => void
  setupRace: (args: {
    features: AudioFeatures
    track: TrackData
    songBuffer: AudioBuffer | null
    songTitle: string
  }) => void
  startRace: () => void
  finishRace: (r: RaceResult) => void
  setMultiplayer: (isMultiplayer: boolean, isHost?: boolean) => void
  setOpponentFinish: (timeMs: number) => void
  setGhostData: (ghost: import('../lib/network/ghost').GhostData | null) => void
  setGhostPlayback: (ghost: import('../lib/network/ghost').GhostData | null) => void
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
  userSongs: [],
  isMultiplayer: false,
  isHost: false,
  opponentFinished: false,
  opponentTimeMs: null,
  ghostData: null,
  ghostPlayback: null,

  addUserSong: (song) =>
    set((st) =>
      st.userSongs.some((s) => s.id === song.id) ? st : { userSongs: [...st.userSongs, song] },
    ),
  setScreen: (screen) => set({ screen }),
  setSettings: (s) => set((st) => ({ settings: { ...st.settings, ...s } })),
  toggleCamera: () =>
    set((st) => ({ cameraMode: st.cameraMode === 'chase' ? 'cockpit' : 'chase' })),
  setAnalysis: (analysisProgress) => set({ analysisProgress }),
  setupRace: ({ features, track, songBuffer, songTitle }) =>
    set({ features, track, songBuffer, songTitle, screen: 'track-setup', result: null, opponentFinished: false, opponentTimeMs: null, ghostData: null }),
  startRace: () => set({ screen: 'race' }),
  finishRace: (result) => set({ result, screen: 'results' }),
  setMultiplayer: (isMultiplayer, isHost = false) => set({ isMultiplayer, isHost }),
  setOpponentFinish: (opponentTimeMs) => set({ opponentFinished: true, opponentTimeMs }),
  setGhostData: (ghostData) => set({ ghostData }),
  setGhostPlayback: (ghostPlayback) => set({ ghostPlayback }),
}))
