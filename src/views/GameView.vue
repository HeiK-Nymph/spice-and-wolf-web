<script setup lang="ts">
/**
 * 旅途牌局 —— 整屏内置游戏。
 *
 * 这一页【不是网页版面】：没有页头页脚、没有页面滚动、没有文稿式排版。
 * 整屏只有一张 3D 牌桌，其余全部是浮在牌桌上的局内 UI（HUD / 弹窗）。
 * 操作只用键盘方向键 / WASD 与直接滑动牌桌 —— 不做屏幕方向键，免得再压住牌面。
 * 站点外壳的对应处理见 App.vue 的 .app-shell--game。
 *
 * 分工：
 *   · 规则（合并、得分、胜负）在 src/game/engine.ts，纯二维、可测；
 *   · 显示在 src/components/CardTable.vue，只负责把「旧局面 → 新局面」演出来；
 *   · 这里只做串联：收输入、更新分数、开关浮层。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import CardTable from '@/components/CardTable.vue'
import { CARD_FACES, faceName } from '@/game/catalog'
import { DIFFICULTY, applyMove, createGame } from '@/game/engine'
import type { Difficulty, Direction, GameState, MoveOutcome } from '@/game/engine'
import { readBest, readDifficulty, writeBest, writeDifficulty } from '@/game/settings'

interface TableHandle {
  playMove(outcome: MoveOutcome): Promise<void>
  reset(state: GameState): void
}

const router = useRouter()
const tableRef = ref<TableHandle | null>(null)

/** 难度只改「新方块出 4 的概率」，选好之后存在本机 */
const DIFFICULTY_OPTIONS: Array<{ id: Difficulty; label: string }> = [
  { id: 'easy', label: '简单' },
  { id: 'normal', label: '普通' },
  { id: 'hard', label: '困难' },
]

const difficulty = ref<Difficulty>(readDifficulty())
const state = ref<GameState>(createGame(Math.random, difficulty.value))
const best = ref(readBest())
const busy = ref(false)
const showWin = ref(false)
const over = ref(false)
const sheetOpen = ref(false)

const topValue = computed(() => state.value.tiles.reduce((max, tile) => Math.max(max, tile.value), 0))
/** 当前难度的目标值（棋盘变小，目标也跟着降） */
const winValue = computed(() => DIFFICULTY[difficulty.value].winValue)

const KEY_MAP: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  w: 'up',
  s: 'down',
  a: 'left',
  d: 'right',
  W: 'up',
  S: 'down',
  A: 'left',
  D: 'right',
}

async function move(dir: Direction): Promise<void> {
  if (busy.value || over.value || showWin.value) return

  const outcome = applyMove(state.value, dir)
  if (!outcome.changed) return

  busy.value = true
  state.value = outcome.state

  if (outcome.state.score > best.value) {
    best.value = outcome.state.score
    writeBest(best.value)
  }
  if (outcome.justWon) showWin.value = true

  await tableRef.value?.playMove(outcome)

  busy.value = false
  if (outcome.over) over.value = true
}

/**
 * 换难度。
 * 立刻对之后生成的方块生效，但**不重开这一局** —— 手滑点到就把进度清零太糟了。
 */
function setDifficulty(next: Difficulty): void {
  if (next === difficulty.value) return
  difficulty.value = next
  writeDifficulty(next)
  // 难度同时改棋盘大小（5×5 / 4×4 / 3×3），局中没法原地换尺寸 —— 直接按新难度重开
  restart()
}

function restart(): void {
  const fresh = createGame(Math.random, difficulty.value)
  state.value = fresh
  over.value = false
  showWin.value = false
  busy.value = false
  tableRef.value?.reset(fresh)
}

function leave(): void {
  void router.push('/')
}

/* ------------------------------ 键盘 ------------------------------ */
function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    // 优先收起牌谱；没开就不做别的（避免误按直接退出游戏）
    if (sheetOpen.value) sheetOpen.value = false
    return
  }
  const dir = KEY_MAP[event.key]
  if (!dir) return
  event.preventDefault()
  void move(dir)
}

/* ------------------------------ 触屏滑动 ------------------------------ */
let startPoint: { x: number; y: number } | null = null

function onPointerDown(event: PointerEvent): void {
  startPoint = { x: event.clientX, y: event.clientY }
}

