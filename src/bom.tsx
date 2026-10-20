import { Fragment, useEffect, useState } from 'react'
import { cx } from './utils'
import { pullToolState, pushToolState } from './lib/tool-cloud'

/* ============================================================
 * BOM 工具台 —— 重新开发自合并源码 chassis-bom-tool（机箱 BOM 清单）
 * 纯前端 mock：四版本 BOM 明细 / 数量可调实时计价 / 成本对比汇总
 * 汇总全部由明细动态计算（母本手写汇总与明细差 174.4 元的缺陷在此修复）
 * ============================================================ */

interface BomRow {
  code: string
  name: string
  spec: string
  qty: number
  price: number
}

interface BomVersion {
  key: string
  name: string
  desc: string
  surface: [number, number]
  acy: BomRow[]
}

interface BomState {
  ver: string
  qtys: Record<string, number>
}

const STORAGE_KEY = 'mim-bom-v1'

/* ---------- 物料数据（200×350×350 紧凑型三层卧式机箱） ---------- */

const CATEGORIES: { name: string; rows: BomRow[] }[] = [
  {
    name: '通用基础件（全配置通用）',
    rows: [
      { code: 'G-001', name: '通用主机架总成', spec: '200(W)×350(D)×350(H)mm SPCC 1.2mm喷塑', qty: 1, price: 180 },
      { code: 'G-002', name: '三层导轨安装座', spec: '标准8英寸导轨孔距 SPCC 1.0mm喷塑', qty: 6, price: 8 },
      { code: 'G-003', name: '背部通用背板框架', spec: '190×340mm SPCC 1.2mm喷塑', qty: 1, price: 45 },
      { code: 'G-004', name: '层间隔板通用框', spec: '190×340mm，带导风圈位 SPCC 1.0mm喷塑', qty: 2, price: 32 },
      { code: 'G-005', name: '机箱脚垫', spec: 'Φ15×6mm 防滑丁腈橡胶', qty: 4, price: 1.8 },
      { code: 'G-006', name: '通用基础紧固件包', spec: 'M3/M4螺丝、平垫、弹垫', qty: 1, price: 15 },
      { code: 'G-007', name: '接地铜带组件', spec: '5×0.5mm 紫铜', qty: 1, price: 12 },
    ],
  },
  {
    name: '存储抽屉模块（2块3.5寸+2块2.5寸）',
    rows: [
      { code: 'M1-001', name: '硬盘笼本体', spec: '1列2排3.5寸+2位2.5寸，SPCC 0.8mm喷塑', qty: 1, price: 85 },
      { code: 'M1-002', name: '3.5寸硬盘托架', spec: '标准硬盘位，带减震位 SPCC 0.6mm喷塑', qty: 2, price: 5.5 },
      { code: 'M1-003', name: '2.5寸SSD托架', spec: '亚克力/金属，适配2.5寸硬盘', qty: 2, price: 4 },
      { code: 'M1-004', name: '抽拉导轨', spec: '8英寸二节钢珠导轨 镀锌钢', qty: 2, price: 22 },
      { code: 'M1-005', name: '前部锁止拉手', spec: '带到位锁定+解锁按键', qty: 1, price: 15 },
      { code: 'M1-006', name: '硬盘状态指示灯组', spec: 'Φ3mm 红色LED', qty: 4, price: 0.8 },
      { code: 'M1-007', name: '内置SATA背板', spec: '4口SATA+供电一体化 PCB', qty: 1, price: 55 },
      { code: 'M1-008', name: '层板导风密封圈', spec: '适配风道接口 阻燃海绵', qty: 1, price: 5 },
    ],
  },
  {
    name: '计算抽屉模块（ITX单主板+全高显卡）',
    rows: [
      { code: 'M2-001', name: 'ITX主板安装托盘', spec: '180×180mm，M3铜柱孔阵 SPCC 0.8mm喷塑', qty: 1, price: 35 },
      { code: 'M2-002', name: '主板铜柱组', spec: 'M3×6+6 黄铜', qty: 6, price: 0.8 },
      { code: 'M2-003', name: '全高显卡固定支架', spec: '双槽位尾部支撑 SPCC 1.0mm喷塑', qty: 1, price: 18 },
      { code: 'M2-004', name: '内部理线架', spec: '适配背部走线 SPCC 0.6mm喷塑', qty: 1, price: 10 },
      { code: 'M2-005', name: 'CPU区域导风罩', spec: '引导气流覆盖核心区 ABS阻燃', qty: 1, price: 8 },
      { code: 'M2-006', name: '供电转接板', spec: '24Pin+8Pin 盲插转接 PCB', qty: 1, price: 32 },
      { code: 'M2-007', name: 'PCI-E显卡支撑柱', spec: '可调节高度，磁吸底座', qty: 1, price: 12 },
    ],
  },
  {
    name: '电源抽屉模块（单ATX）',
    rows: [
      { code: 'M3-001', name: '电源舱框架', spec: '单ATX位 SPCC 1.0mm喷塑', qty: 1, price: 38 },
      { code: 'M3-002', name: 'ATX电源固定支架', spec: '标准ATX孔位 SPCC 1.0mm喷塑', qty: 1, price: 8 },
      { code: 'M3-003', name: '电源减震胶垫组', spec: '10×10×3mm 丁腈橡胶', qty: 4, price: 1.2 },
      { code: 'M3-004', name: '抽拉导轨', spec: '8英寸二节钢珠导轨 镀锌钢', qty: 1, price: 22 },
      { code: 'M3-005', name: '内置配电背板', spec: '单电源输入+统一输出 PCB', qty: 1, price: 38 },
      { code: 'M3-006', name: '前部拉手', spec: '带定位凸点 SPCC喷塑', qty: 1, price: 12 },
    ],
  },
  {
    name: '前面板模块（3风扇）',
    rows: [
      { code: 'M4-001', name: '前面板本体', spec: '200×350mm，3组风扇孔 SPCC 1.2mm喷塑', qty: 1, price: 55 },
      { code: 'M4-002', name: '12025 PWM进风风扇', spec: 'DC12V，≥50CFM', qty: 3, price: 25 },
      { code: 'M4-003', name: '防尘网框+滤网', spec: '120×120mm，300目', qty: 3, price: 4 },
      { code: 'M4-004', name: '前置IO组件', spec: 'USB-A×2+Type-C×1+音频', qty: 1, price: 25 },
      { code: 'M4-005', name: '开关指示灯组', spec: '单电源开关+电源灯', qty: 1, price: 10 },
      { code: 'M4-006', name: '快拆卡扣', spec: '弹簧卡扣式 镀锌钢', qty: 2, price: 3 },
    ],
  },
  {
    name: '后面板模块（2风扇）',
    rows: [
      { code: 'M5-001', name: '后面板本体', spec: '200×350mm，带IO/PCI/电源孔 SPCC 1.2mm喷塑', qty: 1, price: 48 },
      { code: 'M5-002', name: '12025 PWM排风风扇', spec: 'DC12V，≥50CFM', qty: 2, price: 25 },
      { code: 'M5-003', name: '主板I/O挡板', spec: '标准ITX IO尺寸 SPCC', qty: 1, price: 4 },
      { code: 'M5-004', name: 'PCI挡板', spec: '双槽位空白挡片 SPCC', qty: 1, price: 2 },
      { code: 'M5-005', name: 'AC品字输入插座', spec: '10A带保险丝', qty: 1, price: 7 },
      { code: 'M5-006', name: '固定手拧螺丝', spec: 'M4 镀锌钢', qty: 2, price: 1.2 },
    ],
  },
  {
    name: '标准化接口组件',
    rows: [
      { code: 'IF-001', name: '电源盲插连接器组', spec: '24Pin+8Pin 防呆设计 ≥1000次插拔', qty: 1, price: 38 },
      { code: 'IF-002', name: '数据盲插连接器', spec: 'SATA 7Pin+15Pin ≥500次插拔', qty: 1, price: 25 },
      { code: 'IF-003', name: '信号盲插连接器', spec: '10Pin主板信号 键位防呆', qty: 1, price: 18 },
      { code: 'IF-004', name: '锥形定位销组', spec: 'Φ5mm 不锈钢 带倒角', qty: 4, price: 6 },
      { code: 'IF-005', name: '风道密封泡棉组', spec: '阻燃海绵 1mm厚 各层接口', qty: 1, price: 18 },
    ],
  },
  {
    name: '通用外购件与生产辅料',
    rows: [
      { code: 'GP-001', name: '散热风扇控制器', spec: 'PWM 5路 温度调速', qty: 1, price: 32 },
      { code: 'GP-002', name: '温度传感器组', spec: 'NTC 10K 三线制', qty: 3, price: 3 },
      { code: 'GP-003', name: '内部连接线束', spec: '定制长度 镀锡铜 含标签', qty: 1, price: 35 },
      { code: 'GP-004', name: '铭牌与标识贴', spec: '激光雕刻铝铭牌+丝印标识', qty: 1, price: 12 },
      { code: 'GP-005', name: '包装材料', spec: 'EPE珍珠棉+五层瓦楞纸箱', qty: 1, price: 22 },
      { code: 'GP-006', name: '出厂质检报告', spec: '含尺寸/电气/外观检验记录', qty: 1, price: 15 },
      { code: 'GP-007', name: '安装说明书', spec: '彩色印刷 含装配步骤图', qty: 1, price: 10 },
    ],
  },
]

