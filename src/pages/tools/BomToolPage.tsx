/* ==========================================================================
 * 机箱 BOM 工具台 —— 四版本物料清单 / 数量可调实时计价 / 版本对比 / CSV 导出
 *
 * 机型：200(W)×350(D)×350(H)mm 紧凑型三层卧式模块化机箱。
 * 计价：金额一律「分」整数，展示走 yuanText()；
 *      汇总一律由明细动态计算（domain/tools 的 bomTotal），
 *      杜绝原实现「手写汇总与明细差 174.4 元」这类错误再次发生。
 *
 * 数据落地：saveSnapshot('tools.bom') 本机即时落地（写入失败静默降级）。
 * 缺陷防线：CSV 导出必须带 BOM 头 \ufeff，否则 Excel 打开中文乱码。
 * ======================================================================== */

import { Fragment, useEffect, useMemo, useState } from 'react'
import { bomTotal } from '@/domain/tools/model'
import type { BomRow, BomState, BomVersion } from '@/domain/tools/model'
import { loadSnapshot, saveSnapshot } from '@/data/sync'
import { cx, yuanText, yuanToFen, clamp } from '@/core/utils'
import { Empty } from '@/ui'

const SCOPE = 'tools.bom'
const QTY_MIN = 1
const QTY_MAX = 99

const row = (code: string, name: string, spec: string, qty: number, yuan: number): BomRow => ({
  code,
  name,
  spec,
  qty,
  priceFen: yuanToFen(yuan),
})

/* ---------- 通用物料（四版本共享，按分類编排） ---------- */

interface CatDef {
  name: string
  rows: BomRow[]
}

