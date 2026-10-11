<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import BackToTop from '@/components/BackToTop.vue'
import CompareOverlay from '@/components/CompareOverlay.vue'
import WheatDivider from '@/components/WheatDivider.vue'
import { usePricingStore } from '@/stores/pricing'
import type { CompareItem, Plan, PriceKind, Provider } from '@/types/pricing'
import {
  bestTokensForKind,
  formatCny,
  formatTokens,
  formatUsd,
  planLeverage,
} from '@/utils/exchange'

const store = usePricingStore()

const KINDS: PriceKind[] = ['input_cache_hit', 'input_cache_miss', 'output']

const rateDraft = ref<number | null>(null)
const saving = ref(false)
const saveHint = ref('')

onMounted(async () => {
  readUrl()
  await store.load()
  rateDraft.value = store.usdToCny
  await nextTick()
  scheduleEqualize()
  window.addEventListener('resize', scheduleEqualize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', scheduleEqualize)
  if (equalizeTimer !== undefined) window.clearTimeout(equalizeTimer)
})

const kindLabel = (kind: PriceKind): string =>
  store.priceKinds.find((item) => item.id === kind)?.label ?? kind

const officialProviders = computed(() => store.providers.filter((p) => p.kind === 'official-api'))
const aggregators = computed(() => store.providers.filter((p) => p.kind === 'aggregator'))

/** 「输出」档的最优 token 数，作为排序与倍数比较的基准 */
function outputTokens(provider: Provider): number {
  return bestTokensForKind(provider, 'output', store.usdToCny)?.tokens ?? 0
}

function sortByOutput(list: Provider[]): Provider[] {
  return [...list].sort((a, b) => outputTokens(b) - outputTokens(a))
}

const rankedApi = computed(() => sortByOutput([...officialProviders.value, ...aggregators.value]))

/** 全站最划算的那家，用来做「是 X 的 N 倍」 */
/** 冠军跟随当前筛选结果，否则绶带会指向一张被筛掉的卡片 */
const champion = computed(() => visibleApi.value.find((p) => outputTokens(p) > 0) ?? null)

function multipleOf(provider: Provider): string | null {
  const base = champion.value
  if (!base || base.id === provider.id) return null
  const top = outputTokens(base)
  const mine = outputTokens(provider)
  if (top <= 0 || mine <= 0) return null
  return `${(top / mine).toFixed(1)}×`
}

function tokensFor(provider: Provider, kind: PriceKind): number {
  return bestTokensForKind(provider, kind, store.usdToCny)?.tokens ?? 0
}

function modelFor(provider: Provider, kind: PriceKind): string {
  return bestTokensForKind(provider, kind, store.usdToCny)?.modelName ?? '—'
}

function formatPlanPrice(plan: Plan): string {
  if (!plan.price) return '—'
  return plan.price.currency === 'CNY' ? formatCny(plan.price.amount) : formatUsd(plan.price.amount)
}

function quotaText(plan: Plan): string {
  if (!plan.quota) return ''
  const unit =
    plan.quota.unit === 'credits' ? '积分' : plan.quota.unit === 'tokens' ? 'token' : '美元'
  const period = plan.quota.period === 'week' ? '周' : '月'
  return `${plan.quota.amount.toLocaleString('zh-CN')} ${unit} / ${period}`
}

function planMonthlyCny(plan: Plan): number | null {
  if (!plan.price) return null
  if (plan.price.currency === 'CNY') return plan.price.amount
  return plan.price.amount * store.usdToCny
}

const bestPlanLeverage = computed(() => {
  const values = store.plans
    .map((plan) => planLeverage(plan))
    .filter((value): value is number => typeof value === 'number' && value > 0)
  return values.length > 0 ? Math.max(...values) : 0
})

/** 超过这个天数没核对，就在页面上提醒客人 */
const STALE_DAYS = 30

function daysSince(value: string | null | undefined): number | null {
  if (!value) return null
  const then = new Date(value).getTime()
  if (Number.isNaN(then)) return null
  return Math.floor((Date.now() - then) / 86_400_000)
}

const dataAgeDays = computed(() => daysSince(store.data?.meta.lastUpdated))
const dataIsStale = computed(() => dataAgeDays.value !== null && dataAgeDays.value > STALE_DAYS)
/* ------------------------------------------------------------------ */
/* 筛选                                                                */
/* ------------------------------------------------------------------ */
type SourceFilter = 'all' | 'official' | 'third'
type KindFilter = 'all' | 'api' | 'aggregator' | 'plan'

const SOURCE_OPTIONS: Array<{ id: SourceFilter; label: string }> = [
  { id: 'all', label: '全部来源' },
  { id: 'official', label: '仅官方核对' },
  { id: 'third', label: '仅第三方' },
]
const KIND_OPTIONS: Array<{ id: KindFilter; label: string }> = [
  { id: 'all', label: '全部类型' },
  { id: 'api', label: '官方 API' },
  { id: 'aggregator', label: '聚合平台' },
  { id: 'plan', label: '订阅套餐' },
]

const route = useRoute()
const router = useRouter()
const sourceFilter = ref<SourceFilter>('all')
const kindFilter = ref<KindFilter>('all')

function matchSource(verified: boolean | undefined): boolean {
  if (sourceFilter.value === 'all') return true
  const isOfficial = verified !== false
  return sourceFilter.value === 'official' ? isOfficial : !isOfficial
}

const showProviders = computed(() => kindFilter.value !== 'plan')
const showPlans = computed(() => kindFilter.value === 'all' || kindFilter.value === 'plan')

const visibleApi = computed(() =>
  rankedApi.value.filter((p) => {
    if (!matchSource(p.verified)) return false
    if (kindFilter.value === 'all') return true
    if (kindFilter.value === 'api') return p.kind === 'official-api'
    return p.kind === kindFilter.value
  }),
)

const visiblePlans = computed(() => store.plans.filter((p) => matchSource(p.verified)))

/* ------------------------------------------------------------------ */
/* 对照台                                                              */
/* ------------------------------------------------------------------ */
const MAX_COMPARE = 4
const compareIds = ref<string[]>([])
const compareOpen = ref(false)

const METRICS = [
  { key: 'input_cache_hit', label: '输入·命中缓存' },
  { key: 'input_cache_miss', label: '输入·未命中' },
  { key: 'output', label: '输出' },
  { key: 'fee', label: '月费' },
  { key: 'quota', label: '额度' },
  { key: 'leverage', label: '额度杠杆' },
  { key: 'model', label: '折算模型' },
]

const compareItems = computed<CompareItem[]>(() => {
  const out: CompareItem[] = []
  for (const id of compareIds.value) {
    const provider = store.providers.find((x) => x.id === id)
    if (provider) {
      const cells: Record<string, string> = {}
      for (const kind of KINDS) {
        const tokens = tokensFor(provider, kind)
        if (tokens > 0) cells[kind] = `1 元 ≈ ${formatTokens(tokens)}`
      }
      const best = bestTokensForKind(provider, 'output', store.usdToCny)
      if (best) cells.model = best.modelName
      out.push({
        id: provider.id,
        name: provider.name,
        vendor: provider.tag,
        kindLabel: provider.kind === 'aggregator' ? '聚合平台' : '官方 API',
        verified: provider.verified !== false,
        sourceUrl: provider.sourceUrl,
        lastChecked: provider.lastChecked,
        cells,
      })
      continue
    }
    const plan = store.plans.find((x) => x.id === id)
    if (plan) {
      const cells: Record<string, string> = {}
      if (plan.price) cells.fee = `${plan.price.amount} ${plan.price.currency} / 月`
      const quota = quotaText(plan)
      if (quota) cells.quota = quota
      const leverage = planLeverage(plan)
      if (leverage) cells.leverage = `×${leverage.toFixed(1)}`
      out.push({
        id: plan.id,
        name: plan.name,
        vendor: plan.vendorName,
        kindLabel: '订阅套餐',
        verified: plan.verified !== false,
        sourceUrl: plan.sourceUrl,
        lastChecked: plan.lastChecked,
        cells,
      })
    }
  }
  return out
})

function isComparing(id: string): boolean {
  return compareIds.value.includes(id)
}

function toggleCompare(id: string): void {
  const index = compareIds.value.indexOf(id)
  if (index >= 0) compareIds.value.splice(index, 1)
  else if (compareIds.value.length < MAX_COMPARE) compareIds.value.push(id)
}

function removeCompare(id: string): void {
  const index = compareIds.value.indexOf(id)
  if (index >= 0) compareIds.value.splice(index, 1)
  if (compareIds.value.length < 2) compareOpen.value = false
}

function clearCompare(): void {
  compareIds.value = []
  compareOpen.value = false
}

/* ------------------------------------------------------------------ */
/* URL 状态：筛选与对照都写进 query，方便把"我看到的视图"整个分享出去      */
/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/* 展开前的行内等高                                                    */
/*   需求：同一行的卡片，展开前都与该行「最高那张」一样高；            */
/*   展开某一张时，只有它自己变高，同排其他卡不动。                    */
/*   做法：测量时先临时收起所有展开项，量到的就是"展开前"的自然高度，  */
/*   再把该行最大值写到每张卡的 min-height 上。                        */
/* ------------------------------------------------------------------ */
let equalizeTimer: number | undefined

function equalizeRows(): void {
  const opened = Array.from(document.querySelectorAll<HTMLDetailsElement>('.grid details[open]'))
  opened.forEach((d) => (d.open = false))

  const cards = Array.from(document.querySelectorAll<HTMLElement>('.grid .card'))
  cards.forEach((c) => (c.style.minHeight = ''))

  const rows = new Map<number, HTMLElement[]>()
  for (const card of cards) {
    const key = card.offsetTop
    const list = rows.get(key)
    if (list) list.push(card)
    else rows.set(key, [card])
  }

  for (const list of rows.values()) {
    const max = Math.max(...list.map((c) => c.offsetHeight))
    for (const card of list) card.style.minHeight = `${max}px`
  }

  opened.forEach((d) => (d.open = true))
}

function scheduleEqualize(): void {
  if (equalizeTimer !== undefined) window.clearTimeout(equalizeTimer)
  equalizeTimer = window.setTimeout(() => {
    void nextTick(equalizeRows)
  }, 60)
}
function readUrl(): void {
  const source = String(route.query.source ?? 'all') as SourceFilter
  const kind = String(route.query.kind ?? 'all') as KindFilter
  if (SOURCE_OPTIONS.some((o) => o.id === source)) sourceFilter.value = source
  if (KIND_OPTIONS.some((o) => o.id === kind)) kindFilter.value = kind
  const raw = String(route.query.compare ?? '')
  compareIds.value = raw ? raw.split(',').filter(Boolean).slice(0, MAX_COMPARE) : []
}

function writeUrl(): void {
  const query: Record<string, string> = {}
  if (sourceFilter.value !== 'all') query.source = sourceFilter.value
  if (kindFilter.value !== 'all') query.kind = kindFilter.value
  if (compareIds.value.length) query.compare = compareIds.value.join(',')
  void router.replace({ query })
}

watch([sourceFilter, kindFilter, compareIds], writeUrl, { deep: true })

watch([sourceFilter, kindFilter], () => {
  void nextTick(scheduleEqualize)
})
async function applyRate(): Promise<void> {
  const value = Number(rateDraft.value)
  if (!Number.isFinite(value) || value <= 0) {
    saveHint.value = '请输入大于 0 的数字'
    return
  }
  saving.value = true
  saveHint.value = ''
  try {
    await store.setRate(value)
    saveHint.value = '已更新，全站数值已重算'
  } catch (cause) {
    saveHint.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="exchange container">
    <header class="hero">
      <img class="hero__art" src="/art/hero-holo.webp" alt="" aria-hidden="true" />
      <div class="hero__copy">
        <p class="hero__eyebrow display">赫萝的货币兑换所</p>
        <h1 class="hero__title">一枚银币，能换多少「词」？</h1>
        <p class="hero__lede">
          同样是一元人民币，在有的模型里能换来近百万 token，在高价模型里只够写一封信。
          这里是各家的牌价。
        </p>
      </div>
    </header>

    <p v-if="store.loading" class="state">正在从账房取账本…</p>
    <p v-else-if="store.error" class="state state--error">{{ store.error }}</p>

    <template v-else>
      <!-- 汇率栏：唯一可改的数字，全站由它派生 -->
      <section class="rate" aria-label="汇率设置">
        <div class="rate__label">
          <span class="rate__title">赫萝的行情牌</span>
          <span class="rate__sub">{{ store.data?.meta.rateNote }}</span>
        </div>
        <div class="rate__control">
          <span class="rate__unit">1 美元 =</span>
          <input
            v-model.number="rateDraft"
            class="rate__input"
            type="number"
            step="0.01"
            min="0.01"
            inputmode="decimal"
            aria-label="美元兑人民币汇率"
            @keyup.enter="applyRate"
          />
          <span class="rate__unit">元</span>
          <button class="rate__button" type="button" :disabled="saving" @click="applyRate">
            {{ saving ? '记账中…' : '记入账本' }}
          </button>
        </div>
        <p class="rate__hint">
          <span>
            {{ saveHint || `牌价核对于 ${store.data?.meta.lastUpdated}` }}
            <b v-if="dataIsStale" class="stale">牌价已旧，客人自辨</b>
          </span>
          <span class="rate__date">汇率取自 {{ store.data?.meta.rateDate }}</span>
        </p>
      </section>

      <!-- 筛选：只保留看得清的那几家 -->
      <section class="filters" aria-label="筛选">
        <div class="filters__row">
          <span class="filters__label">来源</span>
          <button
            v-for="opt in SOURCE_OPTIONS"
            :key="opt.id"
            class="chip"
            :class="{ 'chip--on': sourceFilter === opt.id }"
            type="button"
            :aria-pressed="sourceFilter === opt.id"
            @click="sourceFilter = opt.id"
          >
            {{ opt.label }}
          </button>
        </div>
        <div class="filters__row">
          <span class="filters__label">类型</span>
          <button
            v-for="opt in KIND_OPTIONS"
            :key="opt.id"
            class="chip"
            :class="{ 'chip--on': kindFilter === opt.id }"
            type="button"
            :aria-pressed="kindFilter === opt.id"
            @click="kindFilter = opt.id"
          >
            {{ opt.label }}
          </button>
        </div>
        <p class="filters__count">
          本所现挂 <b>{{ visibleApi.length }}</b> 家按量牌价 ·
          <b>{{ visiblePlans.length }}</b> 份套餐契约
        </p>
      </section>
      <!-- 按量计费：官方 API 与聚合平台 -->
      <section v-if="showProviders" class="board">
        <WheatDivider />

        <div class="board__head">
          <h2 class="board__title">按量计费</h2>
          <p class="board__desc">
            用多少付多少，价格透明可算。聚合平台的价格 = 各家官方价 + 平台费。
          </p>
        </div>

        <div class="grid grid--providers">
          <article
            v-for="provider in visibleApi"
            :key="provider.id"
            class="card"
            :class="{ 'card--champion': champion && provider.id === champion.id }"
          >
            <p v-if="champion && provider.id === champion.id" class="card__ribbon">
              最划算的一桩买卖
            </p>
            <header class="card__head">
              <h3 class="card__name">{{ provider.name }}</h3>
              <span class="tag">{{ provider.tag }}</span>
            </header>

            <button
              class="cmp"
              :class="{ 'cmp--on': isComparing(provider.id) }"
              type="button"
              :aria-pressed="isComparing(provider.id)"
              :aria-label="`将 ${provider.name} 加入对照`"
              @click="toggleCompare(provider.id)"
            >
              <span class="cmp__box" aria-hidden="true"></span>
              对照
            </button>

            <div class="card__cred">
              <p v-if="provider.verified === false" class="tag tag--warn">
                <span class="seal" aria-hidden="true"></span>
                第三方整理 · 未与官方核对
              </p>
            </div>

            <p v-if="provider.note" class="card__note" :title="provider.note">
              {{ provider.note }}
            </p>

            <p v-if="provider.pending || provider.models.length === 0" class="card__pending">
              这家的价目还没上牌
            </p>

            <template v-else>
              <div class="rows">
                <div v-for="kind in KINDS" :key="kind" class="row">
                  <span class="row__label">{{ kindLabel(kind) }}</span>
                  <span class="row__value">
                    1 元 ≈ <b>{{ formatTokens(tokensFor(provider, kind)) }}</b> token
                  </span>
                </div>
              </div>
              <p class="card__foot">
                <span v-if="multipleOf(provider)" class="card__multiple">
                  <svg
                    class="icon-scale"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M12 4.5v14.5" />
                    <path d="M7 19h10" />
                    <path d="M3.5 8h17" />
                    <path d="M3.5 8 1.5 12.5h4z" />
                    <path d="M20.5 8l-2 4.5h4z" />
                  </svg>
                  最划算的一家，能换到它的 {{ multipleOf(provider) }}
                </span>
                <span
                  v-else-if="champion && provider.id === champion.id"
                  class="card__multiple card__multiple--self"
                >
                  本所最划算的一家，就是它
                </span>
                <span v-else class="card__multiple card__multiple--blank" aria-hidden="true"
                  >&nbsp;</span
                >
                <span class="card__src">
                  按 {{ modelFor(provider, 'output') }} 折算 ·
                  <a :href="provider.sourceUrl" target="_blank" rel="noopener noreferrer">
                    官方定价页</a
                  >
                  <template v-if="provider.lastChecked"> · {{ provider.lastChecked }}</template>
                </span>
              </p>
            </template>
          </article>
        </div>
      </section>

      <!-- 订阅套餐：官方不标 token 价，只能按额度估算 -->
      <section v-if="showPlans" class="board">
        <WheatDivider />

        <div class="board__head">
          <h2 class="board__title">订阅套餐</h2>
          <p class="board__desc">
            月费制，官方<b>不按 token 标价</b>，额度以请求数或美元用量表示。
            下面的数字是<b>估算</b>：把每月额度折算成 token 后再摊到 1 元上。
          </p>
        </div>

        <div class="grid grid--plans">
          <article
            v-for="plan in visiblePlans"
            :key="plan.id"
            class="card"
            :class="{
              'card--champion': bestPlanLeverage > 0 && planLeverage(plan) === bestPlanLeverage,
            }"
          >
            <header class="card__head">
              <h3 class="card__name">{{ plan.name }}</h3>
              <span class="tag">{{ plan.vendorName }}</span>
            </header>

            <button
              class="cmp"
              :class="{ 'cmp--on': isComparing(plan.id) }"
              type="button"
              :aria-pressed="isComparing(plan.id)"
              :aria-label="`将 ${plan.name} 加入对照`"
              @click="toggleCompare(plan.id)"
            >
              <span class="cmp__box" aria-hidden="true"></span>
              对照
            </button>

            <div class="card__cred">
              <p v-if="plan.verified === false" class="tag tag--warn">
                <span class="seal" aria-hidden="true"></span>
                第三方整理 · 未与官方核对
              </p>
            </div>

            <p v-if="plan.note" class="card__note" :title="plan.note">{{ plan.note }}</p>

            <p v-if="plan.pending || !plan.price" class="card__pending">这家的价目还没上牌</p>

            <template v-else>
              <p class="plan__price">
                <b>{{ formatPlanPrice(plan) }}</b> / 月
                <span
                  v-if="plan.price.currency === 'USD' && planMonthlyCny(plan)"
                  class="plan__cny"
                >
                  ≈ {{ formatCny(planMonthlyCny(plan) ?? 0) }}
                </span>
              </p>

              <p v-if="plan.listPrice" class="plan__list">
                标价 {{ formatCny(plan.listPrice) }} / 月
              </p>

              <p v-if="plan.quota" class="plan__quota">
                额度 <b>{{ quotaText(plan) }}</b>
              </p>

              <p v-if="planLeverage(plan)" class="plan__leverage">
                每月额度杠杆 <b>×{{ planLeverage(plan)?.toFixed(1) }}</b>
                <span class="plan__hint"
                  >（花 1 元，换到价值约 {{ planLeverage(plan)?.toFixed(1) }} 元的用量）</span
                >
              </p>

              <details v-if="plan.limits.length" class="plan__details">
                <summary>额度明细（{{ plan.limits.length }} 个模型）</summary>
                <ul>
                  <li v-for="limit in plan.limits" :key="limit.model">
                    <span>{{ limit.model }}</span>
                    <span class="plan__figures">
                      <template v-if="limit.free">免费</template>
                      <template v-else>
                        {{ limit.reqPer5h?.toLocaleString('zh-CN') }} 次/5h ·
                        {{ formatUsd(limit.monthlyUsageUsd ?? 0) }}/月
                      </template>
                    </span>
                  </li>
                </ul>
              </details>

              <p class="card__foot">
                <span class="card__src">
                  <a :href="plan.sourceUrl" target="_blank" rel="noopener noreferrer">官方页面</a>
                  <template v-if="plan.lastChecked"> · 核对于 {{ plan.lastChecked }}</template>
                </span>
              </p>
            </template>
          </article>
        </div>
      </section>

      <p class="disclaimer">{{ store.data?.meta.disclaimer }}</p>

      <!-- 对照托盘：选了才出现，位置抬在商队马车之上 -->
      <Transition name="tray">
        <div v-if="compareIds.length" class="tray" role="region" aria-label="对照托盘">
          <span class="tray__count"
            >已选 <b>{{ compareIds.length }}</b> / {{ MAX_COMPARE }}</span
          >
          <span class="tray__names">{{ compareItems.map((i) => i.name).join(' · ') }}</span>
          <button
            class="tray__go"
            type="button"
            :disabled="compareIds.length < 2"
            @click="compareOpen = true"
          >
            铺开对照
          </button>
          <button class="tray__clear" type="button" @click="clearCompare">清空</button>
        </div>
      </Transition>
    </template>

    <CompareOverlay
      v-if="compareOpen && compareItems.length >= 2"
      :items="compareItems"
      :metrics="METRICS"
      @close="compareOpen = false"
      @remove="removeCompare"
    />

    <BackToTop />
  </div>
</template>

<style scoped>
.exchange {
  padding-block: clamp(2rem, 5vw, 3.5rem) 1rem;
}

/* ---------- 页首 ---------- */
.hero {
  position: relative;
  display: flex;
  align-items: center;
  min-height: clamp(16rem, 36vw, 26rem);
  margin-bottom: clamp(2rem, 4vw, 3rem);
  padding: clamp(1.5rem, 4vw, 3rem);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: var(--ink-900);
}

.hero__art {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: 72% 10%;
}

.hero::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    rgba(13, 10, 18, 0.95) 0%,
    rgba(13, 10, 18, 0.82) 38%,
    rgba(13, 10, 18, 0.34) 68%,
    rgba(13, 10, 18, 0) 100%
  );
}

