/**
 * 构建期开关：由 vite.config.ts 的 define 注入（true = 单机版）。
 * 它是字面量，所以未选中的那条分支连同它的动态 import 会被静态消除 ——
 * 两个产物里各自只剩一套实现。
 */
const USE_LOCAL = __LOCAL_SOURCE__

import type {
  GenerateResponse,
  StudioConfig,
  StudioHistoryEntry,
  UploadedRef,
} from '@/types/studio'

/**
 * 画坊数据接缝。
 *
 * 走本机 Node 服务（api/studio.ts）还是全在浏览器里完成（local/studio.ts），
 * 由构建模式决定 —— 见 src/data/mode.ts。未选中的分支不会进产物。
 */
export interface GeneratePayload {
  mode: 'character' | 'free'
  prompt: string
  characters: string[]
  refs: string[]
  size: string
  quality: string
  n: number
  intent?: string
}

export interface DerivePayload {
  blob: Blob
  source: string
  label: string
  width: number
  height: number
}

async function backend() {
  if (USE_LOCAL) return import('./local/studio')
  return import('@/api/studio')
}

export async function fetchStudioConfig(): Promise<StudioConfig> {
  const api = await backend()
  return api.fetchStudioConfig()
}

export async function fetchStudioHistory(): Promise<StudioHistoryEntry[]> {
  const api = await backend()
  return api.fetchStudioHistory()
}

export async function uploadRefs(files: File[]): Promise<{ files: UploadedRef[] }> {
  const api = await backend()
  return api.uploadRefs(files)
}

export async function deleteUpload(id: string): Promise<{ deleted: boolean }> {
  const api = await backend()
  return api.deleteUpload(id)
}

export async function generateImages(payload: GeneratePayload): Promise<GenerateResponse> {
  const api = await backend()
  return api.generateImages(payload)
}

export async function deriveCrop(payload: DerivePayload): Promise<GenerateResponse> {
  const api = await backend()
  return api.deriveCrop(payload)
}

export async function deleteImage(filename: string): Promise<{ deleted: boolean; url: string }> {
  const api = await backend()
  return api.deleteImage(filename)
}

export async function renameImage(
  filename: string,
  name: string,
): Promise<{ renamed: boolean; name: string; url: string }> {
  const api = await backend()
  return api.renameImage(filename, name)
}
