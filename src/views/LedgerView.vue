<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import BackToTop from '@/components/BackToTop.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import {
  createAccount as createAccountEntry,
  deleteAccount as deleteAccountEntry,
  fetchAccounts,
  refreshAccount as refreshAccountEntry,
  refreshAllAccounts,
  resetSampleAccounts,
} from '@/data/accounts.source'
import { IS_LOCAL_SOURCE } from '@/data/mode'
import type { Account, AccountProvider, BalanceMeter } from '@/types/accounts'

interface ProviderOption {
  id: AccountProvider
  label: string
  placeholder: string
  hint: string
}

/** 账本支持的供应商：只选一项 + 填 Key，不需要起名字 */
const PROVIDERS: ProviderOption[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    placeholder: 'sk-…',
    hint: '在 platform.deepseek.com 创建的 API Key',
  },
  {
    id: 'opencode',
    label: 'OpenCode Go',
    placeholder: 'oc_sk_…',
    hint: 'OpenCode Go 订阅 Key（通常以 oc_sk_ 开头）',
  },
]

const accounts = ref<Account[]>([])
const loadingAll = ref(false)
const formOpen = ref(false)
const submitting = ref(false)
const notice = ref('')
const noticeOk = ref(true)
const busyIds = ref<string[]>([])

const form = ref<{ provider: AccountProvider; apiKey: string }>({
  provider: 'deepseek',
  apiKey: '',
})

const providersById = new Map(PROVIDERS.map((item) => [item.id, item]))

function providerLabel(provider: AccountProvider): string {
  return providersById.get(provider)?.label ?? provider
}

const currentProvider = computed(() => providersById.get(form.value.provider) ?? PROVIDERS[0])

/** 单机版（静态站点）才出现「恢复示例账目」这个动作 */
const isLocalSource = IS_LOCAL_SOURCE

function setNotice(message: string, isOk = true): void {
  notice.value = message
  noticeOk.value = isOk
}

function replace(account: Account): void {
  const index = accounts.value.findIndex((item) => item.id === account.id)
  if (index >= 0) accounts.value[index] = account
  else accounts.value = [...accounts.value, account]
}

async function load(): Promise<void> {
  try {
    accounts.value = (await fetchAccounts()) ?? []
  } catch (error) {
    setNotice(error instanceof Error ? error.message : String(error), false)
    return
  }
  if (accounts.value.length > 0) await refreshAll()
}

async function refreshAll(): Promise<void> {
  if (accounts.value.length === 0) return
  loadingAll.value = true
  try {
    accounts.value = await refreshAllAccounts()
  } catch (error) {
    setNotice(error instanceof Error ? error.message : String(error), false)
  } finally {
    loadingAll.value = false
  }
}

function isBusy(id: string): boolean {
  return busyIds.value.includes(id)
}

function setBusy(id: string, busy: boolean): void {
  busyIds.value = busy ? [...busyIds.value, id] : busyIds.value.filter((item) => item !== id)
}

async function refresh(id: string): Promise<void> {
  setBusy(id, true)
  try {
    replace(await refreshAccountEntry(id))
  } catch (error) {
    setNotice(error instanceof Error ? error.message : String(error), false)
  } finally {
    setBusy(id, false)
  }
}

async function addAccount(): Promise<void> {
  const apiKey = form.value.apiKey.trim()
  if (!apiKey) {
    setNotice('先填 API Key 才能记账。', false)
    return
  }
  submitting.value = true
  try {
    const created = await createAccountEntry(form.value.provider, apiKey)
    replace(created)
    form.value = { provider: form.value.provider, apiKey: '' }
    formOpen.value = false
    if (created.status === 'ok') setNotice(`${providerLabel(created.provider)} 的结余已核对。`)
    else setNotice(created.error ?? '已落账，但这次核对没对上，可稍后再试。', false)
  } catch (error) {
    setNotice(error instanceof Error ? error.message : String(error), false)
  } finally {
    submitting.value = false
  }
}

/** 待销账的条目：非空时弹窗显示 */
const pendingRemove = ref<Account | null>(null)

const removeMessage = computed(() => {
  const account = pendingRemove.value
  if (!account) return ''
  return `要把 ${providerLabel(account.provider)}（${account.keyHint}）从账上销掉吗？印一破就合不回去，销掉了也找不回来。`
})

function askRemove(account: Account): void {
  pendingRemove.value = account
}

