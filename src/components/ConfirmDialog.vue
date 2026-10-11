<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

/**
 * 羊皮纸风格的确认弹窗。
 * 用于「销账」这类不可撤销的动作：默认的 window.confirm 太出戏。
 */
const props = withDefaults(
  defineProps<{
    open: boolean
    title?: string
    message?: string
    confirmText?: string
    cancelText?: string
  }>(),
  {
    title: '确认',
    message: '',
    confirmText: '确定',
    cancelText: '作罢',
  },
)

const emit = defineEmits<{ confirm: []; cancel: [] }>()

const confirmRef = ref<HTMLButtonElement | null>(null)

function onKeydown(event: KeyboardEvent): void {
  if (!props.open) return
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('cancel')
  } else if (event.key === 'Enter') {
    event.preventDefault()
    emit('confirm')
  }
}

function detach(): void {
  document.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      document.addEventListener('keydown', onKeydown)
      document.body.style.overflow = 'hidden'
      await nextTick()
      confirmRef.value?.focus()
    } else {
      detach()
    }
  },
)

onBeforeUnmount(detach)
</script>

<template>
  <Teleport to="body">
    <Transition name="dlg">
      <div v-if="open" class="dlg" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
        <div class="dlg__scrim" @click="emit('cancel')"></div>

        <div class="dlg__card">
          <img class="dlg__seal" src="/art/obj-seal-cracked.webp" alt="" aria-hidden="true" />
          <p class="dlg__eyebrow">MERCHANT'S LEDGER</p>
          <h2 id="dlg-title" class="dlg__title">{{ title }}</h2>
          <p class="dlg__message">{{ message }}</p>

          <div class="dlg__actions">
            <button type="button" class="dlg__btn" @click="emit('cancel')">
              {{ cancelText }}
            </button>
            <button
              ref="confirmRef"
              type="button"
              class="dlg__btn dlg__btn--danger"
              @click="emit('confirm')"
            >
              {{ confirmText }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.dlg {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: grid;
  place-items: center;
  padding: 1.2rem;
}

.dlg__scrim {
  position: absolute;
  inset: 0;
  background: rgba(8, 6, 11, 0.74);
  backdrop-filter: blur(3px) saturate(120%);
}

.dlg__card {
  position: relative;
  width: min(30rem, 100%);
  padding: 2.1rem 2rem 1.7rem;
  border-radius: 3px;
  /* 用铺满式的羊皮纸，避免抠像版四周的透明边在卡片角上留暗块 */
  background:
    url('/art/parchment.webp') center / cover no-repeat,
    #e6d6b2;
  box-shadow:
    0 40px 70px -26px rgba(0, 0, 0, 0.9),
    inset 0 0 0 1px rgba(120, 88, 44, 0.35),
    0 0 0 1px rgba(60, 40, 20, 0.4);
  color: #46331f;
  text-align: center;
}

/* 破印压在卡片上沿 */
.dlg__seal {
  position: absolute;
  top: -2.6rem;
  left: 50%;
  width: 5.4rem;
  transform: translateX(-50%) rotate(-6deg);
  filter: drop-shadow(0 14px 18px rgba(20, 10, 4, 0.6));
  pointer-events: none;
}

.dlg__eyebrow {
  margin-top: 1.1rem;
  font-family: var(--font-display);
  font-size: 0.66rem;
  font-weight: 600;
  letter-spacing: 0.34em;
  text-transform: uppercase;
  color: #8a6a3a;
}

.dlg__title {
  margin-top: 0.35rem;
  font-size: 1.55rem;
  color: #3a2a15;
}

.dlg__message {
  margin-top: 0.7rem;
  color: #6b563c;
  font-size: 0.92rem;
  line-height: 1.85;
  text-wrap: pretty;
}

.dlg__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.6rem;
  margin-top: 1.5rem;
}

.dlg__btn {
  padding: 0.5rem 1.2rem;
  border: 1px solid rgba(70, 51, 31, 0.5);
  border-radius: 3px;
  background: rgba(70, 51, 31, 0.1);
  color: #3a2a15;
  font-size: 0.86rem;
  letter-spacing: 0.06em;
  transition:
    background 0.2s ease,
    border-color 0.2s ease,
    color 0.2s ease;
}

.dlg__btn:hover {
  background: rgba(70, 51, 31, 0.2);
  border-color: rgba(70, 51, 31, 0.85);
}

.dlg__btn:focus-visible {
  outline: 2px solid rgba(70, 51, 31, 0.7);
  outline-offset: 2px;
}

.dlg__btn--danger {
  border-color: rgba(143, 47, 31, 0.6);
  background: rgba(143, 47, 31, 0.1);
  color: #8f2f1f;
  font-weight: 600;
}

.dlg__btn--danger:hover {
  background: rgba(143, 47, 31, 0.2);
  border-color: #8f2f1f;
  color: #7d2a1a;
}

.dlg-enter-active,
.dlg-leave-active {
  transition: opacity 0.2s ease;
}

.dlg-enter-active .dlg__card,
.dlg-leave-active .dlg__card {
  transition:
    transform 0.22s cubic-bezier(0.2, 0.7, 0.3, 1),
    opacity 0.22s ease;
}

.dlg-enter-from,
.dlg-leave-to {
  opacity: 0;
}

.dlg-enter-from .dlg__card,
.dlg-leave-to .dlg__card {
  opacity: 0;
  transform: translateY(10px) scale(0.97);
}

@media (prefers-reduced-motion: reduce) {
  .dlg-enter-active,
  .dlg-leave-active,
  .dlg-enter-active .dlg__card,
  .dlg-leave-active .dlg__card {
    transition: none;
  }
}
</style>
