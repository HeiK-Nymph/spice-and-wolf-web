<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

const navItems = [
  { to: '/', label: '旅途' },
  { to: '/market', label: '牌价板' },
  { to: '/studio', label: '画坊' },
  { to: '/ledger', label: '账本' },
]

const route = useRoute()
const menuOpen = ref(false)
const scrolled = ref(false)

function onScroll() {
  scrolled.value = window.scrollY > 12
}

onMounted(() => {
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
})

watch(
  () => route.fullPath,
  () => {
    menuOpen.value = false
  },
)
</script>

<template>
  <header class="header" :class="{ 'is-scrolled': scrolled, 'is-open': menuOpen }">
    <div class="header__inner container">
      <RouterLink to="/" class="brand" aria-label="回到首页">
        <span class="brand__mark" aria-hidden="true">
          <img class="brand__logo" src="/art/logo-holo.webp" alt="" />
        </span>
        <span class="brand__text">
          <span class="brand__zh">狼与香辛料</span>
          <span class="brand__en">SPICE &amp; WOLF</span>
        </span>
      </RouterLink>

      <nav class="nav" :aria-expanded="menuOpen">
        <RouterLink v-for="item in navItems" :key="item.to" :to="item.to" class="nav__link">
          {{ item.label }}
        </RouterLink>
      </nav>

      <button
        class="menu-toggle"
        type="button"
        :aria-expanded="menuOpen"
        aria-label="切换导航菜单"
        @click="menuOpen = !menuOpen"
      >
        <span></span>
        <span></span>
      </button>
    </div>
  </header>
</template>

<style scoped>
.header {
  position: sticky;
  top: 0;
  z-index: 40;
  border-bottom: 1px solid transparent;
  transition:
    background 0.3s ease,
    border-color 0.3s ease,
    backdrop-filter 0.3s ease;
}

.header.is-scrolled,
.header.is-open {
  background: rgba(13, 10, 18, 0.82);
  backdrop-filter: blur(14px) saturate(140%);
  border-bottom-color: var(--border);
}

.header__inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  min-height: var(--header-h);
  /* 安全区：刘海屏竖屏下把内容推离圆角 / 状态栏 */
  padding-top: var(--safe-top);
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 0.7rem;
  color: var(--parchment-50);
}

.brand:hover {
  color: var(--parchment-50);
}

.brand__mark {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid rgba(224, 169, 68, 0.45);
  background: rgba(233, 185, 92, 0.08);
  color: var(--wheat-400);
  overflow: hidden;
  box-shadow:
    0 0 0 1px rgba(13, 10, 18, 0.6),
    0 4px 14px -6px rgba(224, 169, 68, 0.5);
}

.brand__logo {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.brand__text {
  display: flex;
  flex-direction: column;
  line-height: 1.15;
}

.brand__zh {
  font-family: var(--font-heading);
  font-size: 1.02rem;
  font-weight: 600;
  letter-spacing: 0.14em;
}

.brand__en {
  font-family: var(--font-display);
  font-size: 0.58rem;
  letter-spacing: 0.3em;
  color: var(--wheat-500);
}

.nav {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.nav__link {
  position: relative;
  padding: 0.5rem 0.85rem;
  border-radius: 999px;
  color: var(--text-muted);
  font-size: 0.9rem;
  letter-spacing: 0.05em;
  transition:
    color 0.22s ease,
    background 0.22s ease;
}

.nav__link:hover {
  color: var(--parchment-100);
  background: rgba(233, 185, 92, 0.08);
}

.nav__link.router-link-exact-active {
  color: var(--wheat-300);
  background: rgba(233, 185, 92, 0.12);
}

.menu-toggle {
  display: none;
  flex-direction: column;
  justify-content: center;
  gap: 5px;
  width: 42px;
  height: 42px;
  padding: 0 10px;
  border-radius: 10px;
  border: 1px solid rgba(224, 169, 68, 0.3);
}

.menu-toggle span {
  display: block;
  height: 1.5px;
  background: var(--wheat-400);
  border-radius: 2px;
  transition: transform 0.25s ease;
}

.header.is-open .menu-toggle span:first-child {
  transform: translateY(3.25px) rotate(45deg);
}

.header.is-open .menu-toggle span:last-child {
  transform: translateY(-3.25px) rotate(-45deg);
}

@media (max-width: 860px) {
  .menu-toggle {
    display: flex;
  }

  .nav {
    position: absolute;
    inset: var(--header-h) 0 auto 0;
    flex-direction: column;
    align-items: stretch;
    gap: 0.15rem;
    padding: 0.75rem clamp(1.1rem, 4vw, 2.5rem) 1.1rem;
    background: rgba(13, 10, 18, 0.96);
    backdrop-filter: blur(14px);
    border-bottom: 1px solid var(--border);
    transform-origin: top;
    transform: scaleY(0.92);
    opacity: 0;
    visibility: hidden;
    transition:
      opacity 0.22s ease,
      transform 0.22s ease,
      visibility 0.22s;
  }

  .header.is-open .nav {
    opacity: 1;
    visibility: visible;
    transform: scaleY(1);
  }

  .nav__link {
    padding: 0.7rem 0.9rem;
    border-radius: 10px;
    font-size: 0.95rem;
  }
}

/* 竖屏手机：展开的导航要能滚动（菜单项挨个都是 44px 触控目标），
   并且不吃地址栏 —— 高度按 dvh 算，底部留出安全区 */
@media (max-width: 700px) and (orientation: portrait) {
  .header__inner {
    padding-inline: calc(1rem + var(--safe-left)) calc(1rem + var(--safe-right));
  }

  .menu-toggle {
    min-width: var(--tap);
    min-height: var(--tap);
    width: var(--tap);
    height: var(--tap);
  }

  .nav {
    max-height: calc(100dvh - var(--header-h) - var(--safe-top));
    overflow-y: auto;
    overscroll-behavior: contain;
    padding-bottom: calc(1.1rem + var(--safe-bottom));
  }

  .nav__link {
    min-height: var(--tap);
    display: flex;
    align-items: center;
  }

  /* 品牌链接实测 40px 高，撑到 44px 的触控目标 */
  .brand {
    min-height: var(--tap);
  }
}
</style>