async function confirmRemove(): Promise<void> {
  const account = pendingRemove.value
  pendingRemove.value = null
  if (!account) return
  const name = `${providerLabel(account.provider)}（${account.keyHint}）`
  try {
    await deleteAccountEntry(account.id)
    accounts.value = accounts.value.filter((item) => item.id !== account.id)
    setNotice(`${name} 已销账。`)
  } catch (error) {
    setNotice(error instanceof Error ? error.message : String(error), false)
  }
}

/** 单机版：把账页恢复成随包带来的示例账目 */
async function restoreSamples(): Promise<void> {
  accounts.value = await resetSampleAccounts()
  setNotice('账页已恢复成示例账目。')
}

function statusLabel(account: Account): string {
  if (account.status === 'ok') return '已核对'
  if (account.status === 'error') return '对不上'
  return '待核对'
}

function meterText(account: Account, meter: BalanceMeter): string {
  if (meter.kind === 'percent') {
    return meter.percent === null ? '—' : `${meter.percent.toFixed(1)}%`
  }
  if (meter.amount === null) return '—'
  const value = meter.amount.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  const unit = account.balance?.unit ?? ''
  return unit ? `${value} ${unit}` : value
}

function percentWidth(meter: BalanceMeter): string {
  const value = meter.percent ?? 0
  return `${Math.min(100, Math.max(0, value))}%`
}

function meterTone(meter: BalanceMeter): string {
  const value = meter.percent ?? 0
  if (value >= 90) return 'danger'
  if (value >= 70) return 'warn'
  return 'ok'
}

function formatTime(value: string | null | undefined): string {
  if (!value) return '尚未核对'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('zh-CN', { hour12: false })
}

