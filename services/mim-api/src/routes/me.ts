/** FR-01 个人中心：资料、注销与撤销 */

import { Router } from 'express'; // 引入 Express 路由工厂，用于装配 /me 下的个人中心接口
import { z } from 'zod'; // 引入 zod，用声明式 schema 校验 PATCH /me 的请求体
import { DELETION_GRACE_DAYS } from '../config.js'; // 引入注销宽限期天数，决定真正删除的时间点
import { clockOf } from '../domain.js'; // 引入可控时钟，测试可注入固定时间而不依赖真实系统时间
import { idempotency, requireAuth } from '../middleware.js'; // 引入写操作幂等与登录态校验两个中间件
import { parse } from '../validate.js'; // 引入 zod 校验包装器，失败统一抛 VALIDATION_FAILED
import { addDays } from '../utils.js'; // 引入按天偏移工具，用于计算注销生效时间
import type { ApiDeps } from '../types.js'; // 仅引入依赖注入类型，编译期擦除、不产生运行时代码

const profileBody = z // 更新资料接口的请求体 schema：先取 zod 链式构建器
  .object({ // 要求请求体必须是对象，未声明字段会被 zod 默认剥离
    display_name: z.string().max(60).optional(), // 昵称：可选，最长 60 字符，防止超长文本落库
    locale: z.enum(['zh-CN', 'en-US']).optional(), // 语言：只允许受支持的两种取值，避免写入未知语言码
    timezone: z.string().min(1).max(64).optional(), // 时区：可选字符串，限长 1-64 以排除空值与异常长串
  }) // 字段定义结束
  .refine((value) => Object.keys(value).length > 0, { message: 'at least one field is required' }); // 追加语义约束：至少提交一个字段，避免无意义的空更新

