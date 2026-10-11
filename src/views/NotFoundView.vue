<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<template>
  <section class="nf">
    <div class="container nf__inner">
      <p class="eyebrow">404</p>
      <h1 class="nf__title">这条路似乎走不通</h1>
      <p class="lead nf__lead">
        罗伦斯也有算错行情的时候。你要找的页面不在这里——也许它已经随着商队离开了这座城镇。
      </p>
      <div class="nf__actions">
        <RouterLink to="/" class="btn btn--primary">回到首页</RouterLink>
        <RouterLink to="/gallery" class="btn btn--ghost">去麦穗画廊</RouterLink>
      </div>
    </div>
  </section>
</template>

<style scoped>
.nf {
  display: grid;
  place-items: center;
  min-height: 62vh;
  padding-block: 4rem;
  text-align: center;
}

.nf__lead {
  max-width: 48ch;
  margin: 1.2rem auto 0;
}

.nf__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.8rem;
  margin-top: 2rem;
}
</style>
