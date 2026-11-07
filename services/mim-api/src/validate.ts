/** zod 入参校验，失败统一翻译为 VALIDATION_FAILED */

import { z } from 'zod'; // 引入 zod，用于声明式定义请求参数 schema
import { AppError } from '@mim/core-domain'; // 引入统一业务异常，错误码与 HTTP 状态码集中管理

export function parse<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> { // 泛型包装：由入参 schema 推导返回类型，调用处无需再做类型断言
  const result = schema.safeParse(value ?? {}); // 用 safeParse 避免抛 zod 原生异常；null/undefined 归一为空对象，使 required 字段报错更直观
  if (!result.success) { // 校验失败时统一转译为平台业务错误码
    const firstIssue = result.error.issues[0]; // 取第一条问题作为主消息，单字段校验时直接透出原始提示
    throw new AppError('VALIDATION_FAILED', firstIssue?.message ?? 'request validation failed', { // 抛出 4xx 业务异常，错误码供前端分支处理
      issues: result.error.issues.map((issue) => ({ // 逐条透出校验问题，便于前端定位具体字段
        path: issue.path.map(String).join('.'), // 把 zod 的路径数组拼成 a.b.c 形式，前端可直接按路径高亮输入框
        message: issue.message, // 保留 zod 原始提示，前端可按需本地化
      })), // issues 映射结束
    }); // AppError 构造结束
  } // 失败分支结束
  return result.data; // 成功时返回已剥离多余字段、类型已收窄的数据
} // parse 结束
