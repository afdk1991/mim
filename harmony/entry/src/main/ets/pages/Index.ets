import { webview } from '@kit.ArkWeb'
import { http } from '@kit.NetworkKit'
import { bundleManager, common } from '@kit.AbilityKit'
import { promptAction } from '@kit.ArkUI'
import { hilog } from '@kit.PerformanceAnalysisKit'
import { preferences } from '@kit.ArkData'

/* OTA 清单结构与 Android/iOS 共用（scripts/gen-ota-manifest.mjs 生成） */
interface OtaAndroid {
  url: string
  sha256: string
}

interface OtaManifest {
  version: string
  android?: OtaAndroid
}

const DOMAIN: number = 0x0000
const TAG: string = 'MimEntry'

const MANIFEST_URL: string = 'https://github.com/afdk1991/mim/releases/latest/download/manifest.json'
/* 上架华为应用市场后启用（AppGallery 详情页 deeplink） */
const APP_GALLERY_URL: string = 'store://appgallery.huawei.com/app/detail?id=com.afdk1991.mim'
/* 隐私政策与 GitHub Pages 版 public/privacy.html 同源，商店侧填写同一 URL */
const PRIVACY_POLICY_URL: string = 'https://afdk1991.github.io/mim/privacy.html'
/* 首启隐私同意凭据：存应用偏好，卸载即清除 */
const PREF_NAME: string = 'mim_runtime'
const KEY_PRIVACY_AGREED: string = 'privacy_agreed'
/* 同意条款版本，条款实质变更时递增以触发重新同意 */
const CONSENT_VERSION: string = '0.0.0.1'

/* 首启隐私弹窗摘要（与 public/privacy.html 口径一致） */
const PRIVACY_SUMMARY: string[] = [
  '一、本应用提供内容浏览、发布与交流功能。我们遵循《中华人民共和国个人信息保护法》最小必要原则处理你的信息。',
  '二、不收集：本应用不读取通讯录、位置、相册、麦克风、相机与设备标识，也不接入第三方广告或统计 SDK。',
  '三、本地存储：昵称、头像、草稿、浏览记录等仅保存在你的设备上（应用本地存储），卸载应用即全部清除。',
  '四、网络请求：应用仅在启动后访问版本清单检查更新，该请求只携带当前版本号，不携带任何设备标识或个人信息。',
  '五、你可在「我的 → 设置」清空本地数据，或直接卸载应用行使删除权。',
  '六、未成年人应在监护人指导下使用本应用。',
  '点击「同意并继续」即表示你已阅读并同意上述内容及完整隐私政策。'
]

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
  /* 是否已同意隐私条款；consentChecked 为 false 时表示本地标记尚未读取完（首帧占位） */
  @State agreed: boolean = false
  @State consentChecked: boolean = false

  aboutToAppear(): void {
    this.loadConsent()
  }

  private async loadConsent(): Promise<void> {
    try {
      const store: preferences.Preferences = await preferences.getPreferences(getContext(this), PREF_NAME)
      const saved = await store.get(KEY_PRIVACY_AGREED, '')
      this.agreed = saved === CONSENT_VERSION
    } catch (err) {
      hilog.error(DOMAIN, TAG, 'Failed to read consent: %{public}s', JSON.stringify(err))
      this.agreed = false
    }
    this.consentChecked = true
    if (this.agreed) {
      this.checkOta()
    }
  }

  private async acceptConsent(): Promise<void> {
    this.agreed = true
    this.checkOta()
    try {
      const store: preferences.Preferences = await preferences.getPreferences(getContext(this), PREF_NAME)
      await store.put(KEY_PRIVACY_AGREED, CONSENT_VERSION)
      await store.flush()
    } catch (err) {
      hilog.error(DOMAIN, TAG, 'Failed to save consent: %{public}s', JSON.stringify(err))
    }
  }

  /* 调起系统浏览器打开完整隐私政策，拉起失败不影响本地同意 */
  private openPolicy(): void {
    try {
      const ctx = getContext(this) as common.UIAbilityContext
      ctx.openLink(PRIVACY_POLICY_URL).catch(() => {
        promptAction.showToast({ message: '无法打开浏览器，请手动访问 ' + PRIVACY_POLICY_URL })
      })
    } catch (err) {
      hilog.error(DOMAIN, TAG, 'Failed to open policy: %{public}s', JSON.stringify(err))
    }
  }

  /* 不同意即退出应用（不进入首页、不发起任何网络请求） */
  private exitApp(): void {
    try {
      const ctx = getContext(this) as common.UIAbilityContext
      ctx.terminateSelf()
    } catch (err) {
      hilog.error(DOMAIN, TAG, 'Failed to terminate: %{public}s', JSON.stringify(err))
    }
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
        hilog.info(DOMAIN, TAG, 'update confirmed: %{public}s %{public}s', version, APP_GALLERY_URL)
      }
    }).catch(() => {
      /* 用户取消或弹窗失败，静默 */
    })
  }

  @Builder
  PrivacyGate() {
    Column() {
      Text('隐私政策与用户协议')
        .fontSize(22)
        .fontWeight(FontWeight.Bold)
        .fontColor('#1a1a1a')
        .margin({ top: 8, bottom: 4 })
      Text('请阅读以下条款，同意后开始使用 Mim')
        .fontSize(13)
        .fontColor('#666666')
        .margin({ bottom: 16 })

      Scroll() {
        Text(PRIVACY_SUMMARY.join('\n\n'))
          .fontSize(14)
          .lineHeight(22)
          .fontColor('#333333')
          .width('100%')
          .textAlign(TextAlign.Start)
      }
      .layoutWeight(1)
      .align(Alignment.Top)
      .width('100%')
      .padding(16)
      .backgroundColor('#f7f7f7')
      .borderRadius(12)

      Text('查看完整隐私政策')
        .fontSize(14)
        .fontColor('#ff8200')
        .decoration({ type: TextDecorationType.Underline, color: '#ff8200' })
        .margin({ top: 12, bottom: 12 })
        .onClick(() => this.openPolicy())

      Button('同意并继续')
        .width('100%')
        .height(44)
        .backgroundColor('#ff8200')
        .fontColor('#ffffff')
        .borderRadius(22)
        .onClick(() => {
          this.acceptConsent()
        })

      Button('不同意并退出')
        .width('100%')
        .height(40)
        .backgroundColor(Color.Transparent)
        .fontColor('#999999')
        .margin({ top: 8 })
        .onClick(() => this.exitApp())
    }
    .width('100%')
    .height('100%')
    .padding({ left: 24, right: 24, top: 40, bottom: 24 })
    .backgroundColor('#ffffff')
  }

  build() {
    Column() {
      if (!this.consentChecked) {
        Column() {
          LoadingProgress()
            .width(48)
            .height(48)
            .color('#ff8200')
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.Center)
      } else if (this.agreed) {
        Web({ src: $rawfile('index.html'), controller: this.controller })
          .javaScriptAccess(true)
          .domStorageAccess(true)
          .width('100%')
          .height('100%')
      } else {
        this.PrivacyGate()
      }
    }
    .width('100%')
    .height('100%')
  }
}
