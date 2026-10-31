# Design Token v0 与硬件状态设计清单（12 号文）

> 责任岗位：UI/UX
> 版本：v0.1（W1 基线版）
> 日期：2026-10-30
> 消费端：小程序组件库 / Web 后台 / iOS / Android 四端共用同源 Token（01 号文技术选型表）；变更走评审后全端同步

---

## 1. Design Token v0（JSON 基线）

```json
{
  "color": {
    "brand":        { "default": "#3B6EF6", "pressed": "#2F5BD7", "disabled": "#B9CBF5" },
    "success":      "#22B07D", "warning": "#F5A623", "danger": "#E5484D",
    "text":         { "primary": "#1A1D26", "secondary": "#5A6070", "tertiary": "#9AA0AF", "inverse": "#FFFFFF" },
    "bg":           { "page": "#F6F7FA", "card": "#FFFFFF", "mask": "rgba(0,0,0,0.45)" },
    "device_state": { "online": "#22B07D", "offline": "#9AA0AF", "pairing": "#3B6EF6", "ota": "#F5A623", "error": "#E5484D" }
  },
  "font": {
    "family": "PingFang SC, HarmonyOS Sans, system-ui",
    "size":  { "xs": 11, "sm": 13, "md": 15, "lg": 17, "xl": 20, "xxl": 28 },
    "weight": { "regular": 400, "medium": 500, "semibold": 600 }
  },
  "space": { "xs": 4, "sm": 8, "md": 12, "lg": 16, "xl": 24, "xxl": 32 },
  "radius": { "sm": 6, "md": 10, "lg": 16, "pill": 999 },
  "elevation": { "card": "0 2px 8px rgba(26,29,38,0.06)", "modal": "0 8px 24px rgba(26,29,38,0.12)" }
}
```

落地：小程序转 WXSS 变量、Web 转 CSS Variables、iOS/Android 由生成脚本各出一份常量文件；四端不允许手写色值字号绕过 Token。

## 2. 硬件状态设计清单（端侧统一实现）

| 状态 | 视觉（Token 引用） | 文案基线 | 交互 |
| --- | --- | --- | --- |
| 配网中 | `device_state.pairing` 呼吸动效 | 「正在配网，请保持设备靠近」 | 进度分步可见；超时可取消回退（11 号文状态机） |
| 在线 | `device_state.online` 实心点 | 「在线」 | 可进控制与通话 |
| 离线 | `device_state.offline` 空心点 | 「设备离线，检查网络」 | 控制置灰；给重连引导；通话入口隐藏 |
| OTA 中 | `device_state.ota` 进度条 | 「升级中，请勿断电」 | 锁定控制与通话；完成自动恢复 |
| 异常 | `device_state.error` | 「设备异常，点击查看处理」 | 详情页给自助排查 + 客服入口（配网 3 次失败后同样路径，06 号文 §3.2.2） |

## 3. 权限引导文案（11 号文 §4 引用）

| 权限 | 引导文案 |
| --- | --- |
| 蓝牙 | 「需要蓝牙权限来发现并连接设备」 |
| 本地网络（iOS） | 「需要本地网络权限帮助设备接入家庭 Wi-Fi」 |
| 麦克风/摄像头 | 「用于与设备视频通话，可随时在设置中关闭」 |

被拒后：toast + 「去设置」跳转；不在会话内连续弹窗。

## 4. W1 交付边界

Token v0 只覆盖色彩/字号/间距/圆角/阴影五类；组件级规范（按钮/表单/弹窗）S2 随小程序组件库 v0 出 v0.2。硬件状态清单为本 Phase 终稿，新增设备状态需先登记本文档。