const VERSIONS: BomVersion[] = [
  {
    key: 'metal',
    name: '全金属标准版',
    desc: '全钣金结构，无亚克力件；2块3.5寸+2块2.5寸+ITX主板+单ATX电源+全高显卡 | 计价基准：100台批量，不含核心硬件',
    surface: [180, 320],
    acy: [],
  },
  {
    key: 'plan-a',
    name: '方案A·基础透明款',
    desc: '磨砂顶盖+金属侧板+透明导风罩+SSD托架+理线架 | 计价基准：100台批量，不含核心硬件',
    surface: [150, 260],
    acy: [
      { code: 'ACY-001', name: '磨砂半透亚克力顶盖', spec: '198×348×3mm 雾度70% V0阻燃 含铜套', qty: 1, price: 38 },
      { code: 'ACY-002', name: 'CPU透明导风罩', spec: '80×70×25mm 耐温≥85℃ V0阻燃', qty: 1, price: 12 },
      { code: 'ACY-004', name: '2.5寸SSD亚克力托架', spec: '100×70×3mm 黑色半透 含铜套', qty: 2, price: 6 },
      { code: 'ACY-005', name: '亚克力理线架+导光条', spec: '2mm黑色磨砂理线架+φ5透明导光条', qty: 1, price: 10 },
    ],
  },
  {
    key: 'plan-b',
    name: '方案B·透明定制款',
    desc: '磨砂顶盖+侧板观察窗+透明导风罩+SSD托架+理线架（主推） | 计价基准：100台批量，不含核心硬件',
    surface: [150, 260],
    acy: [
      { code: 'ACY-001', name: '磨砂半透亚克力顶盖', spec: '198×348×3mm 雾度70% V0阻燃 含铜套', qty: 1, price: 38 },
      { code: 'ACY-002', name: 'CPU透明导风罩', spec: '80×70×25mm 耐温≥85℃ V0阻燃', qty: 1, price: 12 },
      { code: 'ACY-003', name: '侧板透明观察窗', spec: '120×150×4mm 高透 V0阻燃 含密封', qty: 1, price: 45 },
      { code: 'ACY-004', name: '2.5寸SSD亚克力托架', spec: '100×70×3mm 黑色半透 含铜套', qty: 2, price: 6 },
      { code: 'ACY-005', name: '亚克力理线架+导光条', spec: '2mm黑色磨砂理线架+φ5透明导光条', qty: 1, price: 10 },
    ],
  },
  {
    key: 'concept',
    name: '概念展示版',
    desc: '全透明亚克力外壳+灯效优化+模块识别色 | 样机级配置，计价基准：10台小批量，不含核心硬件',
    surface: [280, 480],
    acy: [
      { code: 'ACY-G-01', name: '全透明亚克力顶盖', spec: '198×348×4mm 高透 V0阻燃 边缘高光', qty: 1, price: 55 },
      { code: 'ACY-G-02', name: '全透明亚克力侧板', spec: '348×340×4mm 高透 左右各一 含铜套', qty: 2, price: 65 },
      { code: 'ACY-G-03', name: '前面板进风区透明件', spec: '198×80×3mm 高透 带风扇孔位', qty: 1, price: 28 },
      { code: 'ACY-002', name: 'CPU透明导风罩（蓝透）', spec: '80×70×25mm 蓝色透明 耐温≥85℃', qty: 1, price: 15 },
      { code: 'ACY-004', name: '2.5寸SSD亚克力托架', spec: '100×70×3mm 透明 含铜套', qty: 2, price: 8 },
      { code: 'ACY-G-04', name: '模块识别色装饰条', spec: 'ABS+亚克力 三色分区标识', qty: 1, price: 22 },
      { code: 'ACY-G-05', name: '灯效导光系统', spec: 'RGB灯带+导光板+控制器', qty: 1, price: 55 },
    ],
  },
]