.hero__copy {
  position: relative;
  z-index: 1;
  max-width: 33rem;
}

.hero__eyebrow {
  font-size: 0.78rem;
  letter-spacing: 0.4em;
  color: var(--wheat-500);
  text-transform: uppercase;
}

.hero__title {
  margin-top: 0.6rem;
  font-family: var(--font-heading);
  font-size: clamp(1.9rem, 4.4vw, 3rem);
  line-height: 1.25;
  color: var(--parchment-50);
}

.hero__lede {
  margin-top: 1rem;
  color: var(--text-muted);
  line-height: 1.9;
}

/* ---------- 汇率栏 ---------- */
.rate {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 1rem 2rem;
  padding: 1.1rem 1.4rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: linear-gradient(120deg, rgba(233, 185, 92, 0.09), rgba(233, 185, 92, 0.02));
  box-shadow: var(--shadow-sm);
}

.rate__label {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.rate__title {
  font-family: var(--font-heading);
  letter-spacing: 0.16em;
  color: var(--wheat-300);
}

.rate__sub {
  font-size: 0.78rem;
  color: var(--text-dim);
}

.rate__control {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.rate__unit {
  font-size: 0.9rem;
  color: var(--text-muted);
}

.rate__input {
  width: 7.5rem;
  padding: 0.55rem 0.7rem;
  border: 1px solid rgba(224, 169, 68, 0.35);
  border-radius: var(--radius-sm);
  background: rgba(13, 10, 18, 0.6);
  color: var(--wheat-300);
  font-family: var(--font-mono);
  font-size: 1rem;
  text-align: center;
}

.rate__button {
  padding: 0.55rem 1.1rem;
  border: 1px solid rgba(224, 169, 68, 0.4);
  border-radius: var(--radius-sm);
  background: rgba(233, 185, 92, 0.14);
  color: var(--wheat-300);
  font-size: 0.9rem;
  cursor: pointer;
  transition: background 0.2s ease;
}

.rate__button:hover:not(:disabled) {
  background: rgba(233, 185, 92, 0.24);
}

.rate__button:disabled {
  opacity: 0.6;
  cursor: progress;
}

.rate__hint {
  flex-basis: 100%;
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.76rem;
  color: var(--text-dim);
}

.rate__date {
  font-family: var(--font-mono);
}

/* ---------- 牌价板 ---------- */
.board {
  margin-top: clamp(2.5rem, 6vw, 4rem);
}

.board__head {
  max-width: 60ch;
  margin-bottom: 1.4rem;
}

.board__title {
  font-family: var(--font-heading);
  font-size: 1.35rem;
  letter-spacing: 0.12em;
  color: var(--parchment-100);
}

.board__desc {
  margin-top: 0.5rem;
  font-size: 0.9rem;
  line-height: 1.9;
  color: var(--text-muted);
}

.board__desc b {
  color: var(--wheat-400);
  font-weight: 600;
}

.grid {
  display: grid;

  grid-template-columns: repeat(auto-fill, minmax(19rem, 1fr));
  /* 关键：卡片各自撑高，展开一张不会把同排的其他卡片一起拉长 */
  align-items: start;
  gap: 1rem;
}

/* 默认统一高度：同排卡片高度一致（数值 = 实测各卡自然高度的最大值 + 少量余量），
   配合 align-items: start，展开某一张时只有它自己变高。 */
.grid--providers .card {
  min-height: 24rem;
}

.grid--plans .card {
  min-height: 19rem;
}

/* ---------- 卡片 ---------- */
.card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  padding: 1.15rem 1.25rem;
  border: 1px solid rgba(140, 90, 28, 0.4);
  border-radius: var(--radius);
  background-color: #e7d7b8;
  background-image: url('/art/parchment.webp');
  background-size: 640px auto;
  background-blend-mode: multiply;
  /* 旧全局样式 .card 有 overflow:hidden，会把伸出卡外的绶带裁掉 */
  overflow: visible;
  box-shadow: 0 14px 34px -20px rgba(0, 0, 0, 0.85);
  color: #3d2f20;
  transition:
    border-color 0.25s ease,
    transform 0.25s ease;
}

.card:hover {
  border-color: rgba(224, 169, 68, 0.32);
  transform: translateY(-2px);
}

.card--champion {
  border-color: rgba(224, 169, 68, 0.5);
  box-shadow: var(--shadow-glow);
}

.card__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.6rem;
}