const COMMON_CATS: CatDef[] = [
  {
    name: '通用基础件（全配置通用）',
    rows: [
      row('G-001', '通用主机架总成', '200(W)×350(D)×350(H)mm SPCC 1.2mm喷塑', 1, 180),
      row('G-002', '三层导轨安装座', '标准8英寸导轨孔距 SPCC 1.0mm喷塑', 6, 8),
      row('G-003', '背部通用背板框架', '190×340mm SPCC 1.2mm喷塑', 1, 45),
      row('G-004', '层间隔板通用框', '190×340mm，带导风圈位 SPCC 1.0mm喷塑', 2, 32),
      row('G-005', '机箱脚垫', 'Φ15×6mm 防滑丁腈橡胶', 4, 1.8),
      row('G-006', '通用基础紧固件包', 'M3/M4螺丝、平垫、弹垫', 1, 15),
      row('G-007', '接地铜带组件', '5×0.5mm 紫铜', 1, 12),
    ],
  },
  {
    name: '存储抽屉模块（2块3.5寸+2块2.5寸）',
    rows: [
      row('M1-001', '硬盘笼本体', '1列2排3.5寸+2位2.5寸，SPCC 0.8mm喷塑', 1, 85),
      row('M1-002', '3.5寸硬盘托架', '标准硬盘位，带减震位 SPCC 0.6mm喷塑', 2, 5.5),
      row('M1-003', '2.5寸SSD托架', '亚克力/金属，适配2.5寸硬盘', 2, 4),
      row('M1-004', '抽拉导轨', '8英寸二节钢珠导轨 镀锌钢', 2, 22),
      row('M1-005', '前部锁止拉手', '带到位锁定+解锁按键', 1, 15),
      row('M1-006', '硬盘状态指示灯组', 'Φ3mm 红色LED', 4, 0.8),
      row('M1-007', '内置SATA背板', '4口SATA+供电一体化 PCB', 1, 55),
      row('M1-008', '层板导风密封圈', '适配风道接口 阻燃海绵', 1, 5),
    ],
  },
  {
    name: '计算抽屉模块（ITX单主板+全高显卡）',
    rows: [
      row('M2-001', 'ITX主板安装托盘', '180×180mm，M3铜柱孔阵 SPCC 0.8mm喷塑', 1, 35),
      row('M2-002', '主板铜柱组', 'M3×6+6 黄铜', 6, 0.8),
      row('M2-003', '全高显卡固定支架', '双槽位尾部支撑 SPCC 1.0mm喷塑', 1, 18),
      row('M2-004', '内部理线架', '适配背部走线 SPCC 0.6mm喷塑', 1, 10),
      row('M2-005', 'CPU区域导风罩', '引导气流覆盖核心区 ABS阻燃', 1, 8),
      row('M2-006', '供电转接板', '24Pin+8Pin 盲插转接 PCB', 1, 32),
      row('M2-007', 'PCI-E显卡支撑柱', '可调节高度，磁吸底座', 1, 12),
    ],
  },
  {
    name: '电源抽屉模块（单ATX）',
    rows: [
      row('M3-001', '电源舱框架', '单ATX位 SPCC 1.0mm喷塑', 1, 38),
      row('M3-002', 'ATX电源固定支架', '标准ATX孔位 SPCC 1.0mm喷塑', 1, 8),
      row('M3-003', '电源减震胶垫组', '10×10×3mm 丁腈橡胶', 4, 1.2),
      row('M3-004', '抽拉导轨', '8英寸二节钢珠导轨 镀锌钢', 1, 22),
      row('M3-005', '内置配电背板', '单电源输入+统一输出 PCB', 1, 38),
      row('M3-006', '前部拉手', '带定位凸点 SPCC喷塑', 1, 12),
    ],
  },
  {
    name: '前面板模块（3风扇）',
    rows: [
      row('M4-001', '前面板本体', '200×350mm，3组风扇孔 SPCC 1.2mm喷塑', 1, 55),
      row('M4-002', '12025 PWM进风风扇', 'DC12V，≥50CFM', 3, 25),
      row('M4-003', '防尘网框+滤网', '120×120mm，300目', 3, 4),
      row('M4-004', '前置IO组件', 'USB-A×2+Type-C×1+音频', 1, 25),
      row('M4-005', '开关指示灯组', '单电源开关+电源灯', 1, 10),
      row('M4-006', '快拆卡扣', '弹簧卡扣式 镀锌钢', 2, 3),
    ],
  },
  {
    name: '后面板模块（2风扇）',
    rows: [
      row('M5-001', '后面板本体', '200×350mm，带IO/PCI/电源孔 SPCC 1.2mm喷塑', 1, 48),
      row('M5-002', '12025 PWM排风风扇', 'DC12V，≥50CFM', 2, 25),
      row('M5-003', '主板I/O挡板', '标准ITX IO尺寸 SPCC', 1, 4),
      row('M5-004', 'PCI挡板', '双槽位空白挡片 SPCC', 1, 2),
      row('M5-005', 'AC品字输入插座', '10A带保险丝', 1, 7),
      row('M5-006', '固定手拧螺丝', 'M4 镀锌钢', 2, 1.2),
    ],
  },
  {
    name: '标准化接口组件',
    rows: [
      row('IF-001', '电源盲插连接器组', '24Pin+8Pin 防呆设计 ≥1000次插拔', 1, 38),
      row('IF-002', '数据盲插连接器', 'SATA 7Pin+15Pin ≥500次插拔', 1, 25),
      row('IF-003', '信号盲插连接器', '10Pin主板信号 键位防呆', 1, 18),
      row('IF-004', '锥形定位销组', 'Φ5mm 不锈钢 带倒角', 4, 6),
      row('IF-005', '风道密封泡棉组', '阻燃海绵 1mm厚 各层接口', 1, 18),
    ],
  },
  {
    name: '通用外购件与生产辅料',
    rows: [
      row('GP-001', '散热风扇控制器', 'PWM 5路 温度调速', 1, 32),
      row('GP-002', '温度传感器组', 'NTC 10K 三线制', 3, 3),
      row('GP-003', '内部连接线束', '定制长度 镀锡铜 含标签', 1, 35),
      row('GP-004', '铭牌与标识贴', '激光雕刻铝铭牌+丝印标识', 1, 12),
      row('GP-005', '包装材料', 'EPE珍珠棉+五层瓦楞纸箱', 1, 22),
      row('GP-006', '出厂质检报告', '含尺寸/电气/外观检验记录', 1, 15),
      row('GP-007', '安装说明书', '彩色印刷 含装配步骤图', 1, 10),
    ],
  },
]

