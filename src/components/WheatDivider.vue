<script setup lang="ts">
/** 麦穗分隔符：把行商账本/牌价的段落切开 */
defineProps<{ label?: string }>()
</script>

<template>
  <div class="divider" role="presentation">
    <span class="divider__rule"></span>
    <svg class="divider__mark" viewBox="0 0 34 34" aria-hidden="true">
      <g
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M17 29V10" />
        <path d="M17 12c-3.2-3.4-7.6-2.9-7.6-2.9s0 4.6 3.4 6.4c3.2 1.7 4.2.6 4.2.6" />
        <path d="M17 12c3.2-3.4 7.6-2.9 7.6-2.9s0 4.6-3.4 6.4c-3.2 1.7-4.2.6-4.2.6" />
        <path d="M17 19c-2.6-2.8-6.2-2.3-6.2-2.3s0 3.8 2.8 5.2c2.6 1.4 3.4.5 3.4.5" />
        <path d="M17 19c2.6-2.8 6.2-2.3 6.2-2.3s0 3.8-2.8 5.2c-2.6 1.4-3.4.5-3.4.5" />
        <path d="M13 29h8" />
      </g>
    </svg>
    <span v-if="label" class="divider__label">{{ label }}</span>
    <span class="divider__rule"></span>
  </div>
</template>

<style scoped>
.divider {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  color: var(--wheat-600);
}

.divider__rule {
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(224, 169, 68, 0.35), transparent);
}

.divider__mark {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  color: var(--wheat-500);
}

.divider__label {
  font-family: var(--font-display);
  font-size: 0.72rem;
  letter-spacing: 0.34em;
  text-transform: uppercase;
  color: var(--wheat-500);
  white-space: nowrap;
}
</style>