.card__name {
  font-family: var(--font-heading);
  font-size: 1.08rem;
  color: var(--parchment-50);
}

/* 火漆印：不规则红蜡块 */
.seal {
  display: inline-block;
  width: 9px;
  height: 9px;
  margin-right: 5px;
  vertical-align: -1px;
  border-radius: 52% 46% 54% 48%;
  background: radial-gradient(circle at 34% 30%, #c9603f, #8a2f20 62%, #5f1d13);
  box-shadow:
    inset 0 1px 1px rgba(255, 226, 205, 0.45),
    0 1px 2px rgba(0, 0, 0, 0.45);
}

.icon-scale {
  width: 1.05em;
  height: 1.05em;
  margin-right: 0.35em;
  vertical-align: -0.18em;
  color: #a8452f;
}

.tag--warn {
  align-self: flex-start;
  border-color: rgba(176, 67, 47, 0.5);
  background: rgba(176, 67, 47, 0.12);
  color: #a8452f;
  letter-spacing: 0.04em;
}

.tag {
  flex-shrink: 0;
  padding: 0.15rem 0.55rem;
  border: 1px solid rgba(224, 169, 68, 0.3);
  border-radius: 999px;
  font-size: 0.68rem;
  letter-spacing: 0.08em;
  color: var(--wheat-500);
  white-space: nowrap;
}

.card__note {
  font-size: 0.76rem;
  line-height: 1.8;
  color: var(--text-dim);
}

.card__pending {
  padding: 0.9rem 0;
  font-size: 0.85rem;
  color: var(--text-dim);
  font-style: italic;
}

.rows {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.6rem;
  padding-bottom: 0.4rem;
  border-bottom: 1px dashed rgba(224, 169, 68, 0.14);
}

.row:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.row__label {
  font-size: 0.78rem;
  color: var(--text-dim);
  white-space: nowrap;
}

.row__value {
  font-size: 0.84rem;
  color: var(--text-muted);
  text-align: right;
}

.row__value b {
  font-family: var(--font-mono);
  font-size: 1rem;
  color: var(--wheat-300);
}

.card__foot {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: 0.72rem;
  line-height: 1.7;
  color: var(--text-dim);
}

.card__multiple {
  /* 其他卡的这行会折成两行（32px），冠军卡那句只有一行；
     锁一个最小高度，保证整张卡高度一致 */
  min-height: 2rem;
  color: var(--crimson-400);
}

.card__src a {
  color: var(--text-muted);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.card__src a:hover {
  color: var(--wheat-300);
}

/* ---------- 套餐专属 ---------- */
.plan__price {
  font-size: 0.92rem;
  color: var(--text-muted);
}

.plan__price b {
  font-family: var(--font-mono);
  font-size: 1.5rem;
  color: var(--wheat-300);
}

.plan__cny {
  font-family: var(--font-mono);
  font-size: 0.82rem;
  color: var(--text-dim);
}

.plan__list {
  font-size: 0.74rem;
  color: var(--text-dim);
  text-decoration: line-through;
  text-decoration-color: rgba(208, 95, 74, 0.6);
}

.plan__quota {
  font-size: 0.84rem;
  color: var(--text-muted);
}

.plan__quota b {
  font-family: var(--font-mono);
  color: var(--wheat-300);
}

.plan__leverage {
  font-size: 0.84rem;
  color: var(--text-muted);
}

.plan__leverage b {
  font-family: var(--font-mono);
  color: var(--wheat-300);
}

.plan__hint {
  display: block;
  margin-top: 0.2rem;
  font-size: 0.72rem;
  color: var(--text-dim);
}

.plan__details {
  font-size: 0.78rem;
}

.plan__details summary {
  cursor: pointer;
  color: var(--text-muted);
}

.plan__details summary:hover {
  color: var(--wheat-300);
}

.plan__details ul {
  margin-top: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  max-height: 15rem;
  overflow-y: auto;
  padding-right: 0.5rem;
  /* Firefox */
  scrollbar-width: thin;
  scrollbar-color: rgba(140, 90, 28, 0.55) rgba(140, 90, 28, 0.1);
}

/* WebKit：把系统滚动条换成羊皮纸/黄铜细条 */
.plan__details ul::-webkit-scrollbar {
  width: 7px;
}

.plan__details ul::-webkit-scrollbar-track {
  background: rgba(140, 90, 28, 0.1);
  border-radius: 999px;
}

.plan__details ul::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(176, 125, 38, 0.65), rgba(140, 90, 28, 0.75));
  border: 1px solid rgba(120, 76, 20, 0.35);
}