function formatShort(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

onMounted(load)
</script>

<template>
  <section class="ledger">
    <div class="ledger__inner container">
      <header class="ledger__head">
        <p class="ledger__eyebrow">MERCHANT'S LEDGER</p>
        <h1 class="ledger__title">旅途账本</h1>
        <p class="ledger__lede">
          纽希拉的冬夜，炉火正旺，桌上摊着这本账。凡走过的商路、结过的契约，结余都记在这里。
        </p>
      </header>

      <p v-if="notice" class="ledger__notice" :class="{ 'is-ok': noticeOk }">{{ notice }}</p>

      <div class="sheet">
        <img class="sheet__paper" src="/art/ledger-paper.webp" alt="" aria-hidden="true" />
        <div class="sheet__pad">
          <div class="sheet__bar">
            <p class="sheet__tally">
              共 <b>{{ accounts.length }}</b> 笔往来
            </p>
            <div class="sheet__actions">
              <button class="inkbtn" @click="formOpen = !formOpen">
                {{ formOpen ? '收起' : '记一笔新账' }}
              </button>
              <button
                class="inkbtn inkbtn--ghost"
                :disabled="loadingAll || accounts.length === 0"
                @click="refreshAll"
              >
                {{ loadingAll ? '核对中…' : '全部核对' }}
              </button>
              <button
                v-if="isLocalSource"
                class="inkbtn inkbtn--ghost"
                :disabled="loadingAll"
                @click="restoreSamples"
              >
                恢复示例账目
              </button>
            </div>
          </div>

          <form v-if="formOpen" class="entry-form" @submit.prevent="addAccount">
            <div class="field">
              <label class="field__label" for="ledger-provider">供应商</label>
              <select id="ledger-provider" v-model="form.provider" class="input">
                <option v-for="option in PROVIDERS" :key="option.id" :value="option.id">
                  {{ option.label }}
                </option>
              </select>
            </div>
            <div class="field entry-form__key">
              <label class="field__label" for="ledger-key">API Key</label>
              <input
                id="ledger-key"
                v-model="form.apiKey"
                class="input"
                type="password"
                autocomplete="off"
                spellcheck="false"
                :placeholder="currentProvider.placeholder"
              />
              <p class="entry-form__hint">{{ currentProvider.hint }}</p>
            </div>
            <div class="entry-form__actions">
              <button type="button" class="inkbtn inkbtn--ghost" @click="formOpen = false">
                作罢
              </button>
              <button type="submit" class="inkbtn" :disabled="submitting">
                {{ submitting ? '记账中…' : '落账并核对' }}
              </button>
            </div>
          </form>

          <p v-if="accounts.length === 0" class="sheet__empty">
            账页还空着。点「记一笔新账」，选好供应商，再填入 API Key。
          </p>

          <div v-else class="entries">
            <div class="entries__head">
              <span>名目</span>
              <span>结余 / 额度</span>
              <span>最近核对</span>
              <span>操作</span>
            </div>

            <article
              v-for="account in accounts"
              :key="account.id"
              class="entry"
              :class="{ 'is-error': account.status === 'error' }"
            >
              <div class="entry__name">
                <span class="entry__who">{{ providerLabel(account.provider) }}</span>
                <span class="entry__key">{{ account.keyHint }}</span>
                <span class="entry__tag" :class="`is-${account.status}`">{{
                  statusLabel(account)
                }}</span>
              </div>

              <div class="entry__meters">
                <template v-if="account.balance">
                  <span
                    v-for="meter in account.balance.meters"
                    :key="meter.label"
                    class="mk"
                    :class="`mk--${meter.kind}`"
                  >
                    <span class="mk__label">{{ meter.label }}</span>
                    <b class="mk__val">{{ meterText(account, meter) }}</b>
                    <span v-if="meter.kind === 'percent'" class="mk__bar">
                      <i
                        class="mk__fill"
                        :class="`mk__fill--${meterTone(meter)}`"
                        :style="{ width: percentWidth(meter) }"
                      />
                    </span>
                    <span v-if="meter.kind === 'percent' && meter.resetAt" class="mk__note">
                      {{ formatShort(meter.resetAt) }} 重置
                    </span>
                  </span>
                </template>
                <span v-else class="mk mk--blank">—</span>
              </div>

              <div class="entry__when">{{ formatTime(account.lastChecked) }}</div>

              <div class="entry__ops">
                <button
                  class="inkbtn inkbtn--ghost inkbtn--sm"
                  :disabled="isBusy(account.id)"
                  @click="refresh(account.id)"
                >
                  {{ isBusy(account.id) ? '…' : '核对' }}
                </button>
                <button class="inkbtn inkbtn--red inkbtn--sm" @click="askRemove(account)">
                  销账
                </button>
              </div>

              <p v-if="account.status === 'error' && account.error" class="entry__error">
                {{ account.error }}
              </p>
            </article>
          </div>
        </div>

        <img
          class="sheet__prop sheet__prop--seal"
          src="/art/obj-seal.webp"
          alt=""
          aria-hidden="true"
        />
      </div>

      <!-- 账页下方的桌面文具：走正常流排版，永远不会压住账目文字 -->
      <div class="deskline" aria-hidden="true">
        <img class="deskline__quill" src="/art/obj-quill.webp" alt="" />
        <img class="deskline__candle" src="/art/obj-candle.webp" alt="" />
      </div>
    </div>

    <ConfirmDialog
      :open="pendingRemove !== null"
      title="销账"
      :message="removeMessage"
      cancel-text="再想想"
      confirm-text="销账"
      @cancel="pendingRemove = null"
      @confirm="confirmRemove"
    />

    <BackToTop />
  </section>
</template>

<style scoped>
/* ---------- 场景：家里的桌案 ---------- */
.ledger {
  position: relative;
  overflow: hidden;
  min-height: 100vh;
  padding: clamp(2.5rem, 7vw, 5rem) 0 clamp(4.5rem, 11vw, 8rem);
  background: #14100a url('/art/ledger-room.webp') center / cover no-repeat;
}

/* 压暗背景，让上面的账页成为唯一亮处 */
.ledger::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(80% 60% at 50% 40%, rgba(12, 8, 5, 0.28), rgba(12, 8, 5, 0.72) 100%),
    linear-gradient(
      180deg,
      rgba(8, 6, 10, 0.92) 0%,
      rgba(8, 6, 10, 0.5) 22%,
      rgba(8, 6, 10, 0.62) 100%
    );
  pointer-events: none;
}

.ledger__inner {
  position: relative;
  z-index: 1;
}

.ledger__head {
  max-width: 46rem;
  margin-bottom: 1.6rem;
}

.ledger__eyebrow {
  font-family: var(--font-display);
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.34em;
  text-transform: uppercase;
  color: var(--wheat-400);
}

.ledger__title {
  margin-top: 0.35rem;
  font-size: clamp(2rem, 5vw, 3.2rem);
  color: var(--parchment-50);
  text-shadow: 0 2px 18px rgba(0, 0, 0, 0.6);
}

.ledger__lede {
  margin-top: 0.7rem;
  max-width: 42rem;
  color: #d8cbb8;
  font-size: 0.95rem;
  line-height: 1.8;
  text-shadow: 0 1px 12px rgba(0, 0, 0, 0.7);
}

