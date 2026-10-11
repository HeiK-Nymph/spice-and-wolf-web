<script setup lang="ts">
/**
 * 驿站落地页（旅伴 / 语录集）。
 * 目前是「正在布置」的驿站：把该地的原作设定、场景与后续计划如实摆出来，
 * 而不是假装已经有内容。前后站导航让用户随时沿路继续走。
 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import WheatDivider from '@/components/WheatDivider.vue'
import { orderOf, stations } from '@/data/journey'

const route = useRoute()

const station = computed(() => {
  const id = route.meta.stationId as string | undefined
  return stations.find((s) => s.id === id) ?? stations[0]
})

const index = computed(() => stations.findIndex((s) => s.id === station.value.id))
const prev = computed(() => stations[index.value - 1] ?? null)
const next = computed(() => stations[index.value + 1] ?? null)

/** 各驿站后续要铺的内容 */
const PLANS: Record<string, string[]> = {
  pasloe: [
    '赫萝与罗伦斯的档案卡（出身、行当、脾气）',
    '旅伴关系的起点：麦车上的那一场初遇',
    '官方立绘参考图 —— 按项目约定，出角色图前必须先上传对应参考图',
  ],
  nyohhira: [
    '按驿站归档的短句与随笔（原创与摘句分开标注）',
    '两人最终落脚之地的后日谈',
    '温泉旅馆的季节记事',
  ],
}

const plan = computed(() => PLANS[station.value.id] ?? ['这块驿站的内容正在路上。'])
</script>

<template>
  <div class="station container">
    <nav class="station__crumb">
      <RouterLink to="/">旅途回忆录</RouterLink>
      <span aria-hidden="true">／</span>
      <span>第 {{ orderOf(station.id) }} 站</span>
    </nav>

    <header class="station__hero">
      <p class="station__eyebrow display">{{ station.cityEn }}</p>
      <h1 class="station__title">{{ station.city }}</h1>
      <p class="station__region">{{ station.region }}</p>
    </header>

    <WheatDivider />

    <section class="station__body">
      <p class="station__scene">{{ station.scene }}</p>
      <p class="station__lore">{{ station.lore }}</p>

      <div class="station__panel">
        <p class="station__panel-title">
          <span aria-hidden="true">✦</span>
          这处驿站还在布置
        </p>
        <p class="station__panel-desc">骨架已经立好，等这一程的东西摆进来。计划中的内容：</p>
        <ul class="station__plans">
          <li v-for="item in plan" :key="item">{{ item }}</li>
        </ul>
        <RouterLink class="station__cta" to="/">回到地图，继续沿路走 →</RouterLink>
      </div>
    </section>

    <nav class="station__steps" aria-label="前后站">
      <RouterLink v-if="prev?.to" class="step" :to="prev.to">
        <span class="step__dir">← 上一站</span>
        <span class="step__city">{{ prev.city }}</span>
      </RouterLink>
      <p v-else-if="prev" class="step step--plain">
        <span class="step__dir">← 上一站</span>
        <span class="step__city">{{ prev.city }}</span>
      </p>
      <span v-else class="step step--empty"></span>

      <RouterLink v-if="next?.to" class="step step--right" :to="next.to">
        <span class="step__dir">下一站 →</span>
        <span class="step__city">{{ next.city }}</span>
      </RouterLink>
      <p v-else-if="next" class="step step--plain step--right">
        <span class="step__dir">下一站 →</span>
        <span class="step__city">{{ next.city }}</span>
      </p>
      <span v-else class="step step--empty"></span>
    </nav>
  </div>
</template>

<style scoped>
.station {
  padding-top: clamp(2rem, 5vw, 3.4rem);
  max-width: 78ch;
}

.station__crumb {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.78rem;
  letter-spacing: 0.1em;
  color: var(--text-dim);
}

.station__crumb a {
  color: var(--wheat-400);
}

.station__hero {
  margin-top: 1.4rem;
}