.plan__details ul::-webkit-scrollbar-thumb:hover {
  background: linear-gradient(180deg, rgba(200, 145, 50, 0.8), rgba(160, 105, 32, 0.9));
}

.plan__details li {
  display: flex;
  justify-content: space-between;
  gap: 0.6rem;
  color: var(--text-dim);
}

.plan__figures {
  font-family: var(--font-mono);
  color: var(--text-muted);
  white-space: nowrap;
}

/* ---------- 状态 ---------- */
.state {
  padding: 2rem 0;
  color: var(--text-muted);
}

.state--error {
  color: var(--danger);
}

.disclaimer {
  margin-top: clamp(2.5rem, 6vw, 4rem);
  padding-top: 1.2rem;
  border-top: 1px solid var(--border);
  font-size: 0.76rem;
  line-height: 1.9;
  color: var(--text-dim);
}

/* ---------- 羊皮纸牌价：卡片内文字翻成墨色 ---------- */
.card__name {
  color: #2b1e10;
}

.card__note {
  color: #6d5a42;
}

.card__pending {
  color: #83705a;
}

.card__foot {
  color: #6d5a42;
}

.card__src a {
  color: #6d5a42;
}

.card__src a:hover {
  color: #9a5f12;
}

.card__multiple {
  /* 其他卡的这行会折成两行（32px），冠军卡那句只有一行；
     锁一个最小高度，保证整张卡高度一致 */
  min-height: 2rem;
  color: #a8452f;
}

