import { Capacitor, registerPlugin } from '@capacitor/core'
import { Browser } from '@capacitor/browser'
import { APP_VERSION } from './version'

/* ---------- 自研 OTA 插件（Android 原生实现在 android/.../MimOtaPlugin.java） ---------- */

type MimOtaPlugin = {
  canInstall(): Promise<{ granted: boolean }>
  requestInstallPermission(): Promise<void>
  downloadAndInstall(options: { url: string; sha256: string }): Promise<void>
}

const MimOta = registerPlugin<MimOtaPlugin>('MimOta')

/* ---------- OTA 清单（GitHub Releases latest 直链，由 r5 的 gen-ota-manifest.mjs 生成） ---------- */

type OtaManifest = {
  version: string
  android?: { url: string; sha256: string }
}

const MANIFEST_URL = 'https://github.com/afdk1991/mim/releases/latest/download/manifest.json'
/* 上架 App Store 后替换为真实链接 */
const STORE_URL = 'https://apps.apple.com/app/mim'

/* 检查间隔 ≥6h，避免每次启动都请求 Releases */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const LAST_CHECK_KEY = 'mim-ota-last-check'

/* ---------- 四段版本号比较（major.minor.patch.build，任一段大即新） ---------- */

export function isNewerVersion(current: string, next: string): boolean {
  const a = current.split('.').map((x) => parseInt(x, 10) || 0)
  const b = next.split('.').map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < 4; i++) {
    const diff = (b[i] ?? 0) - (a[i] ?? 0)
    if (diff !== 0) return diff > 0
  }
  return false
}

/* ---------- 入口：启动 8 秒后检查，不打扰首屏；web/桌面由 Tauri updater 负责，no-op ---------- */

export function scheduleOtaCheck(notify: (msg: string) => void): void {
  if (!Capacitor.isNativePlatform()) return
  setTimeout(() => {
    void checkOta(notify)
  }, 8000)
}

async function checkOta(notify: (msg: string) => void): Promise<void> {
  try {
    if (Date.now() - Number(localStorage.getItem(LAST_CHECK_KEY) ?? 0) < CHECK_INTERVAL_MS) return
    localStorage.setItem(LAST_CHECK_KEY, String(Date.now()))

    const res = await fetch(MANIFEST_URL, { cache: 'no-store' })
    if (!res.ok) return
    const manifest = (await res.json()) as OtaManifest
    if (!manifest?.version || !isNewerVersion(APP_VERSION, manifest.version)) return

    const platform = Capacitor.getPlatform()
    if (platform === 'android' && manifest.android?.url && manifest.android?.sha256) {
      await installAndroid(manifest, notify)
    } else if (platform === 'ios') {
      /* iOS 红线：禁止应用内静默自装，一律弹窗后跳 App Store */
      if (window.confirm(`Mim ${manifest.version} 已发布，是否前往 App Store 更新？`)) {
        await Browser.open({ url: STORE_URL })
      }
    }
  } catch {
    /* OTA 全链路任一环节失败均静默，不打扰用户 */
  }
}

async function installAndroid(manifest: OtaManifest, notify: (msg: string) => void): Promise<void> {
  const apk = manifest.android!
  const { granted } = await MimOta.canInstall()
  if (!granted) {
    /* 首次未授权：跳系统授权页一次，授权后下次检查自动继续 */
    await MimOta.requestInstallPermission()
    return
  }
  notify(`发现新版本 V${manifest.version}，正在自动下载并校验…`)
  /* 下载 → SHA-256 校验 → 调起系统安装器；失败抛异常由 checkOta 静默 */
  await MimOta.downloadAndInstall(apk)
}
