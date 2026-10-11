/**
 * 构建期开关：由 vite.config.ts 的 define 注入（true = 单机版）。
 * 它是字面量，所以未选中的那条分支连同它的动态 import 会被静态消除 ——
 * 两个产物里各自只剩一套实现。
 */
const USE_LOCAL = __LOCAL_SOURCE__

import type { Account, AccountProvider } from '@/types/accounts'

/**
 * 账本数据接缝。上层只认这几个函数 —— 走本机 Node 服务还是全在浏览器里完成，
 * 由构建模式决定（见 src/data/mode.ts）。未选中的分支不会进产物。
 */
export async function fetchAccounts(): Promise<Account[]> {
  if (USE_LOCAL) {
    const local = await import('./local/accounts')
    return local.fetchAccounts()
  }
  const http = await import('@/api/accounts')
  return http.fetchAccounts()
}

export async function refreshAllAccounts(): Promise<Account[]> {
  if (USE_LOCAL) {
    const local = await import('./local/accounts')
    return local.refreshAllAccounts()
  }
  const http = await import('@/api/accounts')
  return http.refreshAllAccounts()
}

export async function refreshAccount(id: string): Promise<Account> {
  if (USE_LOCAL) {
    const local = await import('./local/accounts')
    return local.refreshAccount(id)
  }
  const http = await import('@/api/accounts')
  return http.refreshAccount(id)
}

export async function createAccount(provider: AccountProvider, apiKey: string): Promise<Account> {
  if (USE_LOCAL) {
    const local = await import('./local/accounts')
    return local.createAccount(provider, apiKey)
  }
  const http = await import('@/api/accounts')
  return http.createAccount(provider, apiKey)
}

export async function deleteAccount(id: string): Promise<void> {
  if (USE_LOCAL) {
    const local = await import('./local/accounts')
    await local.deleteAccount(id)
    return
  }
  const http = await import('@/api/accounts')
  await http.deleteAccount(id)
}

/**
 * 把账页恢复成示例账目 —— 只有单机版有这个动作。
 * 这里的守卫不能省：少了它，本地那份实现会被无条件 import 进来，
 * 连主站产物里都会多背一套用不上的代码。
 */
export async function resetSampleAccounts(): Promise<Account[]> {
  if (!USE_LOCAL) throw new Error('这一台没有随包的示例账目。')
  const local = await import('./local/accounts')
  return local.resetSampleAccounts()
}
