import type {
  GenerateResponse,
  StudioConfig,
  StudioHistoryEntry,
  UploadedRef,
} from '@/types/studio'

interface ApiEnvelope<T> {
  ok?: boolean
  data?: T
  error?: string
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options)
  let payload: ApiEnvelope<T> | null = null
  try {
    payload = (await response.json()) as ApiEnvelope<T>
  } catch {
    payload = null
  }
  if (!payload || payload.ok !== true) {
    throw new Error(payload?.error ?? `请求失败（HTTP ${response.status}）`)
  }
  return payload.data as T
}

export function fetchStudioConfig(): Promise<StudioConfig> {
  return request<StudioConfig>('/api/studio/config')
}

export function fetchStudioHistory(): Promise<StudioHistoryEntry[]> {
  return request<StudioHistoryEntry[]>('/api/studio/history')
}

export function uploadRefs(files: File[]): Promise<{ files: UploadedRef[] }> {
  const form = new FormData()
  for (const file of files) form.append('files', file)
  return request<{ files: UploadedRef[] }>('/api/uploads', { method: 'POST', body: form })
}

export function deleteUpload(id: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/api/uploads/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export interface GeneratePayload {
  mode: 'character' | 'free'
  prompt: string
  characters: string[]
  refs: string[]
  size: string
  quality: string
  n: number
  /** 传 'redraw' 时，服务端把这条历史记成「重绘」 */
  intent?: string
}

export function generateImages(payload: GeneratePayload): Promise<GenerateResponse> {
  return request<GenerateResponse>('/api/studio/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export interface DerivePayload {
  blob: Blob
  source: string
  label: string
  width: number
  height: number
}

/** 把裁剪结果落库成一条历史记录（同时可在 generated/ 里当参考图用） */
export function deriveCrop(payload: DerivePayload): Promise<GenerateResponse> {
  const form = new FormData()
  form.append('image', payload.blob, 'crop.png')
  form.append('source', payload.source)
  form.append('label', payload.label)
  form.append('width', String(payload.width))
  form.append('height', String(payload.height))
  return request<GenerateResponse>('/api/studio/derive', { method: 'POST', body: form })
}

/** 删除一张产物（服务端同时把它从历史里摘掉） */
export function deleteImage(filename: string): Promise<{ deleted: boolean; url: string }> {
  return request(`/api/studio/images/${encodeURIComponent(filename)}`, { method: 'DELETE' })
}

/** 重命名一张产物：文件改名，历史里的 URL / refs 一起跟着改 */
export function renameImage(
  filename: string,
  name: string,
): Promise<{ renamed: boolean; name: string; url: string }> {
  return request(`/api/studio/images/${encodeURIComponent(filename)}/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}
