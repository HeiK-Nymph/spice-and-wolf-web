/**
 * 旅途回忆录 · 唯一数据源
 * ---------------------------------------------------------------------------
 * 数组顺序 = 旅途顺序（自南向北：帕斯罗 → 约伊兹）。
 *
 * 新增一个板块的全部工作：在下面加一条记录。
 * 路线、地图节点、目录卡片、前后站、「第 N 站」——全部自动派生。
 *
 * 坐标 (x, y) 对应 JourneyMap 的 viewBox `0 0 1000 1500`，
 * 底图 public/art/map-world.webp 为 1024x1536（同比例）。
 * 坐标需落在底图的陆地上。
 *
 * 地名与设定出处：《狼与香辛料》原作；官方 15 周年纪念版世界地图
 * （Illustration: Hidetada Idemitsu）与萌娘百科词条互证。
 */

export interface Station {
  /** 唯一 id，同时用作锚点 */
  id: string
  /** 中文地名 */
  city: string
  /** 原作译名 */
  cityEn: string
  /** 所在国家 / 区域 */
  region: string
  /** 原作设定，一两句话 */
  lore: string
  /** 该地的场景名 */
  scene: string
  /** 地图坐标 */
  x: number
  y: number
  /** 有路由 = 已铺内容的板块；没有 = 尚未抵达 */
  to?: string
  /** 板块名 */
  board?: string
}

export const stations: Station[] = [
  {
    id: 'pasloe',
    city: '帕斯罗村',
    cityEn: 'Pasloe',
    region: '崔尼王国 · 南部农村',
    lore: '罗伦斯在装满麦子的马车上发现了熟睡的赫萝。她自称司掌丰收的狼神——旅途从这里开始。',
    scene: '麦车旁的初遇',
    x: 500,
    y: 1330,
    to: '/companions',
    board: '旅伴 · 人物图鉴',
  },
  {
    id: 'poroson',
    city: '波罗逊',
    cityEn: 'Poroson',
    region: '崔尼王国',
    lore: '原是异教圣地，激战后被教会建为虔诚之城：交易兴盛，钱却都寄进教会，市面反而简朴。',
    scene: '外墙漂亮、市面简朴的城',
    x: 540,
    y: 1285,
  },
  {
    id: 'ruvinheigen',
    city: '留宾海根',
    cityEn: 'Ruvinheigen',
    region: '崔尼王国 · 宗教都市',
    lore: '以大圣堂为中心的五角广场，洋行与商业公会林立；黄金珠宝入城课重税，走私严惩。',
    scene: '关税与贪婪祭司的都城',
    x: 575,
    y: 1186,
  },
  {
    id: 'lamtra',
    city: '拉姆特拉',
    cityEn: 'Lamtra',
    region: '崔尼王国',
    lore: '异教徒之都，与留宾海根之间隔着连骑士团都发怵的广阔森林，故迟迟未被讨伐。',
    scene: '可怖森林另一侧',
    x: 410,
    y: 1086,
  },
  {
    id: 'enberch',
    city: '恩贝尔',
    cityEn: 'Enberch',
    region: '普罗亚尼亚王国 · 东部',
    lore: '南方传教士建起道路后，从比特雷欧更小的镇子长成周边地区的交易中心。',
    scene: '半路长起来的新市集',
    x: 630,
    y: 987,
  },
  {
    id: 'kumersun',
    city: '卡梅尔森',
    cityEn: 'Kumersun',
    region: '普罗亚尼亚王国',
    lore: '贵族为「不受宗教束缚的纯粹经济」而建。没有教会，冬季办拉多拉祭与大市集；罗伦斯所属的罗恩商业公会在此设有商馆。',
    scene: '罗恩公会的商馆柜台',
    x: 465,
    y: 887,
    to: '/market',
    board: '商行 · 牌价板',
  },
  {
    id: 'lenos',
    city: '雷诺斯',
    cityEn: 'Lenos',
    region: '普罗亚尼亚王国',
    lore: '罗耶夫河与罗姆河交汇处的港镇，交通与商业要冲，毛皮与木材交易兴盛。',
    scene: '两河交汇的要冲',
    x: 620,
    y: 787,
  },
  {
    id: 'kerube',
    city: '凯尔贝',
    cityEn: 'Kerube',
    region: '普罗亚尼亚王国 · 河口',
    lore: '罗姆河河口的大港镇。南岸气派、钟塔林立；中央三角洲是商人的市场与贸易船停泊场。',
    scene: '大港的三角洲市场',
    x: 560,
    y: 688,
  },
  {
    id: 'taussig',
    city: '堂斯格',
    cityEn: 'Taussig',
    region: '凯尔贝以北',
    lore: '山脚下的村庄，距凯尔贝约两天半路程。有湖与瀑布，传说有飞向天上的天使与林中女巫。',
    scene: '传说里的山脚村庄',
    x: 655,
    y: 588,
  },
  {
    id: 'lesko',
    city: '雷斯可',
    cityEn: 'Lesko',
    region: '普罗亚尼亚王国 · 北方',
    lore: '雷诺斯以北、较靠近约伊兹的城镇。镇中最大的商会是德堡商会，掌握蒸馏技术。',
    scene: '德堡商会的蒸馏作坊',
    x: 545,
    y: 488,
  },
  {
    id: 'svernel',
    city: '斯威奈尔',
    cityEn: 'Svernel',
    region: '北方诸国',
    lore: '雷斯可东北方的城镇，曾以铁砂制铁，如今是琥珀与毛皮通过的交通要点。',
    scene: '琥珀与毛皮的过路镇',
    x: 545,
    y: 389,
  },
  {
    id: 'nyohhira',
    city: '纽希拉',
    cityEn: 'Nyohhira',
    region: '北方 · 温泉山间',
    lore: '北方王侯贵族都会前来的温泉镇。赫萝在约伊兹仍存在的年代也曾来此泡汤；多年以后，两人在此经营旅馆，共度余生。',
    scene: '灯下的温泉旅馆',
    x: 640,
    y: 289,
    to: '/quotes',
    board: '语录集 · 旅途回忆',
  },
  {
    id: 'yoitsu',
    city: '约伊兹',
    cityEn: 'Yoitsu',
    region: '托尔金地区 · 北方森林',
    lore: '赫萝的故乡。传闻早已被白色的巨熊神所毁，如今是一片无人进出的封闭森林——旅途始终朝着它。',
    scene: '旅途的尽头',
    x: 535,
    y: 190,
  },
]

/** 已铺内容的站点（有板块可进） */
export const boardStations: Station[] = stations.filter((s) => Boolean(s.to))

/** 站点序号（1 起） */
export function orderOf(id: string): number {
  return stations.findIndex((s) => s.id === id) + 1
}
