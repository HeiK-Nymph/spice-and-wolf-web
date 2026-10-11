export interface StudioCharacter {
  id: string
  label: string
  en: string
  aliases: string[]
  appearance: string
  refUrl: string
}

export interface BannedWord {
  word: string
  hint: string
}

export interface StudioConfig {
  configured: boolean
  model: string
  sizes: string[]
  qualities: string[]
  maxBatch: number
  maxRefImages: number
  maxPromptLength: number
  pricePerImage: number
  characters: StudioCharacter[]
  bannedWords: BannedWord[]
  characterModeRules: string[]
}

export interface UploadedRef {
  id: string
  url: string
  name: string
  size: number
}

export interface StudioImage {
  id: string
  url: string
  size?: string
  quality?: string
  model?: string
  prompt?: string
  revisedPrompt?: string
  createdAt?: number
}

export type StudioMode = 'character' | 'free'

export interface StudioJob {
  id: string
  kind: string
  mode: StudioMode | 'crop'
  status: string
  userPrompt: string
  prompt: string
  characters: string[]
  refs: string[]
  size: string
  quality: string
  n: number
  model: string
  createdAt: string
  elapsedMs: number
}

export interface GenerateResponse {
  job: StudioJob
  images: StudioImage[]
  usage?: unknown
}

export interface StudioHistoryEntry extends StudioJob {
  images: { id: string; url: string; size?: string }[]
}