.ledger__notice {
  margin-bottom: 1rem;
  padding: 0.6rem 0.9rem;
  border-radius: var(--radius-sm);
  border: 1px solid rgba(208, 95, 74, 0.5);
  background: rgba(60, 14, 10, 0.72);
  color: #f0b5a5;
  font-size: 0.86rem;
}

.ledger__notice.is-ok {
  border-color: rgba(125, 154, 106, 0.5);
  background: rgba(26, 42, 22, 0.72);
  color: #c3d8b2;
}

/* ---------- 账页 ---------- */
.sheet {
  position: relative;
  min-height: clamp(320px, 46vh, 480px);
  color: #46331f;
}

/* 账页是透明底抠像：边缘有轻微凹凸的氧化边，且不会留白圈 */
.sheet__paper {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
  pointer-events: none;
  filter: drop-shadow(0 34px 52px rgba(0, 0, 0, 0.82));
}

.sheet__pad {
  position: relative;
  z-index: 1;
  padding: clamp(2.4rem, 5.4vw, 4rem) clamp(2.4rem, 6vw, 4.6rem);
}

.sheet__bar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.8rem 1.2rem;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 0.9rem;
  border-bottom: 1px solid rgba(70, 51, 31, 0.28);
}

.sheet__tally {
  font-size: 0.92rem;
  color: #6b563c;
  letter-spacing: 0.04em;
}

.sheet__tally b {
  font-family: var(--font-mono);
  font-size: 1.05rem;
  color: #3a2a15;
}

.sheet__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem;
}

/* 墨色按钮：写在纸上的感觉 */
.inkbtn {
  padding: 0.5rem 1.05rem;
  border: 1px solid rgba(70, 51, 31, 0.55);
  border-radius: 3px;
  background: rgba(70, 51, 31, 0.1);
  color: #3a2a15;
  font-size: 0.86rem;
  letter-spacing: 0.05em;
  transition:
    background 0.2s ease,
    border-color 0.2s ease,
    color 0.2s ease;
}

.inkbtn:hover:not(:disabled) {
  background: rgba(70, 51, 31, 0.2);
  border-color: rgba(70, 51, 31, 0.85);
}

.inkbtn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.inkbtn--ghost {
  background: transparent;
  border-color: rgba(70, 51, 31, 0.35);
  color: #6b563c;
}

.inkbtn--red {
  border-color: rgba(143, 47, 31, 0.55);
  background: rgba(143, 47, 31, 0.08);
  color: #8f2f1f;
}

.inkbtn--red:hover:not(:disabled) {
  background: rgba(143, 47, 31, 0.16);
  border-color: #8f2f1f;
}

.inkbtn--sm {
  padding: 0.34rem 0.75rem;
  font-size: 0.78rem;
}

/* ---------- 记账表单 ---------- */
.entry-form {
  display: grid;
  grid-template-columns: minmax(160px, 220px) 1fr;
  gap: 0.9rem 1.4rem;
  align-items: start;
  margin: 1.1rem 0;
  padding: 1.1rem 1.2rem;
  border: 1px dashed rgba(70, 51, 31, 0.45);
  border-radius: 3px;
  background: rgba(255, 250, 236, 0.45);
}

.entry-form :deep(.field__label),
.entry-form .field__label {
  color: #6b563c;
}

.entry-form .input {
  border: 1px solid rgba(70, 51, 31, 0.32);
  border-radius: 3px;
  background: rgba(255, 252, 244, 0.7);
  color: #3a2a15;
}

.entry-form .input:focus {
  border-color: rgba(70, 51, 31, 0.8);
  box-shadow: 0 0 0 3px rgba(70, 51, 31, 0.12);
}

.entry-form__hint {
  color: #85755a;
  font-size: 0.76rem;
}

.entry-form__actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.55rem;
  grid-column: 1 / -1;
}

.sheet__empty {
  padding: 2.4rem 0.6rem;
  color: #7b6a52;
  text-align: center;
  font-size: 0.92rem;
}

/* ---------- 分类账 ---------- */
.entries {
  --cols: minmax(150px, 1fr) minmax(0, 1.7fr) 132px auto;
  margin-top: 0.4rem;
}

.entries__head,
.entry {
  display: grid;
  grid-template-columns: var(--cols);
  gap: 0.7rem 1.1rem;
  align-items: center;
}

.entries__head {
  padding: 0.55rem 0.2rem;
  border-bottom: 1px solid rgba(70, 51, 31, 0.4);
  color: #7b6a52;
  font-size: 0.76rem;
  letter-spacing: 0.14em;
}

