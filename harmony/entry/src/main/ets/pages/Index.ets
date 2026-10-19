import { webview } from '@kit.ArkWeb'
import { http } from '@kit.NetworkKit'
import { bundleManager } from '@kit.AbilityKit'
import { promptAction } from '@kit.ArkUI'
import { hilog } from '@kit.PerformanceAnalysisKit'

/* OTA 清单结构与 Android/iOS 共用（scripts/gen-ota-manifest.mjs 生成） */
interface OtaAndroid {
  url: string
  sha256: string
}

interface OtaManifest {
  version: string
  android?: OtaAndroid
}

const MANIFEST_URL: string = 'https://github.com/afdk1991/mim/releases/latest/download/manifest.json'
/* 上架华为应用市场后启用（AppGallery 详情页 deeplink） */
const APP_GALLERY_URL: string = 'store://appgallery.huawei.com/app/detail?id=com.afdk1991.mim'

/* 四段版本比较：next > current 返回 true */
function isNewer(current: string, next: string): boolean {
  const a: number[] = current.split('.').map((x: string): number => parseInt(x, 10) || 0)
  const b: number[] = next.split('.').map((x: string): number => parseInt(x, 10) || 0)
  for (let i = 0; i < 4; i++) {
    const diff = (b[i] ?? 0) - (a[i] ?? 0)
    if (diff !== 0) {
      return diff > 0
    }
  }
  return false
}

@Entry
@Component
struct Index {
  controller: webview.WebviewController = new webview.WebviewController()

  aboutToAppear(): void {
    this.checkOta()
  }

  /* 拉取 OTA 清单，发现新版本弹窗引导更新；任一环节失败均静默 */
  private checkOta(): void {
    try {
      const info: bundleManager.BundleInfo =
        bundleManager.getBundleInfoForSelfSync(bundleManager.BundleFlag.GET_BUNDLE_INFO_DEFAULT)
      const current: string = info.versionName
      const client: http.HttpRequest = http.createHttp()
      const req: http.HttpRequestOptions = { method: http.RequestMethod.GET, usingCache: false }
      client.request(MANIFEST_URL, req).then((res: http.HttpResponse) => {
        if (res.responseCode === 200) {
          const manifest: OtaManifest = JSON.parse(res.result as string) as OtaManifest
          if (manifest.version && isNewer(current, manifest.version)) {
            this.showUpdateDialog(manifest.version)
          }
        }
        client.destroy()
      }).catch(() => {
        client.destroy()
      })
    } catch {
      /* OTA 检测失败静默忽略，不影响 WebView 加载 */
    }
  }

  private showUpdateDialog(version: string): void {
    promptAction.showDialog({
      title: '发现新版本',
      message: `Mim ${version} 已发布，是否前往应用市场更新？`,
      buttons: [
        { text: '稍后再说', color: '#999999' },
        { text: '立即更新', color: '#ff8200' }
      ]
    }).then((index: number) => {
      if (index === 1) {
        /* TODO 上架 AppGallery 后启用跳转：
         * const ctx = getContext(this) as common.UIAbilityContext
         * ctx.openLink(APP_GALLERY_URL)
         */
        hilog.info(0x0000, 'MimEntry', 'update confirmed: %{public}s %{public}s', version, APP_GALLERY_URL)
      }
    }).catch(() => {
      /* 用户取消或弹窗失败，静默 */
    })
  }

  build() {
    Column() {
      Web({ src: $rawfile('index.html'), controller: this.controller })
        .javaScriptAccess(true)
        .domStorageAccess(true)
        .width('100%')
        .height('100%')
    }
    .width('100%')
    .height('100%')
  }
}
