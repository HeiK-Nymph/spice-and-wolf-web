<script setup lang="ts">
/**
 * 旅途回忆录 —— 首页就是那张地图。
 * 地图自己铺满视口、自己处理拖拽与缩放，这里不再有滚动内容。
 * 板块入口在地图上的驿站，以及地图右上的「驿站目录」。
 */
import JourneyMap from '@/components/JourneyMap.vue'
</script>

<template>
  <JourneyMap />
</template>
