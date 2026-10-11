<script setup lang="ts">
/**
 * 对照台 —— 把选中的 2–4 家并排摊开，像商行里把几家的报价单铺在柜台上比。
 */
import type { CompareItem } from '@/types/pricing'

const props = defineProps<{
  items: CompareItem[]
  /** 指标行，顺序即表格行序 */
  metrics: Array<{ key: string; label: string }>
}>()

const emit = defineEmits<{ (e: 'close'): void; (e: 'remove', id: string): void }>()

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}
</script>

<template>
  <div class="compare" role="dialog" aria-modal="true" aria-label="对照台" @keydown="onKey">
    <div class="compare__scrim" @click="emit('close')"></div>

    <div class="compare__panel">
      <header class="compare__head">
        <div>
          <p class="compare__eyebrow display">商行 · 对照台</p>
          <h2 class="compare__title">把报价单铺开比</h2>
        </div>
        <button class="compare__close" type="button" aria-label="关闭对照台" @click="emit('close')">
          ✕
        </button>
      </header>

      <div class="compare__scroll">
        <table class="compare__table">
          <thead>
            <tr>
              <th class="compare__corner" scope="col">项目</th>
              <th v-for="item in props.items" :key="item.id" scope="col">
                <div class="compare__item">
                  <span class="compare__itemName">{{ item.name }}</span>
                  <span class="compare__itemVendor">{{ item.vendor }} · {{ item.kindLabel }}</span>
                  <span v-if="!item.verified" class="compare__seal">
                    <span class="seal" aria-hidden="true"></span>第三方·未核实
                  </span>
                  <button
                    class="compare__remove"
                    type="button"
                    :aria-label="`从对照中移除 ${item.name}`"
                    @click="emit('remove', item.id)"
                  >
                    移除
                  </button>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in props.metrics" :key="m.key">
              <th scope="row">{{ m.label }}</th>
              <td v-for="item in props.items" :key="item.id + m.key">
                <span :class="{ 'is-empty': !item.cells[m.key] }">
                  {{ item.cells[m.key] || '—' }}
                </span>
              </td>
            </tr>
            <tr>
              <th scope="row">官方来源</th>
              <td v-for="item in props.items" :key="item.id + 'src'">
                <a :href="item.sourceUrl" target="_blank" rel="noopener noreferrer">查看</a>
              </td>
            </tr>
            <tr>
              <th scope="row">核对日期</th>
              <td v-for="item in props.items" :key="item.id + 'date'">
                {{ item.lastChecked || '未核对' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.compare {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: clamp(0.75rem, 3vw, 2rem);
}

.compare__scrim {
  position: absolute;
  inset: 0;
  background: rgba(8, 6, 11, 0.82);
  backdrop-filter: blur(6px);
}

.compare__panel {
  position: relative;
  width: min(1180px, 100%);
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(140, 90, 28, 0.45);
  border-radius: var(--radius-lg);
  background-color: #e7d7b8;
  background-image: url('/art/parchment.webp');
  background-size: 700px auto;
  background-blend-mode: multiply;
  box-shadow: 0 30px 70px -30px rgba(0, 0, 0, 0.95);
  overflow: hidden;
}

.compare__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.1rem 1.3rem 0.9rem;
  border-bottom: 1px solid rgba(140, 90, 28, 0.3);
}

.compare__eyebrow {
  font-size: 0.68rem;
  letter-spacing: 0.34em;
  color: #9a5f12;
  text-transform: uppercase;
}

.compare__title {
  margin-top: 0.25rem;
  font-family: var(--font-heading);
  font-size: 1.25rem;
  color: #2b1e10;
}

.compare__close {
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  border: 1px solid rgba(140, 90, 28, 0.4);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.35);
  color: #6d4a12;
  cursor: pointer;
}

.compare__close:hover {
  background: rgba(255, 255, 255, 0.6);
}

.compare__scroll {
  overflow: auto;
  padding: 0 1.3rem 1.3rem;
  scrollbar-width: thin;
  scrollbar-color: rgba(140, 90, 28, 0.55) rgba(140, 90, 28, 0.1);
}

.compare__scroll::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.compare__scroll::-webkit-scrollbar-track {
  background: rgba(140, 90, 28, 0.1);
}

.compare__scroll::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(140, 90, 28, 0.55);
}

.compare__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.84rem;
  color: #3d2f20;
}

.compare__table th,
.compare__table td {
  padding: 0.55rem 0.7rem;
  text-align: left;
  vertical-align: top;
  border-bottom: 1px dashed rgba(140, 90, 28, 0.25);
}

.compare__table thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: rgba(231, 215, 184, 0.97);
  border-bottom: 1px solid rgba(140, 90, 28, 0.4);
  vertical-align: bottom;
}

.compare__corner,
.compare__table tbody th {
  font-weight: 400;
  color: #6d5a42;
  white-space: nowrap;
}

.compare__item {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 9rem;
}

.compare__itemName {
  font-family: var(--font-heading);
  font-size: 0.98rem;
  color: #2b1e10;
}

.compare__itemVendor {
  font-size: 0.7rem;
  color: #83705a;
}

.compare__seal {
  font-size: 0.68rem;
  color: #a8452f;
}

.compare__remove {
  align-self: flex-start;
  margin-top: 0.2rem;
  padding: 0.1rem 0.5rem;
  border: 1px solid rgba(140, 90, 28, 0.4);
  border-radius: 999px;
  background: transparent;
  color: #8a5a10;
  font-size: 0.68rem;
  cursor: pointer;
}

.compare__remove:hover {
  background: rgba(255, 255, 255, 0.4);
}

.compare__table td span {
  font-family: var(--font-mono);
}

.compare__table td .is-empty {
  font-family: inherit;
  color: #a1968a;
}

.compare__table a {
  color: #8a5a10;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.seal {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 4px;
  vertical-align: -1px;
  border-radius: 52% 46% 54% 48%;
  background: radial-gradient(circle at 34% 30%, #c9603f, #8a2f20 62%, #5f1d13);
}
</style>