const CODE_SYSTEM = [
  { prefix: 'G-', desc: '通用金属结构件（机架 / 导轨座 / 背板 / 紧固件）' },
  { prefix: 'M1~M5', desc: '五大模块件（存储 / 计算 / 电源 / 前面板 / 后面板）' },
  { prefix: 'IF-', desc: '标准化接口组件（盲插连接器 / 定位销 / 密封泡棉）' },
  { prefix: 'GP-', desc: '通用外购件与生产辅料（线束 / 控制器 / 包装）' },
  { prefix: 'ACY-', desc: '亚克力专属件（顶盖 / 观察窗 / 导光条 / 灯效）' },
  { prefix: 'ASS-', desc: '表面处理与装配（喷塑 / 抛光 / 组装 / 质检）' },
]

/* ---------- 持久化 ---------- */

function clampQty(n: unknown): number | null {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null
  const q = Math.round(n)
  return q >= 1 && q <= 99 ? q : null
}

function loadBom(): BomState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<BomState>
      if (parsed && VERSIONS.some((v) => v.key === parsed.ver)) {
        const qtys: Record<string, number> = {}
        if (parsed.qtys && typeof parsed.qtys === 'object') {
          for (const [code, n] of Object.entries(parsed.qtys)) {
            const q = clampQty(n)
            if (q !== null) qtys[code] = q
          }
        }
        return { ver: parsed.ver as string, qtys }
      }
    }
  } catch {
    /* 忽略损坏的本地数据，使用默认状态 */
  }
  return { ver: VERSIONS[0].key, qtys: {} }
}

