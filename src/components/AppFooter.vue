<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const year = new Date().getFullYear()

const links = [
  { to: '/', label: '旅途回忆录' },
  { to: '/market', label: '商行 · 牌价板' },
]
/** 账本页要换一套说法：底部不能再读起来像牌价板 */
const isLedger = computed(() => route.name === 'ledger')

const desc = computed(() =>
  isLedger.value
    ? '一本记着各处 API 契约结余的账：谁家还有余额，谁家额度快见底，翻开便知。'
    : '1 元人民币，能在各家大模型 API 与订阅套餐里换到多少 token？',
)

const quote = computed(() =>
  isLedger.value
    ? '行商的规矩 —— 欠了谁、余下多少，都要写明白；日子记准了，下一程才好盘算。'
    : '行商的规矩 —— 账要自己记，秤要自己校。所以这上面每个数字旁边，都写着核对的日期。',
)

const note = computed(() =>
  isLedger.value
    ? '余额由各厂商接口实时查询，仅供参考，请以各厂商官方账单为准。'
    : '价格数据为人工录入，非实时行情，请以各厂商官方页面为准。',
)
</script>

<template>
  <footer class="footer">
    <div class="container footer__inner">
      <div class="footer__brand">
        <p class="footer__title display">Spice &amp; Wolf</p>
        <p class="footer__sub">商人と賢狼の旅</p>
        <p class="footer__desc">{{ desc }}</p>
        <p class="footer__quote">{{ quote }}</p>
      </div>

      <nav class="footer__nav" aria-label="页脚导航">
        <RouterLink v-for="link in links" :key="link.to" :to="link.to" class="footer__link">
          {{ link.label }}
        </RouterLink>
      </nav>
    </div>

    <div class="container">
      <div class="footer__rule rule">
        <span class="rule__mark">✦ ✦ ✦</span>
      </div>
      <p class="footer__note">
        本站为非官方粉丝作品，与原作及动画制作委员会无隶属关系。《狼と香辛料》版权归
        <span>支倉凍砂 / KADOKAWA</span> 及各自权利人所有。
      </p>
      <p class="footer__note footer__note--dim">
        {{ note }} © {{ year }} Spice &amp; Wolf Fan Site.
      </p>
    </div>
  </footer>
</template>

<style scoped>
.footer {
  margin-top: clamp(3rem, 8vw, 6rem);
  padding-block: clamp(2.5rem, 5vw, 4rem) 2.5rem;
  border-top: 1px solid var(--border);
  background: linear-gradient(180deg, rgba(13, 10, 18, 0.4), rgba(13, 10, 18, 0.9));
}

.footer__inner {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 2rem;
}

.footer__title {
  font-size: 1.15rem;
  color: var(--wheat-400);
  letter-spacing: 0.22em;
}

.footer__sub {
  margin-top: 0.3rem;
  font-family: var(--font-serif);
  font-style: italic;
  color: var(--text-muted);
  letter-spacing: 0.12em;
}

.footer__quote {
  margin-top: 0.75rem;
  max-width: 36ch;
  font-family: var(--font-serif);
  font-style: italic;
  font-size: 0.86rem;
  line-height: 1.9;
  color: var(--wheat-600);
}

.footer__desc {
  margin-top: 0.9rem;
  max-width: 34ch;
  font-size: 0.88rem;
  color: var(--text-dim);
}

.footer__nav {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 1.4rem;
  align-content: flex-start;
}

.footer__link {
  color: var(--text-muted);
  font-size: 0.9rem;
}

.footer__link:hover {
  color: var(--wheat-300);
}

.footer__rule {
  margin-block: 2.4rem 1.6rem;
}

.footer__note {
  font-size: 0.78rem;
  line-height: 1.9;
  color: var(--text-dim);
}

.footer__note span {
  color: var(--text-muted);
}

.footer__note--dim {
  margin-top: 0.5rem;
  opacity: 0.75;
}

/* 竖屏手机：页脚别被 Home 指示条压住，链接撑到 44px */
@media (max-width: 700px) and (orientation: portrait) {
  .footer {
    padding-bottom: calc(2.5rem + var(--safe-bottom));
  }

  .footer__nav {
    gap: 0 1.2rem;
  }

  .footer__link {
    display: inline-flex;
    align-items: center;
    min-height: var(--tap);
  }
}
</style>