const SURFACE_CAT = '表面处理与整机组装'
const ACY_CAT = '亚克力件（本版本专属）'

/** 版本专属件（全金属标准版为空） */
const VERSION_ACY: Record<string, BomRow[]> = {
  metal: [],
  'plan-a': [
    row('ACY-001', '磨砂半透亚克力顶盖', '198×348×3mm 雾度70% V0阻燃 含铜套', 1, 38),
    row('ACY-002', 'CPU透明导风罩', '80×70×25mm 耐温≥85℃ V0阻燃', 1, 12),
    row('ACY-004', '2.5寸SSD亚克力托架', '100×70×3mm 黑色半透 含铜套', 2, 6),
    row('ACY-005', '亚克力理线架+导光条', '2mm黑色磨砂理线架+φ5透明导光条', 1, 10),
  ],
  'plan-b': [
    row('ACY-001', '磨砂半透亚克力顶盖', '198×348×3mm 雾度70% V0阻燃 含铜套', 1, 38),
    row('ACY-002', 'CPU透明导风罩', '80×70×25mm 耐温≥85℃ V0阻燃', 1, 12),
    row('ACY-003', '侧板透明观察窗', '120×150×4mm 高透 V0阻燃 含密封', 1, 45),
    row('ACY-004', '2.5寸SSD亚克力托架', '100×70×3mm 黑色半透 含铜套', 2, 6),
    row('ACY-005', '亚克力理线架+导光条', '2mm黑色磨砂理线架+φ5透明导光条', 1, 10),
  ],
  concept: [
    row('ACY-G-01', '全透明亚克力顶盖', '198×348×4mm 高透 V0阻燃 边缘高光', 1, 55),
    row('ACY-G-02', '全透明亚克力侧板', '348×340×4mm 高透 左右各一 含铜套', 2, 65),
    row('ACY-G-03', '前面板进风区透明件', '198×80×3mm 高透 带风扇孔位', 1, 28),
    row('ACY-002', 'CPU透明导风罩（蓝透）', '80×70×25mm 蓝色透明 耐温≥85℃', 1, 15),
    row('ACY-004', '2.5寸SSD亚克力托架', '100×70×3mm 透明 含铜套', 2, 8),
    row('ACY-G-04', '模块识别色装饰条', 'ABS+亚克力 三色分区标识', 1, 22),
    row('ACY-G-05', '灯效导光系统', 'RGB灯带+导光板+控制器', 1, 55),
  ],
}

interface VersionSeed {
  key: string
  name: string
  desc: string
  surface: [number, number]
}

const VERSION_SEEDS: VersionSeed[] = [
  { key: 'metal', name: '全金属标准版', desc: '全钣金结构，无亚克力件；计价基准：100台批量，不含核心硬件', surface: [180, 320] },
  { key: 'plan-a', name: '方案A·基础透明款', desc: '磨砂顶盖+金属侧板+透明导风罩+SSD托架+理线架；计价基准：100台批量，不含核心硬件', surface: [150, 260] },
  { key: 'plan-b', name: '方案B·透明定制款', desc: '磨砂顶盖+侧板观察窗+透明导风罩+SSD托架+理线架（主推）；计价基准：100台批量，不含核心硬件', surface: [150, 260] },
  { key: 'concept', name: '概念展示版', desc: '全透明亚克力外壳+灯效优化+模块识别色；样机级配置，计价基准：10台小批量，不含核心硬件', surface: [280, 480] },
]

const COMMON_ROWS: BomRow[] = COMMON_CATS.flatMap((c) => c.rows)