.card__ribbon {
  /* 绝对定位钉在卡片左上角：它不参与文档流，所以不会把同一排其他卡片的内容推下去 */
  position: absolute;
  top: -0.72rem;
  left: 1.1rem;
  z-index: 2;
  padding: 0.16rem 0.6rem;
  border-radius: 999px;
  background: linear-gradient(120deg, #b0432f, #8a2f20);
  color: #fbe9d8;
  font-size: 0.68rem;
  letter-spacing: 0.12em;
  box-shadow: 0 4px 12px -6px rgba(138, 47, 32, 0.9);
}

.card--champion {
  border-color: rgba(176, 67, 47, 0.6);
  box-shadow:
    0 0 0 1px rgba(176, 67, 47, 0.35),
    0 20px 44px -22px rgba(0, 0, 0, 0.9);
}

.row {
  border-bottom-color: rgba(140, 90, 28, 0.24);
}

.row__label {
  color: #6d5a42;
}

.row__value {
  color: #4a3a28;
}

.row__value b {
  color: #9a5f12;
}

/* 火漆印：不规则红蜡块 */
.seal {
  display: inline-block;
  width: 9px;
  height: 9px;
  margin-right: 5px;
  vertical-align: -1px;
  border-radius: 52% 46% 54% 48%;
  background: radial-gradient(circle at 34% 30%, #c9603f, #8a2f20 62%, #5f1d13);
  box-shadow:
    inset 0 1px 1px rgba(255, 226, 205, 0.45),
    0 1px 2px rgba(0, 0, 0, 0.45);
}

.icon-scale {
  width: 1.05em;
  height: 1.05em;
  margin-right: 0.35em;
  vertical-align: -0.18em;
  color: #a8452f;
}

.tag--warn {
  align-self: flex-start;
  border-color: rgba(176, 67, 47, 0.5);
  background: rgba(176, 67, 47, 0.12);
  color: #a8452f;
  letter-spacing: 0.04em;
}

.tag {
  color: #8a5a10;
  border-color: rgba(140, 90, 28, 0.45);
  background: rgba(255, 255, 255, 0.34);
}

.plan__price {
  color: #4a3a28;
}

.plan__price b {
  color: #9a5f12;
}

.plan__cny {
  color: #83705a;
}

.plan__list {
  color: #83705a;
}

.plan__quota {
  color: #4a3a28;
}

.plan__quota b {
  color: #9a5f12;
}

.plan__leverage {
  color: #4a3a28;
}

.plan__leverage b {
  color: #9a5f12;
}

.plan__hint {
  color: #83705a;
}

.plan__details summary {
  color: #4a3a28;
}

.plan__details summary:hover {
  color: #9a5f12;
}

.plan__details li {
  color: #6d5a42;
}

.plan__figures {
  color: #4a3a28;
}

/* 陈旧提示 */
.stale {
  margin-left: 0.5rem;
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  background: rgba(176, 67, 47, 0.18);
  border: 1px solid rgba(176, 67, 47, 0.5);
  color: var(--crimson-400);
  font-size: 0.72rem;
  font-weight: 400;
}
/* ---------- 筛选栏 ---------- */
.filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 1.4rem;
  margin-top: 1rem;
  padding: 0.7rem 1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: rgba(20, 16, 25, 0.62);
  backdrop-filter: blur(6px);
}

.filters__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
}