.entry {
  padding: 0.85rem 0.2rem;
  border-bottom: 1px solid rgba(70, 51, 31, 0.18);
}

.entry.is-error {
  background: linear-gradient(90deg, rgba(143, 47, 31, 0.09), transparent 70%);
}

.entry__name {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}

.entry__who {
  font-family: var(--font-heading);
  font-size: 1.02rem;
  font-weight: 600;
  color: #3a2a15;
}

.entry__key {
  font-family: var(--font-mono);
  font-size: 0.8rem;
  color: #7b6a52;
}

.entry__tag {
  align-self: flex-start;
  margin-top: 0.15rem;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  border: 1px solid rgba(70, 51, 31, 0.3);
  color: #6b563c;
  font-size: 0.7rem;
  letter-spacing: 0.08em;
}

.entry__tag.is-ok {
  border-color: rgba(92, 116, 73, 0.55);
  color: #4f6a3c;
}

.entry__tag.is-error {
  border-color: rgba(143, 47, 31, 0.6);
  color: #8f2f1f;
}

.entry__meters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1.3rem;
  min-width: 0;
}

.mk {
  display: grid;
  gap: 0.15rem;
  min-width: 4.5rem;
}

.mk__label {
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  color: #85755a;
}

.mk__val {
  font-family: var(--font-mono);
  font-size: 1.02rem;
  color: #3a2a15;
}

.mk__bar {
  display: block;
  overflow: hidden;
  width: 100%;
  height: 4px;
  border-radius: 999px;
  background: rgba(70, 51, 31, 0.16);
}

.mk__fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: #6f5a33;
}

.mk__fill--warn {
  background: #9a6a1f;
}

.mk__fill--danger {
  background: #8f2f1f;
}

.mk__note {
  font-size: 0.68rem;
  color: #85755a;
}

.mk--blank {
  color: #85755a;
}

.entry__when {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  color: #6b563c;
}

.entry__ops {
  display: flex;
  gap: 0.45rem;
  justify-content: flex-end;
}

.entry__error {
  grid-column: 1 / -1;
  margin-top: 0.1rem;
  padding: 0.45rem 0.7rem;
  border-left: 2px solid #8f2f1f;
  background: rgba(143, 47, 31, 0.08);
  color: #7d2a1a;
  font-size: 0.8rem;
  line-height: 1.6;
}

/* ---------- 纸面文具 ---------- */
.sheet__prop {
  position: absolute;
  pointer-events: none;
  filter: drop-shadow(0 16px 20px rgba(20, 12, 4, 0.55));
}

.sheet__prop--seal {
  right: -1.2rem;
  top: -1.6rem;
  width: clamp(78px, 10vw, 140px);
  transform: rotate(11deg);
}

.deskline {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-top: 0.6rem;
  pointer-events: none;
}

.deskline img {
  filter: drop-shadow(0 18px 22px rgba(0, 0, 0, 0.68));
}

.deskline__quill {
  width: clamp(104px, 12vw, 180px);
  transform: rotate(-13deg) translateY(-0.8rem);
}

.deskline__candle {
  width: clamp(62px, 7vw, 112px);
  transform: translateY(0.2rem);
}

@media (max-width: 960px) {
  .entries {
    --cols: minmax(130px, 1fr) minmax(0, 1.4fr) auto;
  }

  .entries__head span:nth-child(3),
  .entry__when {
    display: none;
  }

  .entries__head,
  .entry {
    grid-template-columns: minmax(130px, 1fr) minmax(0, 1.4fr) auto;
  }

  .entry__error {
    grid-column: 1 / -1;
  }
}

/* 竖屏手机：账面按钮实测 42 / 35px 高，统一撑到 44px 触控目标 */
@media (max-width: 700px) and (orientation: portrait) {
  .inkbtn {
    min-height: var(--tap);
  }
}

@media (max-width: 680px) {
  .sheet__pad {
    padding: 1.6rem 1.2rem;
  }

  .entries__head {
    display: none;
  }

  .entry-form {
    grid-template-columns: 1fr;
  }

  .entry {
    grid-template-columns: 1fr;
    gap: 0.55rem;
    padding: 1rem 0.1rem;
  }

  .entry__ops {
    justify-content: flex-start;
  }

  .sheet__prop--seal {
    right: -1.6rem;
    top: -1.4rem;
    width: 74px;
  }

  .deskline__quill {
    width: 108px;
  }

  .deskline__candle {
    width: 68px;
  }
}
</style>