/** 表面处理单独一行，参与动态汇总 —— 否则「明细合计」永远漏掉装配成本 */
const surfaceRow = (surface: [number, number]): BomRow => ({
  code: 'ASS-001',
  name: '表面处理与整机组装',
  spec: '喷塑/抛光/装配/质检/包装',
  qty: 1,
  priceFen: yuanToFen(surface[0]),
})

const VERSIONS: BomVersion[] = VERSION_SEEDS.map((seed) => ({
  key: seed.key,
  name: seed.name,
  desc: seed.desc,
  surface: seed.surface,
  acy: [...COMMON_ROWS, ...(VERSION_ACY[seed.key] ?? []), surfaceRow(seed.surface)],
}))

const DEFAULT_VERSION = VERSIONS[0]!

/** 行 → 所属分类，表格分组渲染用 */
const CAT_OF: Record<string, string> = (() => {
  const map: Record<string, string> = {}
  for (const c of COMMON_CATS) for (const r of c.rows) map[r.code] = c.name
  for (const rows of Object.values(VERSION_ACY)) for (const r of rows) map[r.code] = ACY_CAT
  map['ASS-001'] = SURFACE_CAT
  return map
})()

const GROUP_ORDER: string[] = [...COMMON_CATS.map((c) => c.name), ACY_CAT, SURFACE_CAT]

const CODE_SYSTEM = [
  { prefix: 'G-', desc: '通用金属结构件（机架 / 导轨座 / 背板 / 紧固件）' },
  { prefix: 'M1~M5', desc: '五大模块件（存储 / 计算 / 电源 / 前面板 / 后面板）' },
  { prefix: 'IF-', desc: '标准化接口组件（盲插连接器 / 定位销 / 密封泡棉）' },
  { prefix: 'GP-', desc: '通用外购件与生产辅料（线束 / 控制器 / 包装）' },
  { prefix: 'ACY-', desc: '亚克力专属件（顶盖 / 观察窗 / 导光条 / 灯效）' },
  { prefix: 'ASS-', desc: '表面处理与装配（喷塑 / 抛光 / 组装 / 质检）' },
]

/* ---------- 持久化 ---------- */

function parseState(raw: unknown): BomState | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.ver !== 'string' || !VERSIONS.some((v) => v.key === r.ver)) return null
  const qtys: Record<string, number> = {}
  if (r.qtys && typeof r.qtys === 'object') {
    for (const [code, n] of Object.entries(r.qtys as Record<string, unknown>)) {
      // 非法的数量直接丢弃（回落到该行默认数量），不让脏数据污染汇总
      if (typeof n === 'number' && Number.isFinite(n)) qtys[code] = clamp(Math.round(n), QTY_MIN, QTY_MAX)
    }
  }
  return { ver: r.ver, qtys }
}

function versionCost(ver: BomVersion, qtys: Record<string, number>): { low: number; high: number } {
  const low = bomTotal(ver, qtys)
  return { low, high: low + yuanToFen(ver.surface[1] - ver.surface[0]) }
}

/** 某行在某版本里的实际数量：用户未调整时取该行默认数量 */
function qtyOf(qtys: Record<string, number>, code: string, def: number): number {
  return qtys[code] ?? def
}

function moneyRange(fen: number, spanFen: number): string {
  return spanFen > 0 ? `¥${yuanText(fen)} ~ ${yuanText(fen + spanFen)}` : `¥${yuanText(fen)}`
}