export function createMeRouter(deps: ApiDeps): Router { // 工厂函数：接收依赖（数据库、时钟等）并返回装配好的个人中心路由
  const router = Router(); // 创建独立 router 实例，便于在 app 层按前缀统一挂载
  // 鉴权按命名空间生效：未匹配到 /me* 的请求直接放行到后续 router，避免未知路径被误拦成 401
  router.use('/me', requireAuth); // 仅对 /me 前缀启用登录态校验，不影响其它路由

  router.get('/me', (req, res) => { // GET /me：读取当前登录用户的对外可见资料
    const user = req.user!; // 登录态已由上面的 requireAuth 注入，此处断言非空
    res.json({ // 直接以 JSON 返回，响应结构由前端契约消费
      user: { // 只暴露安全字段，不返回密码哈希、手机号等敏感信息
        id: user.id, // 用户唯一 ID，前端用作本地缓存键
        member_no: user.member_no, // 自动分配的 Mim ID 号码，个人中心展示与客服引用
        region: user.region, // 区域（cn/global），决定前端可用的模块与身份类型
        status: user.status, // 账号状态（active/pending_deletion），前端据此展示注销提示
        display_name: user.display_name, // 昵称，用于页面展示
        locale: user.locale, // 语言偏好，用于前端切换文案
        timezone: user.timezone, // 时区偏好，用于前端本地化时间展示
      }, // user 字段结束
    }); // 响应体结束
  }); // GET /me 路由结束

  router.patch('/me', idempotency, (req, res) => { // PATCH /me：局部更新资料，先过幂等中间件防止重复提交
    const body = parse(profileBody, req.body); // 校验请求体并剥离未声明字段，失败直接抛 VALIDATION_FAILED
    const now = clockOf(deps); // 取当前时间（可由测试注入），作为 updated_at 落库
    const sets: string[] = []; // 收集待更新的 SET 片段，未提交的字段不参与更新
    const values: unknown[] = []; // 与 SET 片段一一对应的实参，用占位符传值防止 SQL 注入
    if (body.display_name !== undefined) { // 仅当客户端显式提交昵称时才更新该列
      sets.push('display_name = ?'); // 使用占位符而非字符串拼接，杜绝注入风险
      values.push(body.display_name); // 按占位符顺序压入昵称值
    } // 昵称分支结束
    if (body.locale !== undefined) { // 仅当显式提交语言偏好时才更新
      sets.push('locale = ?'); // 语言列占位符
      values.push(body.locale); // 压入已通过枚举校验的语言码
    } // 语言分支结束
    if (body.timezone !== undefined) { // 仅当显式提交时区时才更新
      sets.push('timezone = ?'); // 时区列占位符
      values.push(body.timezone); // 压入已通过长度校验的时区值
    } // 时区分支结束
    sets.push('updated_at = ?'); // 任何资料变更都刷新修改时间，便于审计与缓存失效
    values.push(now, req.user!.id); // 先压入 updated_at 值，再压入 WHERE 条件所需的用户 ID
    deps.db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...values); // 动态拼装 SET 列表执行更新，WHERE 按主键精确命中单行

    const row = deps.db // 更新后回查数据库，确保响应与落库结果严格一致
      .prepare('SELECT id, member_no, region, status, display_name, locale, timezone FROM users WHERE id = ?') // 只查可对外字段，避免把敏感列带出
      .get(req.user!.id); // 按当前登录用户 ID 取单行
    res.json({ user: row }); // 返回更新后的完整用户视图
  }); // PATCH /me 路由结束

  router.post('/me/deletion', idempotency, (req, res) => { // POST /me/deletion：发起注销，进入宽限期而非立即物理删除
    const user = req.user!; // 取当前登录用户（含 status 快照）
    const now = clockOf(deps); // 当前时间，作为状态变更时间戳
    if (user.status === 'pending_deletion') { // 已在宽限期内重复发起时保持幂等语义
      res.json({ status: user.status, deletion_scheduled_at: null }); // 不再写库，直接回显待删除状态
      return; // 提前返回，避免重复计算注销时间
    } // 幂等分支结束
    const scheduledAt = addDays(now, DELETION_GRACE_DAYS); // 按宽限期天数算出真正删除的时间点
    deps.db // 使用同步驱动执行单条更新
      .prepare( // 准备带占位符的 UPDATE 语句
        // 说明：把账号状态改为待删除，并记录删除预约时间与最后修改时间
        `UPDATE users SET status = 'pending_deletion', deletion_scheduled_at = ?, updated_at = ?
         WHERE id = ?`, // 条件：按主键定位当前用户；占位符依次为预约时间、修改时间、用户 ID
      ) // prepare 调用结束
      .run(scheduledAt, now, user.id); // 按占位符顺序绑定并执行
    res.json({ status: 'pending_deletion', deletion_scheduled_at: scheduledAt }); // 回显新状态与预约删除时间
  }); // POST /me/deletion 路由结束

  router.post('/me/cancel-deletion', idempotency, (req, res) => { // POST /me/cancel-deletion：撤销注销，状态恢复为 active
    const user = req.user!; // 取当前登录用户
    const now = clockOf(deps); // 当前时间作为 updated_at
    if (user.status !== 'pending_deletion') { // 非待删除状态无需处理，保持幂等
      res.json({ status: user.status }); // 原样回显当前状态，前端可据此判断
      return; // 提前返回，避免无意义写库
    } // 幂等分支结束
    deps.db // 同步执行更新
      .prepare( // 准备 UPDATE 语句
        // 说明：状态回滚为 active，并清空删除预约时间，防止后台任务继续执行删除
        `UPDATE users SET status = 'active', deletion_scheduled_at = NULL, updated_at = ? WHERE id = ?`, // 单行 SQL：SET 三列（状态、清空预约、修改时间），WHERE 按主键限定
      ) // prepare 调用结束
      .run(now, user.id); // 绑定修改时间与用户 ID 后执行
    res.json({ status: 'active' }); // 回显恢复后的状态
  }); // POST /me/cancel-deletion 路由结束

  return router; // 返回装配完成的路由，供 app.ts 挂载到 /api/v1
} // createMeRouter 工厂结束