function onPointerUp(event: PointerEvent): void {
  if (!startPoint) return
  const dx = event.clientX - startPoint.x
  const dy = event.clientY - startPoint.y
  startPoint = null
  const threshold = 26
  if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return
  if (Math.abs(dx) > Math.abs(dy)) void move(dx > 0 ? 'right' : 'left')
  // 屏幕往下滑 = 往自己这边滑 = 最后一行（近端）
  else void move(dy > 0 ? 'down' : 'up')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="game">
    <!-- 牌桌：整块画布，其余 UI 都浮在它上面 -->
    <div
      class="game__stage"
      @pointerdown="onPointerDown"
      @pointerup="onPointerUp"
      @pointercancel="startPoint = null"
    >
      <CardTable ref="tableRef" :initial="state" />
    </div>

    <!-- 顶部 HUD -->
    <header class="hud">
      <button type="button" class="hud__back" @click="leave">‹ 旅途</button>

      <div class="difficulty" role="group" aria-label="难度">
        <button
          v-for="option in DIFFICULTY_OPTIONS"
          :key="option.id"
          type="button"
          class="difficulty__btn"
          :class="{ 'is-active': difficulty === option.id }"
          :aria-pressed="difficulty === option.id"
          @click="setDifficulty(option.id)"
        >
          {{ option.label }}
        </button>
      </div>

      <div class="stats">
        <div class="stat">
          <span class="stat__label">得分</span>
          <strong class="stat__value">{{ state.score }}</strong>
        </div>
        <div class="stat">
          <span class="stat__label">最高</span>
          <strong class="stat__value">{{ best }}</strong>
        </div>
        <div class="stat">
          <span class="stat__label">最大</span>
          <strong class="stat__value">{{ topValue }}</strong>
          <span class="stat__note">{{ faceName(topValue) }}</span>
        </div>
      </div>

      <div class="hud__actions">
        <button type="button" class="chip" :aria-pressed="sheetOpen" @click="sheetOpen = !sheetOpen">
          牌谱
        </button>
        <button type="button" class="chip" @click="restart">重开</button>
      </div>
    </header>


    <!-- 牌谱：默认收起，需要时才展开，不占据牌桌版面 -->
    <aside v-if="sheetOpen" class="sheet">
      <div class="sheet__head">
        <h2 class="sheet__title">牌谱 · 十二张</h2>
        <button type="button" class="chip" @click="sheetOpen = false">收起</button>
      </div>
      <p class="sheet__intro">
        把相同的画片推到一处，它们会合成下一张更值钱的 ——
        从帕斯罗村的一束麦子，一路攒到北方森林里的同行者。
        规则是二维的（键盘方向键 / WASD，或直接滑动牌桌），只是把它摆在了桌上。
      </p>
      <ol class="ladder">
        <li
          v-for="face in CARD_FACES"
          :key="face.id"
          class="ladder__item"
          :class="{ 'is-character': face.kind === 'character', 'is-top': face.value === topValue }"
        >
          <span class="ladder__value">{{ face.value }}</span>
          <span class="ladder__name">{{ face.name }}</span>
        </li>
      </ol>
      <p class="sheet__note">难度会同时改棋盘与目标：简单 5×5（不出 4，目标 4096）· 普通 4×4（10%，目标 2048）· 困难 3×3（10%，目标 512）。换难度会重开一局。</p>
      <p class="sheet__note">合成到目标值算抵达；再往上还能继续合。</p>
    </aside>

    <!-- 胜负 -->
    <div v-if="showWin" class="overlay">
      <div class="overlay__card">
        <h2 class="overlay__title">抵达 {{ winValue }}</h2>
        <p class="overlay__body">
          两张 {{ winValue / 2 }} 合到了一起（{{ faceName(winValue) }}）。牌局还可以继续。
        </p>
        <div class="overlay__actions">
          <button type="button" class="btn btn--primary" @click="showWin = false">继续打</button>
          <button type="button" class="btn" @click="restart">重新开局</button>
        </div>
      </div>
    </div>

    <div v-else-if="over" class="overlay">
      <div class="overlay__card">
        <h2 class="overlay__title">无路可走</h2>
        <p class="overlay__body">
          牌面已经满了，没有能合到一起的两张。本局得 {{ state.score }} 分，
          最大面值 {{ topValue }}（{{ faceName(topValue) }}）。
        </p>
        <div class="overlay__actions">
          <button type="button" class="btn btn--primary" @click="restart">再来一局</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/*
 * 整屏游戏：没有页面滚动，也没有文稿式排版。
 *
 * 画布【铺满整个视口】，HUD 是浮在它上面的一层。
 * 之前是按 UI 给画布留「占位带」，可那几条带子露出的是画布之外的纯色背景，
 * 在右边和下边各形成一块明显的黑边 —— 留白反而留出了破绽，所以现在画布盖满。
 */
.game {
  /* HUD 的高度。只给浮层定位用，画布不再受它影响 */
  --hud-h: 84px;
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  overscroll-behavior: none;
  /*
   * 背景：干净的纯渐变。
   *
   * 牌桌【和它下面那张桌子】都是 3D 的，背景再放一张「桌子照片」就变成桌上叠桌了。
   * 参考图的做法也是如此：素色背景 + 一张有厚度的 3D 桌子，厚度才是体积感的来源。
   */
  background-color: #0d0906;
  background-image:
    radial-gradient(130% 86% at 50% 34%, #42301f 0%, #1e1409 52%, #0a0705 100%);
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
}

@media (max-height: 660px) {
  .game {
    --hud-h: 62px;
  }
}



.game__stage {
  /* 铺满整个视口：留边会露出画布之外的底色，那正是右下角那两块黑边的来源 */
  position: absolute;
  inset: 0;
  /* 桌面上的一切手势都归游戏：不留下拉刷新与双指缩放 */
  touch-action: none;
}

/* ---------------------------------- HUD ---------------------------------- */
.hud {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: var(--hud-h);
  display: flex;
  align-items: center;
  gap: 10px;
  /* 两侧带上安全区：刘海与侧边手势条都不该压住按钮 */
  padding: 0 calc(16px + var(--safe-right, 0px)) 0 calc(16px + var(--safe-left, 0px));
  pointer-events: none;
}

.hud > * {
  pointer-events: auto;
}

/*
 * 用 order 排版，不额外包一层：
 *   横屏 —— 返回 · 难度 …… 分数 …… 操作（分数两边 auto 外边距，自然居中）
 *   竖屏 —— 见下面那条媒体查询，分数与操作提上来、难度自己占一行
 */
.hud__back {
  order: 1;
}

.difficulty {
  order: 2;
}

.stats {
  order: 3;
  margin-inline: auto;
}

.hud__actions {
  order: 4;
}

/* 难度：一枚小分段控件 */
.difficulty {
  display: flex;
  padding: 3px;
  border: 1px solid rgba(224, 169, 68, 0.22);
  border-radius: 999px;
  background: rgba(18, 13, 9, 0.8);
}

.difficulty__btn {
  padding: 5px 12px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  white-space: nowrap;
  color: var(--text-dim);
  font-family: var(--font-serif);
  font-size: 12px;
  letter-spacing: 0.06em;
  cursor: pointer;
  transition: background 0.16s, color 0.16s;
}

.difficulty__btn:hover {
  color: var(--wheat-300);
}

.difficulty__btn.is-active {
  background: rgba(217, 160, 60, 0.26);
  color: var(--wheat-300);
}

.hud__back,
.chip {
  padding: 8px 16px;
  border: 1px solid rgba(224, 169, 68, 0.3);
  border-radius: 999px;
  background: rgba(22, 16, 11, 0.82);
  color: var(--parchment-100);
  font-family: var(--font-serif);
  font-size: 13px;
  letter-spacing: 0.08em;
  white-space: nowrap;
  cursor: pointer;
  transition: border-color 0.18s, color 0.18s;
}

.hud__back:hover,
.chip:hover {
  border-color: var(--wheat-400);
  color: var(--wheat-300);
}

.chip[aria-pressed='true'] {
  border-color: var(--wheat-500);
  background: rgba(217, 160, 60, 0.22);
  color: var(--wheat-300);
}

.stats {
  display: flex;
  gap: 8px;
}

.stat {
  min-width: 78px;
  padding: 5px 12px;
  border: 1px solid rgba(224, 169, 68, 0.18);
  border-radius: 12px;
  background: rgba(18, 13, 9, 0.78);
  text-align: center;
}

.stat__label {
  display: block;
  font-size: 10px;
  letter-spacing: 0.2em;
  color: var(--text-dim);
}

.stat__value {
  display: block;
  font-family: var(--font-display);
  font-size: 20px;
  line-height: 1.2;
  color: var(--wheat-300);
}

.stat__note {
  display: block;
  font-size: 10px;
  color: var(--text-dim);
}

.hud__actions {
  display: flex;
  gap: 8px;
}


/* --------------------------------- 牌谱 --------------------------------- */
.sheet {
  position: absolute;
  right: 16px;
  top: calc(var(--hud-h) + var(--safe-top, 0px) + 8px);
  width: min(420px, calc(100% - 32px));
  max-height: calc(100% - var(--hud-h) - 48px);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 16px 18px;
  border: 1px solid rgba(224, 169, 68, 0.28);
  border-radius: var(--radius);
  background: rgba(16, 12, 8, 0.94);
  box-shadow: var(--shadow);
}

.sheet__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.sheet__title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 14px;
  letter-spacing: 0.14em;
  color: var(--wheat-300);
}

.sheet__intro {
  margin: 0 0 12px;
  font-size: 12px;
  line-height: 1.8;
  color: var(--text-muted);
}

.ladder {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.ladder__item {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 4px 10px;
  border: 1px solid rgba(224, 169, 68, 0.18);
  border-radius: 999px;
  font-size: 12px;
  color: var(--text-muted);
}

.ladder__item.is-character {
  border-color: rgba(224, 169, 68, 0.42);
  color: var(--parchment-100);
}

.ladder__item.is-top {
  background: rgba(217, 160, 60, 0.2);
  border-color: var(--wheat-500);
  color: var(--wheat-300);
}

.ladder__value {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--wheat-400);
}

.sheet__note {
  margin: 12px 0 0;
  font-size: 11px;
  color: var(--text-dim);
}

/* --------------------------------- 弹窗 --------------------------------- */
.overlay {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(10, 7, 5, 0.72);
  backdrop-filter: blur(3px);
}

.overlay__card {
  max-width: 420px;
  padding: 26px 28px;
  border: 1px solid rgba(224, 169, 68, 0.35);
  border-radius: var(--radius-lg);
  background: linear-gradient(rgba(24, 18, 12, 0.95), rgba(16, 12, 8, 0.97));
  box-shadow: var(--shadow);
  text-align: center;
}

.overlay__title {
  margin: 0 0 10px;
  font-family: var(--font-display);
  font-size: 22px;
  color: var(--wheat-300);
}

.overlay__body {
  margin: 0 0 18px;
  font-size: 13px;
  line-height: 1.8;
  color: var(--text-muted);
}

.overlay__actions {
  display: flex;
  justify-content: center;
  gap: 10px;
}

.btn {
  padding: 9px 20px;
  border: 1px solid rgba(224, 169, 68, 0.32);
  border-radius: 999px;
  background: rgba(28, 21, 15, 0.9);
  color: var(--parchment-100);
  font-family: var(--font-serif);
  font-size: 13px;
  letter-spacing: 0.08em;
  cursor: pointer;
  transition: border-color 0.18s, color 0.18s;
}

.btn:hover {
  border-color: var(--wheat-400);
  color: var(--wheat-300);
}

.btn--primary {
  border-color: var(--wheat-500);
  background: linear-gradient(180deg, rgba(217, 160, 60, 0.28), rgba(140, 90, 28, 0.3));
  color: var(--parchment-50);
}



/*
 * 手机（窄屏）：横排的 HUD 在手机上根本不成立 ——
 *   ① 五组板块挤一行会溢出（实测 390px 视口下 stats 右边界顶到 475px）；
 *   ② 三个分数面板横在顶部正中，正好压在牌桌上方，也不符合游戏的分区习惯。
 * 所以整个 HUD 改成【覆盖视口的定位容器】，四组东西各归其位：
 *   上排  「返回 ········· 牌谱 / 重开」
 *   左侧  「得分 / 最高 / 最大」竖列
 *   底部  「简单 / 普通 / 困难」分段控件
 */
@media (max-width: 640px) {
  .hud {
    position: absolute;
    inset: 0;
    height: auto;
    display: block;
    padding: 0;
  }

  .hud__back {
    position: absolute;
    top: calc(8px + var(--safe-top, 0px));
    left: calc(10px + var(--safe-left, 0px));
    padding: 7px 12px;
    font-size: 12px;
  }

  .hud__actions {
    position: absolute;
    top: calc(8px + var(--safe-top, 0px));
    right: calc(10px + var(--safe-right, 0px));
    display: flex;
    gap: 6px;
  }

  .hud__actions .chip {
    padding: 7px 12px;
    font-size: 12px;
  }

  /*
   * 三个分数面板：右侧竖列（与右上角的「牌谱 / 重开」同侧，形成一条右栏）。
   * 竖屏下牌桌是「宽扁」的一条，上方留着一大片空地 —— 这一列正好落在那里，
   * 一张牌都不会被盖住。
   */
  .stats {
    position: absolute;
    top: calc(64px + var(--safe-top, 0px));
    right: calc(10px + var(--safe-right, 0px));
    flex-direction: column;
    gap: 5px;
    margin: 0;
    width: 62px;
  }

  .stat {
    min-width: 0;
    width: 100%;
    padding: 5px 6px;
    border-radius: 10px;
  }

  .stat__label {
    font-size: 10px;
    letter-spacing: 0.12em;
  }

  .stat__value {
    font-size: 18px;
  }

  .stat__note {
    font-size: 10px;
  }

  /* 难度沉到底部中间：不和分数抢左上角，也不挡牌 */
  .difficulty {
    position: absolute;
    bottom: calc(12px + var(--safe-bottom, 0px));
    left: 50%;
    transform: translateX(-50%);
    margin: 0;
  }

  .difficulty__btn {
    padding: 5px 12px;
    font-size: 12px;
  }

  /* 牌谱面板：顶栏下方铺到底，并在底部给难度控件留出位置 */
  .sheet {
    left: 10px;
    right: 10px;
    width: auto;
    top: calc(58px + var(--safe-top, 0px));
    max-height: calc(100% - 58px - var(--safe-bottom, 0px) - 72px);
  }
}
</style>