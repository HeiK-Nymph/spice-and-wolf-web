import type { Account, AccountProvider } from '@/types/accounts'

interface Envelope<T> {
  ok?: boolean
  data?: T
  error?: string
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options)
  let payload: Envelope<T> | null = null
  try {
    payload = (await response.json()) as Envelope<T>
  } catch {
    payload = null
  }
  if (!payload || payload.ok !== true) {
    throw new Error(payload?.error ?? `请求失败（HTTP ${response.status}）`)
  }
  return payload.data as T
}

export function fetchAccounts(): Promise<Account[]> {
  return request<Account[]>('/api/accounts')
}

export function refreshAllAccounts(): Promise<Account[]> {
  return request<Account[]>('/api/accounts/refresh', { method: 'POST' })
}

export function refreshAccount(id: string): Promise<Account> {
  return request<Account>(`/api/accounts/${id}/refresh`, { method: 'POST' })
}

export function createAccount(provider: AccountProvider, apiKey: string): Promise<Account> {
  return request<Account>('/api/accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, apiKey }),
  })
}

export function deleteAccount(id: string): Promise<unknown> {
  return request(`/api/accounts/${id}`, { method: 'DELETE' })
}