.filters__label {
  margin-right: 0.2rem;
  font-size: 0.74rem;
  letter-spacing: 0.14em;
  color: var(--text-dim);
}

.chip {
  padding: 0.28rem 0.7rem;
  border: 1px solid rgba(224, 169, 68, 0.28);
  border-radius: 999px;
  background: transparent;
  color: var(--text-muted);
  font-size: 0.78rem;
  cursor: pointer;
  transition:
    background 0.18s ease,
    border-color 0.18s ease,
    color 0.18s ease;
}

.chip:hover {
  border-color: rgba(233, 185, 92, 0.55);
  color: var(--parchment-100);
}

.chip--on {
  border-color: rgba(233, 185, 92, 0.75);
  background: rgba(233, 185, 92, 0.18);
  color: var(--wheat-300);
}

.chip:focus-visible {
  outline: 2px solid var(--wheat-400);
  outline-offset: 2px;
}

.filters__count {
  flex-basis: 100%;
  font-size: 0.74rem;
  color: var(--text-dim);
}

.filters__count b {
  font-family: var(--font-mono);
  color: var(--wheat-300);
}

/* ---------- 对照开关（位于羊皮纸卡内，用墨色） ---------- */
.cmp {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.22rem 0.7rem;
  border: 1px solid rgba(140, 90, 28, 0.45);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.28);
  color: #6d5a42;
  font-size: 0.75rem;
  cursor: pointer;
  transition:
    background 0.18s ease,
    color 0.18s ease,
    border-color 0.18s ease;
}