.station__eyebrow {
  font-size: 0.72rem;
  letter-spacing: 0.36em;
  text-transform: uppercase;
  color: var(--wheat-600);
}

.station__title {
  margin-top: 0.5rem;
  font-family: var(--font-heading);
  font-size: clamp(1.8rem, 5vw, 2.6rem);
  letter-spacing: 0.08em;
  color: var(--parchment-50);
}

.station__region {
  margin-top: 0.5rem;
  font-size: 0.86rem;
  color: var(--text-muted);
}

.station__body {
  margin-top: 1.8rem;
}

.station__scene {
  font-family: var(--font-serif);
  font-style: italic;
  font-size: 1.02rem;
  color: var(--wheat-300);
}

.station__lore {
  margin-top: 0.9rem;
  font-size: 0.92rem;
  line-height: 2.1;
  color: var(--text-muted);
}

.station__panel {
  margin-top: 2rem;
  padding: 1.3rem 1.4rem 1.5rem;
  border-radius: 12px;
  border: 1px dashed rgba(224, 169, 68, 0.34);
  background: rgba(24, 18, 11, 0.6);
}

.station__panel-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-family: var(--font-heading);
  font-size: 1.02rem;
  letter-spacing: 0.1em;
  color: var(--wheat-300);
}

.station__panel-desc {
  margin-top: 0.7rem;
  font-size: 0.84rem;
  color: var(--text-dim);
}

.station__plans {
  margin-top: 0.8rem;
  display: grid;
  gap: 0.5rem;
}

.station__plans li {
  position: relative;
  padding-left: 1.1rem;
  font-size: 0.86rem;
  line-height: 1.85;
  color: var(--text-muted);
}

.station__plans li::before {
  content: '·';
  position: absolute;
  left: 0.25rem;
  color: var(--wheat-500);
}

.station__cta {
  display: inline-block;
  margin-top: 1.2rem;
  font-size: 0.86rem;
  letter-spacing: 0.06em;
  color: var(--wheat-200);
  border-bottom: 1px solid rgba(233, 185, 92, 0.45);
  padding-bottom: 2px;
}

.station__cta:hover {
  color: var(--wheat-100);
  border-bottom-color: rgba(233, 185, 92, 0.9);
}

.station__steps {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  margin-top: 2.6rem;
  padding-top: 1.4rem;
  border-top: 1px solid var(--border);
}

.step {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.step--right {
  text-align: right;
}

.step--plain {
  opacity: 0.5;
}

.step--empty {
  flex: 1;
}

.step__dir {
  font-size: 0.68rem;
  letter-spacing: 0.16em;
  color: var(--text-dim);
}

.step__city {
  font-family: var(--font-heading);
  font-size: 1rem;
  letter-spacing: 0.06em;
  color: var(--wheat-300);
}

a.step:hover .step__city {
  color: var(--wheat-100);
}

/* ==========================================================================
   竖屏手机：这一页原来一条媒体查询都没有。
   驿站页以长文为主，手机端只修「读得清 + 点得到」两件事。
   （必须放在文件末尾：同权重时靠后覆盖前面的基础规则）
   ========================================================================== */
@media (max-width: 700px) and (orientation: portrait) {
  .station {
    padding-inline: calc(1rem + var(--safe-left)) calc(1rem + var(--safe-right));
  }

  .station__lore {
    font-size: 0.95rem;
    line-height: 1.95;
  }

  /* 面包屑返回链接实测 69×22 */
  .station__crumb a {
    display: inline-flex;
    align-items: center;
    min-height: var(--tap);
  }

  /* 实测 164×27：这条 CTA 在手机上要点得到。
     撑到 44px 高之后原来的 border-bottom 会离字太远，换成下划线。 */
  .station__cta {
    display: inline-flex;
    align-items: center;
    min-height: var(--tap);
    padding-bottom: 0;
    border-bottom: none;
    text-decoration: underline;
    text-underline-offset: 4px;
  }
}
</style>