export function BomToolPage() {
  const [state, setState] = useState<BomState>(() => loadSnapshot(SCOPE, parseState, { ver: DEFAULT_VERSION.key, qtys: {} }))

  useEffect(() => {
    saveSnapshot(SCOPE, state)
  }, [state])

  const version = VERSIONS.find((v) => v.key === state.ver) ?? DEFAULT_VERSION
  const dirty = Object.keys(state.qtys).length > 0

  const groups = useMemo(
    () =>
      GROUP_ORDER.map((name) => ({ name, rows: version.acy.filter((r) => CAT_OF[r.code] === name) })).filter(
        (g) => g.rows.length > 0,
      ),
    [version],
  )

  const cur = versionCost(version, state.qtys)
  const base = versionCost(version, {})
  const baseMetal = versionCost(DEFAULT_VERSION, {})
  const rowCount = version.acy.length
  const deltaFen = cur.low - base.low
  const index = Math.round((cur.low / baseMetal.low) * 100)

  const changeQty = (code: string, def: number, delta: number): void => {
    const next = clamp(qtyOf(state.qtys, code, def) + delta, QTY_MIN, QTY_MAX)
    setState({ ver: state.ver, qtys: { ...state.qtys, [code]: next } })
  }

  const setQty = (code: string, raw: string): void => {
    const n = Number(raw)
    if (!Number.isFinite(n)) return
    setState({ ver: state.ver, qtys: { ...state.qtys, [code]: clamp(Math.round(n), QTY_MIN, QTY_MAX) } })
  }

  /** CSV：\ufeff BOM 头保证 Excel 中文不乱码；含逗号的字段必须转义 */
  const exportCsv = (): void => {
    const esc = (s: string): string => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
    const lines: string[] = ['物料编码,零件名称,规格参数,数量,参考单价(元),小计(元),所属分类']
    for (const g of groups) {
      for (const r of g.rows) {
        const q = qtyOf(state.qtys, r.code, r.qty)
        lines.push([r.code, esc(r.name), esc(r.spec), String(q), yuanText(r.priceFen), yuanText(r.priceFen * q), esc(g.name)].join(','))
      }
      const sub = g.rows.reduce((s, r) => s + r.priceFen * qtyOf(state.qtys, r.code, r.qty), 0)
      lines.push(`,${esc(g.name + ' 小计')},,,,${yuanText(sub)},`)
    }
    lines.push(`,整机合计（不含核心硬件）,,,,${yuanText(cur.low)},`)
    const blob = new Blob([`\ufeff${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `BOM-${version.name}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="page">
      <h1 className="page-title">🧰 机箱 BOM 工具台</h1>
      <p className="muted" style={{ margin: '0 0 12px' }}>
        紧凑型三层卧式模块化机箱（200×350×350mm）· 四版本分版清单 · 数量可调实时计价 · 汇总由明细动态计算
      </p>

      <div className="row wrap" style={{ marginBottom: 12 }}>
        {VERSIONS.map((v) => (
          <button key={v.key} className={cx('chip', state.ver === v.key && 'active')} onClick={() => setState({ ver: v.key, qtys: state.qtys })}>
            {v.name}
          </button>
        ))}
        <span className="grow" />
        <button className="btn btn-ghost btn-sm" onClick={exportCsv}>
          ⬇ 导出 CSV
        </button>
        <button className="btn btn-ghost btn-sm" disabled={!dirty} onClick={() => setState({ ver: state.ver, qtys: {} })}>
          恢复默认数量
        </button>
      </div>

      <div className="stat-row" style={{ marginBottom: 12 }}>
        <span>
          <b>{moneyRange(cur.low, cur.high - cur.low)}</b> 整机合计（不含核心硬件）
        </span>
        <span>
          <b>{rowCount}</b> 物料项 · {groups.length} 大分类
        </span>
        <span>
          <b>{index}%</b> 成本相对指数（以全金属版为基准）
        </span>
        <span>
          <b style={{ color: deltaFen === 0 ? undefined : deltaFen > 0 ? 'var(--danger)' : 'var(--success)' }}>
            {deltaFen === 0 ? '±0' : `${deltaFen > 0 ? '+' : '-'}¥${yuanText(Math.abs(deltaFen))}`}
          </b>{' '}
          较默认用量偏差{dirty ? '（已手动调整）' : ''}
        </span>
      </div>

      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>{version.desc}</p>
        {groups.length === 0 ? (
          <Empty emoji="📭" text="该版本暂无物料明细" />
        ) : (
          <div className="bom-scroll">
            <table className="bom-table">
              <thead>
                <tr>
                  <th>物料编码</th>
                  <th>零件名称</th>
                  <th>规格参数</th>
                  <th>数量</th>
                  <th>参考单价(元)</th>
                  <th>小计(元)</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <Fragment key={`cat-${g.name}`}>
                    <tr className="bom-cat">
                      <td colSpan={6}>{g.name}</td>
                    </tr>
                    {g.rows.map((r) => {
                      const q = qtyOf(state.qtys, r.code, r.qty)
                      return (
                        <tr key={r.code}>
                          <td className="bom-code">{r.code}</td>
                          <td>{r.name}</td>
                          <td className="bom-spec">{r.spec}</td>
                          <td>
                            <span className="qty-ctl">
                              <button className="qty-btn" onClick={() => changeQty(r.code, r.qty, -1)} aria-label="减少">
                                −
                              </button>
                              <input
                                className="qty-input"
                                type="number"
                                min={QTY_MIN}
                                max={QTY_MAX}
                                value={q}
                                onChange={(e) => setQty(r.code, e.target.value)}
                                aria-label={`${r.name} 数量`}
                              />
                              <button className="qty-btn" onClick={() => changeQty(r.code, r.qty, 1)} aria-label="增加">
                                +
                              </button>
                            </span>
                          </td>
                          <td>{yuanText(r.priceFen)}</td>
                          <td className="bom-sub">{yuanText(r.priceFen * q)}</td>
                        </tr>
                      )
                    })}
                    <tr className="bom-sub-row">
                      <td colSpan={5}>{g.name} 小计</td>
                      <td>{yuanText(g.rows.reduce((s, r) => s + r.priceFen * qtyOf(state.qtys, r.code, r.qty), 0))}</td>
                    </tr>
                  </Fragment>
                ))}
                <tr className="bom-grand">
                  <td colSpan={5}>整机成本合计（不含主板/硬盘/电源/显卡等核心硬件）</td>
                  <td>{moneyRange(cur.low, cur.high - cur.low)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h3 className="section-title" style={{ marginTop: 0 }}>四版本成本对比汇总</h3>
        <div className="bom-scroll">
          <table className="bom-table">
            <thead>
              <tr>
                <th>成本项</th>
                {VERSIONS.map((v) => (
                  <th key={v.key} className={cx(v.key === state.ver && 'comp-cur')}>
                    {v.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...COMMON_CATS.map((c) => c.name), ACY_CAT, SURFACE_CAT].map((name) => (
                <tr key={name}>
                  <td>{name}</td>
                  {VERSIONS.map((v) => {
                    const rows = v.acy.filter((r) => CAT_OF[r.code] === name)
                    const sum = rows.reduce((s, r) => s + r.priceFen * r.qty, 0)
                    return (
                      <td key={v.key} className={cx(v.key === state.ver && 'comp-cur')}>
                        {rows.length === 0 ? '—' : yuanText(sum)}
                      </td>
                    )
                  })}
                </tr>
              ))}
              <tr className="bom-sub-row">
                <td>整机合计</td>
                {VERSIONS.map((v) => {
                  const c = versionCost(v, {})
                  return (
                    <td key={v.key} className={cx(v.key === state.ver && 'comp-cur')}>
                      {moneyRange(c.low, c.high - c.low)}
                    </td>
                  )
                })}
              </tr>
              <tr>
                <td>成本相对指数</td>
                {VERSIONS.map((v) => (
                  <td key={v.key} className={cx(v.key === state.ver && 'comp-cur')}>
                    <b>{Math.round((versionCost(v, {}).low / baseMetal.low) * 100)}%</b>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3 className="section-title" style={{ marginTop: 0 }}>物料编码体系</h3>
        <div className="bom-scroll">
          <table className="bom-table">
            <tbody>
              {CODE_SYSTEM.map((s) => (
                <tr key={s.prefix}>
                  <td className="bom-code" style={{ width: 90 }}>{s.prefix}</td>
                  <td style={{ textAlign: 'left' }}>{s.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