.cmp:hover {
  border-color: rgba(140, 90, 28, 0.75);
  color: #8a5a10;
}

.cmp:focus-visible {
  outline: 2px solid #9a5f12;
  outline-offset: 2px;
}

.cmp__box {
  position: relative;
  width: 11px;
  height: 11px;
  border: 1.5px solid rgba(140, 90, 28, 0.7);
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.5);
}

.cmp--on {
  border-color: #8a2f20;
  background: rgba(176, 67, 47, 0.14);
  color: #8a2f20;
}

.cmp--on .cmp__box {
  border-color: #8a2f20;
  background: #a8452f;
}

.cmp--on .cmp__box::after {
  content: '';
  position: absolute;
  left: 2px;
  top: 3px;
  width: 5px;
  height: 2px;
  border-left: 1.5px solid #fbe9d8;
  border-bottom: 1.5px solid #fbe9d8;
  transform: rotate(-45deg);
}

/* ---------- 对照托盘 ---------- */
.tray {
  position: fixed;
  left: 50%;
  bottom: 104px;
  z-index: 46;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 0.9rem;
  max-width: min(92vw, 900px);
  padding: 0.55rem 0.9rem;
  border: 1px solid rgba(224, 169, 68, 0.45);
  border-radius: 999px;
  background: rgba(20, 16, 25, 0.9);
  backdrop-filter: blur(12px) saturate(140%);
  box-shadow: 0 14px 34px -18px rgba(0, 0, 0, 0.9);
  color: var(--text-muted);
  font-size: 0.8rem;
}

