<script setup lang="ts">
/**
 * 全屏视差背景 —— 随滚动从「夜路」走到「商行账房」。
 *
 * 叙事：页顶是黄昏商路（罗伦斯刚谈完生意走出商行），
 * 往下滚相当于推门进屋，进入摆着账本、天平与蜡印契约的商行柜台。
 * 过渡中点有一记暖光晕，模拟门槛处透出的灯火。
 *
 * 全部由 CSS scroll() 时间轴驱动（合成层，不触发重排）；
 * prefers-reduced-motion 与移动端自动降级为静态画面。
 */
</script>

<template>
  <div class="scene" aria-hidden="true">
    <!-- 第一幕：夜路 -->
    <div class="scene__road"></div>
    <!-- 第二幕：商行账房 -->
    <div class="scene__shop"></div>
    <!-- 门槛处的暖光 -->
    <div class="scene__threshold"></div>
    <!-- 浮尘光晕 -->
    <div class="scene__haze"></div>
    <!-- 可读性遮罩 -->
    <div class="scene__scrim"></div>
  </div>
</template>

<style scoped>
.scene {
  position: fixed;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
  background: var(--ink-900);
}

.scene__road,
.scene__shop {
  position: absolute;
  inset: -8% -4%;
  background-size: cover;
  background-position: center center;
  will-change: transform, opacity;
  animation-timeline: scroll(root block);
  animation-timing-function: linear;
  animation-fill-mode: both;
}

/* 夜路：缓慢下沉放大，并在前 30% 滚程里淡出 */
.scene__road {
  background-image: url('/art/bg-road.webp');
  background-position: center 58%;
  animation-name: roadOut;
}

@keyframes roadOut {
  0% {
    opacity: 1;
    transform: translate3d(0, -2.5%, 0) scale(1.06);
  }
  20% {
    opacity: 0.9;
  }
  34% {
    opacity: 0;
    transform: translate3d(0, 0, 0) scale(1.1);
  }
  100% {
    opacity: 0;
    transform: translate3d(0, 1%, 0) scale(1.12);
  }
}

/* 商行：接棒淡入，之后极缓慢推进，营造"站在柜台前"的感觉 */
.scene__shop {
  background-image: url('/art/bg-shop.webp');
  background-position: center 42%;
  opacity: 0;
  animation-name: shopIn;
}

@keyframes shopIn {
  0% {
    opacity: 0;
    transform: scale(1.16);
  }
  18% {
    opacity: 0;
  }
  36% {
    opacity: 1;
    transform: scale(1.06);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}

/* 门槛暖光：过渡中点最亮，像从门缝里透出的灯 */
.scene__threshold {
  position: absolute;
  inset: 0;
  background: radial-gradient(
    55% 45% at 50% 52%,
    rgba(255, 196, 110, 0.5),
    rgba(255, 168, 74, 0.16) 45%,
    transparent 72%
  );
  opacity: 0;
  will-change: opacity;
  animation: thresholdGlow linear both;
  animation-timeline: scroll(root block);
}

@keyframes thresholdGlow {
  0%,
  12% {
    opacity: 0;
  }
  27% {
    opacity: 0.75;
  }
  42%,
  100% {
    opacity: 0;
  }
}

/* 浮尘 / 灯晕 */
.scene__haze {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(60% 42% at 78% 74%, rgba(233, 185, 92, 0.16), transparent 72%),
    radial-gradient(55% 38% at 16% 20%, rgba(126, 156, 206, 0.09), transparent 72%);
  will-change: transform, opacity;
  animation: hazeDrift linear both;
  animation-timeline: scroll(root block);
}

@keyframes hazeDrift {
  from {
    transform: translate3d(-2%, 1%, 0) scale(1.1);
    opacity: 0.85;
  }
  to {
    transform: translate3d(3%, -3%, 0) scale(1.28);
    opacity: 1;
  }
}

/* 可读性遮罩：两层会相乘叠加，务必保持轻量 */
.scene__scrim {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(
      90deg,
      rgba(13, 10, 18, 0.3) 0%,
      rgba(13, 10, 18, 0.62) 18%,
      rgba(13, 10, 18, 0.62) 82%,
      rgba(13, 10, 18, 0.3) 100%
    ),
    linear-gradient(
      180deg,
      rgba(13, 10, 18, 0.1) 0%,
      rgba(13, 10, 18, 0.22) 45%,
      rgba(13, 10, 18, 0.34) 100%
    );
}

@media (prefers-reduced-motion: reduce) {
  .scene__road,
  .scene__shop,
  .scene__threshold,
  .scene__haze {
    animation: none;
  }

  .scene__road {
    opacity: 0;
  }

  .scene__shop {
    opacity: 1;
    transform: scale(1.04);
  }
}

@media (max-width: 760px) {
  .scene__road,
  .scene__shop,
  .scene__haze,
  .scene__threshold {
    animation: none;
  }

  .scene__road {
    opacity: 0;
  }

  .scene__shop {
    opacity: 1;
    transform: scale(1.04);
  }

  .scene__scrim {
    background: linear-gradient(
      180deg,
      rgba(13, 10, 18, 0.42) 0%,
      rgba(13, 10, 18, 0.64) 45%,
      rgba(13, 10, 18, 0.82) 100%
    );
  }
}
</style>