/* ---------- 计价 ---------- */

function fmtMoney(n: number): string {
  const r = Math.round(n * 10) / 10
  return Number.isInteger(r) ? r.toLocaleString() : r.toFixed(1)
}

const DEFAULT_VERSION = VERSIONS[0]

function versionCosts(v: BomVersion, qtys: Record<string, number>) {
  const sub = (rows: BomRow[]) => rows.reduce((s, r) => s + (qtys[r.code] ?? r.qty) * r.price, 0)
  const catTotals = CATEGORIES.map((c) => sub(c.rows))
  const acyTotal = sub(v.acy)
  const common = catTotals[0]
  const modules = catTotals[1] + catTotals[2] + catTotals[3] + catTotals[4] + catTotals[5]
  const iface = catTotals[6] + catTotals[7]
  const low = common + modules + acyTotal + iface + v.surface[0]
  return { common, modules, acy: acyTotal, iface, surface: v.surface, low, high: low + (v.surface[1] - v.surface[0]) }
}

/* ---------- 页面 ---------- */

export function BomToolPage() {
  const [state, setState] = useState<BomState>(loadBom)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      /* ignore */
    }
    pushToolState(STORAGE_KEY, state) // 云端整包快照（未登录/未配置时静默跳过）
  }, [state])

  /* 云端恢复（轮 6）：mount 拉取快照 → 写回本地 → 重载（幂等触发上方保存钩子回推） */
  useEffect(() => {
    void pullToolState(STORAGE_KEY).then((d) => {
      if (!d || typeof d !== 'object') return
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)) } catch { /* ignore */ }
      setState(loadBom())
    })
  }, [])

  const version = VERSIONS.find((v) => v.key === state.ver) ?? DEFAULT_VERSION
  const dirty = Object.keys(state.qtys).length > 0
  const base = versionCosts(version, {})
  const cur = versionCosts(version, state.qtys)
  const baseMetal = versionCosts(DEFAULT_VERSION, {})

  const rowCount = CATEGORIES.reduce((s, c) => s + c.rows.length, 0) + version.acy.length
  const delta = cur.low - base.low

  const switchVer = (key: string) => setState({ ver: key, qtys: state.qtys })

  const changeQty = (code: string, def: number, delta2: number) => {
    const next = Math.min(99, Math.max(1, (state.qtys[code] ?? def) + delta2))
    setState({ ver: state.ver, qtys: { ...state.qtys, [code]: next } })
  }

  const compRows: { label: string; get: (c: ReturnType<typeof versionCosts>) => number; range?: boolean }[] = [
    { label: '通用金属结构件', get: (c) => c.common },
    { label: '功能模块结构件', get: (c) => c.modules },
    { label: '亚克力件', get: (c) => c.acy },
    { label: '接口与电气件', get: (c) => c.iface },
    { label: '表面处理与装配', get: (c) => c.surface[0], range: true },
  ]

  return (
    <div className="page-grid single">
      <div>
        <h2 className="page-title">🧰 机箱 BOM 工具台</h2>
        <p className="muted" style={{ margin: '0 0 12px' }}>
          紧凑型三层卧式模块化机箱（200×350×350mm）· 四版本分版清单 · 数量可调实时计价
        </p>

        <div className="board-toolbar" style={{ marginBottom: 12 }}>
          <div>
            {VERSIONS.map((v) => (
              <button
                key={v.key}
                className={cx('chip', state.ver === v.key && 'active')}
                style={{ marginRight: 8 }}
                onClick={() => switchVer(v.key)}
              >
                {v.name}
              </button>
            ))}
          </div>
          <button
            className="btn btn-ghost btn-sm"
            disabled={!dirty}
            onClick={() => setState({ ver: state.ver, qtys: {} })}
          >
            恢复默认数量
          </button>
        </div>

        <div className="stat-row">
          <div className="stat-box">
            <b>
              ¥{fmtMoney(cur.low)}<small style={{ fontSize: 14 }}> ~ {fmtMoney(cur.high)}</small>
            </b>
            <span>整机合计（不含核心硬件）</span>
          </div>
          <div className="stat-box">
            <b>{rowCount}</b>
            <span>物料项 · {CATEGORIES.length} 大分类</span>
          </div>
          <div className="stat-box">
            <b>{Math.round((cur.low / baseMetal.low) * 100)}%</b>
            <span>成本相对指数（以全金属版为基准）</span>
          </div>
          <div className="stat-box">
            <b style={{ color: delta === 0 ? undefined : delta > 0 ? 'var(--danger)' : '#2b9cf4' }}>
              {delta === 0 ? '±0' : `${delta > 0 ? '+' : ''}${fmtMoney(delta)}`}
            </b>
            <span>较默认 BOM 偏差{dirty ? '（已手动调整）' : ''}</span>
          </div>
        </div>

        <div className="card">
          <p className="muted" style={{ marginTop: 0, marginBottom: 10 }}>{version.desc}</p>
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
              {CATEGORIES.map((cat) => {
                const total = cat.rows.reduce((s, r) => s + (state.qtys[r.code] ?? r.qty) * r.price, 0)
                return (
                  <Fragment key={cat.name}>
                    <tr className="bom-cat">
                      <td colSpan={6}>{cat.name}</td>
                    </tr>
                    {cat.rows.map((r) => {
                      const qty = state.qtys[r.code] ?? r.qty
                      return (
                        <tr key={r.code}>
                          <td className="bom-code">{r.code}</td>
                          <td>{r.name}</td>
                          <td className="bom-spec">{r.spec}</td>
                          <td>
                            <span className="qty-ctl">
                              <button className="qty-btn" onClick={() => changeQty(r.code, r.qty, -1)}>
                                −
                              </button>
                              <b>{qty}</b>
                              <button className="qty-btn" onClick={() => changeQty(r.code, r.qty, 1)}>
                                +
                              </button>
                            </span>
                          </td>
                          <td>{fmtMoney(r.price)}</td>
                          <td className="bom-sub">{fmtMoney(qty * r.price)}</td>
                        </tr>
                      )
                    })}
                    <tr className="bom-sub-row">
                      <td colSpan={5}>{cat.name} 小计</td>
                      <td>{fmtMoney(total)}</td>
                    </tr>
                  </Fragment>
                )
              })}
              {version.acy.length > 0 && (
                <>
                  <tr className="bom-cat">
                    <td colSpan={6}>亚克力件（本版本专属）</td>
                  </tr>
                  {version.acy.map((r) => {
                    const qty = state.qtys[r.code] ?? r.qty
                    return (
                      <tr key={r.code}>
                        <td className="bom-code">{r.code}</td>
                        <td>{r.name}</td>
                        <td className="bom-spec">{r.spec}</td>
                        <td>
                          <span className="qty-ctl">
                            <button className="qty-btn" onClick={() => changeQty(r.code, r.qty, -1)}>
                              −
                            </button>
                            <b>{qty}</b>
                            <button className="qty-btn" onClick={() => changeQty(r.code, r.qty, 1)}>
                              +
                            </button>
                          </span>
                        </td>
                        <td>{fmtMoney(r.price)}</td>
                        <td className="bom-sub">{fmtMoney(qty * r.price)}</td>
                      </tr>
                    )
                  })}
                  <tr className="bom-sub-row">
                    <td colSpan={5}>亚克力件 小计</td>
                    <td>{fmtMoney(version.acy.reduce((s, r) => s + (state.qtys[r.code] ?? r.qty) * r.price, 0))}</td>
                  </tr>
                </>
              )}
              <tr>
                <td className="bom-code">ASS-001</td>
                <td>表面处理与整机组装</td>
                <td className="bom-spec">喷塑/抛光/装配/质检/包装</td>
                <td>1</td>
                <td>
                  {version.surface[0]}~{version.surface[1]}
                </td>
                <td className="bom-sub">
                  {version.surface[0]}~{version.surface[1]}
                </td>
              </tr>
              <tr className="bom-grand">
                <td colSpan={5}>整机成本合计（不含主板/硬盘/电源/显卡等核心硬件）</td>
                <td>
                  约 {fmtMoney(cur.low)}~{fmtMoney(cur.high)} 元
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="card">
          <h3 style={{ margin: '0 0 10px' }}>四版本成本对比汇总</h3>
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
              {compRows.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  {VERSIONS.map((v) => {
                    const c = versionCosts(v, {})
                    const val = row.get(c)
                    return (
                      <td key={v.key} className={cx(v.key === state.ver && 'comp-cur')}>
                        {row.range ? `${fmtMoney(val)}~${fmtMoney(val + (c.surface[1] - c.surface[0]))}` : fmtMoney(val)}
                      </td>
                    )
                  })}
                </tr>
              ))}
              <tr className="bom-sub-row">
                <td>整机合计</td>
                {VERSIONS.map((v) => {
                  const c = versionCosts(v, {})
                  return (
                    <td key={v.key} className={cx(v.key === state.ver && 'comp-cur')}>
                      {fmtMoney(c.low)}~{fmtMoney(c.high)}
                    </td>
                  )
                })}
              </tr>
              <tr>
                <td>成本相对指数</td>
                {VERSIONS.map((v) => {
                  const c = versionCosts(v, {})
                  const pct = Math.round((c.low / baseMetal.low) * 100)
                  const w = Math.min(100, Math.round((pct / 140) * 100))
                  return (
                    <td key={v.key} className={cx('comp-idx', v.key === state.ver && 'comp-cur')}>
                      <span className="comp-bar" style={{ width: `${w}%` }} />
                      <b>{pct}%</b>
                    </td>
                  )
                })}
              </tr>
            </tbody>
          </table>
        </div>

        <div className="card">
          <h3 style={{ margin: '0 0 10px' }}>物料编码体系</h3>
          <table className="bom-table">
            <tbody>
              {CODE_SYSTEM.map((s) => (
                <tr key={s.prefix}>
                  <td className="bom-code" style={{ width: 90 }}>
                    {s.prefix}
                  </td>
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