.tray__count b {
  font-family: var(--font-mono);
  color: var(--wheat-300);
}

.tray__names {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--text-dim);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tray__go {
  flex-shrink: 0;
  padding: 0.34rem 0.9rem;
  border: 1px solid rgba(233, 185, 92, 0.6);
  border-radius: 999px;
  background: rgba(233, 185, 92, 0.18);
  color: var(--wheat-300);
  cursor: pointer;
}

.tray__go:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.tray__clear {
  flex-shrink: 0;
  padding: 0.34rem 0.7rem;
  border: 1px solid rgba(224, 169, 68, 0.3);
  border-radius: 999px;
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
}

.tray__clear:hover {
  color: var(--parchment-100);
}

.tray-enter-active,
.tray-leave-active {
  transition:
    opacity 0.24s ease,
    transform 0.24s ease;
}

.tray-enter-from,
.tray-leave-to {
  opacity: 0;
  transform: translate(-50%, 12px);
}
/* 全局 .card::after 是矩形光晕，原来靠 overflow:hidden 裁成圆角；
   现在卡片不再裁切，所以直接给光晕继承圆角。 */
.card::after {
  border-radius: inherit;
}

.card__multiple--self {
  color: #8a5a10;
  font-weight: 600;
}
/* ---------- 卡片纵向对齐 ----------
   三处可变高度都会把下面的价格行推来推去，全部锁定：
   ① 头部只占一行（长名字省略号）
   ② 可信度角标始终占位
   ③ 说明固定 3 行高并截断（完整文字挂在 title 上）
*/
.card__head {
  min-height: 1.75rem;
}

.card__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card__cred {
  /* 与真实角标实测高度（29px）对齐，避免有/无角标差 3px */
  min-height: 1.82rem;
}

.card__note {
  display: -webkit-box;
  min-height: 4.1rem;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  line-clamp: 3;
}
@media (max-width: 760px) {
  .tray {
    bottom: 84px;
    gap: 0.5rem;
    padding: 0.5rem 0.7rem;
    font-size: 0.74rem;
  }

  .tray__names {
    display: none;
  }

  .filters {
    gap: 0.4rem 0.8rem;
  }
  .hero {
    min-height: 22rem;
    align-items: flex-end;
  }

  .hero__art {
    object-position: 62% top;
  }

  .hero::after {
    background: linear-gradient(
      180deg,
      rgba(13, 10, 18, 0.25) 0%,
      rgba(13, 10, 18, 0.8) 45%,
      rgba(13, 10, 18, 0.96) 100%
    );
  }
}

/* 竖屏手机：筛选 chip 实测 74×33、对照按钮 66×30，都撑到 44px 触控目标 */
@media (max-width: 700px) and (orientation: portrait) {
  .chip {
    min-height: var(--tap);
    padding-block: 0.5rem;
  }

  .cmp {
    min-height: var(--tap);
  }

  .filters {
    gap: 0.5rem 0.7rem;
  }
}

@media (max-width: 640px) {
  .rate__control {
    width: 100%;
  }

  .rate__input {
    flex: 1;
    width: auto;
  }

  .row {
    flex-direction: column;
    align-items: flex-start;
  }

  .row__value {
    text-align: left;
  }
}
</style>
