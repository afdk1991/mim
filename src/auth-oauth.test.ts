/* GitHub 第三方登录链路测试（vitest，node 环境，直连真实 Supabase 项目）。
   覆盖三层：
   1) 端点集成：/auth/v1/settings 公开端点确认 github provider 已启用
      （复刻 auth.tsx 的 oauthProviders 探测逻辑，登录页按钮由它驱动）；
   2) OAuth 授权 URL：signInWithOAuth 用 skipBrowserRedirect 免真实跳转，
      断言生成的 authorize URL 带 provider=github 且 redirect_to 指向站点入口；
   3) 白名单契约：各部署环境（GitHub Pages 子路径 / EdgeOne / 本地 dev）的
      回跳地址（origin + pathname，与 auth.tsx 一致）必须命中 Supabase
      Redirect URLs 白名单通配，并锁死「origin 缺子路径」的历史回归。 */

import { describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const env = import.meta.env as Record<string, string | undefined>
const SUPABASE_URL = env.VITE_SUPABASE_URL ?? 'https://sepfobukokrrivwyvhnd.supabase.co'
const ANON_KEY =
  env.VITE_SUPABASE_ANON_KEY ?? 'sb_publishable_TV4e4DtFiufiJiY05WSFsQ_2FmlMCUg'

/* Supabase 控制台 URL Configuration 已保存的 Redirect URLs 白名单（与线上配置一致） */
const WHITELIST = [
  'https://afdk1991.github.io/mim/**',
  'https://mim-yrchrlps.edgeone.cool/**',
  'http://localhost:5173/**',
]

/* 各部署环境的站点入口（origin + pathname；应用为 hash 路由，pathname 恒定，
   与 auth.tsx signInWithOAuth 的 redirectTo 计算方式一致） */
const ENTRY_POINTS = [
  'https://afdk1991.github.io/mim/',
  'https://mim-yrchrlps.edgeone.cool/',
  'http://localhost:5173/',
]

/** 白名单通配匹配：pattern 形如 https://host/path/**，URL 前缀一致即命中 */
function matchesWhitelist(pattern: string, redirect: string): boolean {
  return redirect.startsWith(pattern.slice(0, -2))
}

/* GoTrue /auth/v1/settings 的 external 为 provider → boolean 布尔映射
   （如 "github": true），兼容旧版 { enabled: boolean } 对象形态 */
function providerEnabled(v: unknown): boolean {
  return typeof v === 'boolean' ? v : (v as { enabled?: boolean } | null)?.enabled === true
}

describe('GitHub 登录 · /auth/v1/settings 端点集成', () => {
  it('github provider 已在后台启用（external.github = true）', async () => {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: ANON_KEY },
    })
    expect(res.ok).toBe(true)
    const settings = (await res.json()) as {
      external?: Record<string, boolean | { enabled?: boolean }>
    }
    expect(providerEnabled(settings.external?.github)).toBe(true)
  })

  it('按 auth.tsx 探测逻辑解析出的 oauthProviders 包含 github', async () => {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: ANON_KEY },
    })
    const settings = (await res.json()) as {
      external?: Record<string, boolean | { enabled?: boolean }>
    }
    const providers = Object.entries(settings.external ?? {})
      .filter(([, v]) => providerEnabled(v))
      .map(([k]) => k)
    expect(providers).toContain('github')
  })
})

describe('GitHub 登录 · OAuth 授权 URL 生成', () => {
  const supabase = createClient(SUPABASE_URL, ANON_KEY)

  it.each(ENTRY_POINTS)(
    'redirectTo=%s 时 authorize URL 带 provider=github 与回跳参数',
    async (redirectTo) => {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'github',
        options: { redirectTo, skipBrowserRedirect: true },
      })
      expect(error).toBeNull()
      expect(data.url).toBeTruthy()

      const url = new URL(data.url!) // 上一行已断言非空
      expect(`${url.origin}${url.pathname}`).toBe(`${SUPABASE_URL}/auth/v1/authorize`)
      expect(url.searchParams.get('provider')).toBe('github')
      expect(url.searchParams.get('redirect_to')).toBe(redirectTo)
    },
  )
})

describe('GitHub 登录 · Redirect URLs 白名单契约', () => {
  it('全部白名单条目均为合法的 ** 通配形式', () => {
    for (const p of WHITELIST) {
      expect(p.endsWith('/**')).toBe(true)
      expect(() => new URL(p.slice(0, -2))).not.toThrow()
    }
  })

  it.each(ENTRY_POINTS)('站点入口 %s 命中白名单', (entry) => {
    expect(WHITELIST.some((p) => matchesWhitelist(p, entry))).toBe(true)
  })

  it('域名根路径（修复前 bug 场景）不匹配 GitHub Pages 子路径白名单', () => {
    // auth.tsx 修复前用 window.location.origin（https://afdk1991.github.io），
    // 不含 /mim/ 子路径，回跳会被 Supabase 白名单拒绝——此处锁死该回归
    expect(matchesWhitelist(WHITELIST[0], 'https://afdk1991.github.io/')).toBe(false)
  })
})
