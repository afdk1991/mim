/**
 * 本机 tsc 类型检查用的最小 Deno 声明。
 * 真正的 Deno 运行时自带这些定义，本文件只为让 `npx tsc -p functions/tsconfig.json`
 * 在没有 Deno 的机器上也能跑（对应 Makefile 的 fn-check）。
 */
declare const Deno: {
  /** 启动 HTTP 服务；在 edge-runtime 中监听由容器注入的端口 */
  serve(handler: (req: Request) => Response | Promise<Response>): void
  env: {
    get(key: string): string | undefined
    set(key: string, value: string): void
  }
}
