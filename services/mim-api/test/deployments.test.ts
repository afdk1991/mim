/** 契约测试：部署汇总（统一字段的部署仓库 / 部署项）——总览 / 清单 / 过滤 / 详情 / 空数据标识 / 匿名只读 */

import { beforeEach, describe, expect, it } from 'vitest'; // vitest 用例编排：每例重建内存库
import request from 'supertest'; // supertest 进程内驱动 Express，无需监听真实端口
import type { Express } from 'express'; // 仅类型导入，用于标注全局 app
import { createApp } from '../src/app.js'; // 唯一装配入口，保证中间件挂载顺序与生产一致
import { createDatabase } from '../src/db.js'; // 内存库工厂，部署汇总本身不查库但装配需要 db
import { DEPLOYMENT_ITEMS, DEPLOYMENT_EXCLUDED, deploymentSummary } from '@mim/core-domain'; // 共享注册表与汇总函数，作为断言基准

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 固定测试密钥，长度满足强度校验

let app: Express; // 待测应用实例
let db: ReturnType<typeof createDatabase>; // 与 app 同生命周期的数据库句柄

beforeEach(() => { // 每例前置：重建内存库与应用
  db = createDatabase(':memory:'); // 内存库全新创建
  app = createApp({ db, jwtSecret: JWT_SECRET, env: {} }); // 不启用管理面，保持最小依赖
}); // beforeEach 结束

describe('部署汇总总览', () => { // 公开只读端点
  it('overview 返回全量部署项 / 10 矩阵平台 / 5 CI 作业 / 4 部署作业 / 空数据项', async () => { // 规模断言
    const res = await request(app).get('/api/v1/deployments/overview'); // 公开汇总
    expect(res.status).toBe(200); // 匿名 200
    expect(res.body.schema).toBe('mim.deployment-registry.v1'); // 契约版本
    expect(res.body.total).toBe(DEPLOYMENT_ITEMS.length); // 去重后的规范部署项（动态，与注册表零漂移）
    expect(res.body.matrix_platforms).toBe(10); // 铁律九 10 平台（2026-11-10 起含 Gitee 镜像仓）
    expect(res.body.ci_jobs).toBe(5); // deploy.yml 五作业
    expect(res.body.deploy_ci_jobs).toBe(4); // verify 为门禁，不计入
    expect(res.body.git_remotes).toBe(2); // origin + gitee 双远端
    expect(res.body.empty_result).toBe(DEPLOYMENT_ITEMS.filter((i) => i.result === null).length); // 空数据项（result=null）动态计数
    expect(res.body.with_result + res.body.empty_result).toBe(res.body.total); // 有取证 + 空数据 = 总数
    expect(res.body.platforms.filter((p: { in_matrix: boolean }) => p.in_matrix)).toHaveLength(10); // 平台目录标记
    expect(res.body.excluded).toBe(DEPLOYMENT_EXCLUDED.length); // 候选池 / 排除项数量（数字，不与明细字段混淆）
    expect(res.body.excluded_items.length).toBe(DEPLOYMENT_EXCLUDED.length); // 排除项明细明确列出且不计入
    expect(res.body.ci_job_list).toHaveLength(5); // CI 作业明细与数字口径分离
    expect(res.body.coverage.dedup_note).toContain('合并'); // 去重说明存在
  }); // overview 规模用例结束

  it('overview 各维度分布合计等于部署项总数', async () => { // 分布自洽
    const res = await request(app).get('/api/v1/deployments/overview'); // 公开汇总
    const sum = (obj: Record<string, number>) => Object.values(obj).reduce((a, b) => a + b, 0); // 求和辅助
    expect(sum(res.body.by_status)).toBe(res.body.total); // 状态分布
    expect(sum(res.body.by_verdict)).toBe(res.body.total); // 结果分布（含 EMPTY 桶）
    expect(sum(res.body.by_layer)).toBe(res.body.total); // 层级分布
    expect(sum(res.body.by_platform)).toBe(res.body.total); // 平台分布
    expect(sum(res.body.by_severity)).toBe(res.body.anomalies); // 严重度分布合计等于异常总数
    expect(res.body).toMatchObject(deploymentSummary()); // 与共享包汇总函数零漂移
  }); // 分布用例结束

  it('overview 提供统一字段字典与说明', async () => { // 字典完整性
    const res = await request(app).get('/api/v1/deployments/overview'); // 公开汇总
    expect(Object.keys(res.body.status_codes)).toContain('BROKEN'); // 失败状态可标识
    expect(Object.keys(res.body.verdict_codes)).toContain('EMPTY'); // 空数据可标识
    expect(Object.keys(res.body.severity_codes)).toEqual(['critical', 'warning', 'info']); // 三级严重度
    expect(res.body.field_spec.result).toContain('null'); // 空数据约定写入字段说明
    expect(res.body.field_spec.repository).toContain('仓库标识'); // 仓库标识字段说明
  }); // 字典用例结束
}); // 总览分组结束

describe('部署项清单与过滤', () => { // 统一字段与过滤
  it('GET /deployments 返回全量部署项且每项字段统一、与共享注册表逐项一致', async () => { // 零漂移断言
    const res = await request(app).get('/api/v1/deployments'); // 公开清单
    expect(res.status).toBe(200); // 200
    expect(res.body.total).toBe(DEPLOYMENT_ITEMS.length); // 全量
    expect(res.body.registry_total).toBe(DEPLOYMENT_ITEMS.length); // 与共享包一致
    const fields = [ // 统一字段清单，所有同类项必须齐备
      'id', 'name', 'aliases', 'platform_id', 'platform', 'layer', 'kind',
      'repository', 'entry_url', 'delivery', 'status', 'result', 'anomalies', 'missing_fields', 'sources',
    ]; // 字段数组结束
    for (const item of res.body.items) { // 逐项核对
      for (const field of fields) expect(item).toHaveProperty(field); // 字段不得缺失
      expect(item.repository).toHaveProperty('id'); // 仓库标识统一三字段
      expect(item.repository).toHaveProperty('url'); // 仓库地址
      expect(item.repository).toHaveProperty('role'); // 仓库角色
      expect(item.delivery).toHaveProperty('artifact_in_head'); // 工件远端 HEAD 口径
      expect(item.delivery).toHaveProperty('artifact_in_worktree'); // 工件本地工作树口径
      const source = DEPLOYMENT_ITEMS.find((d) => d.id === item.id); // 找共享包对应项
      expect(source).toBeTruthy(); // 不得出现注册表外条目
      expect(item.name).toBe(source!.name); // 名称一致
      expect(item.status).toBe(source!.status); // 状态一致
      expect(item.result).toEqual(source!.result); // 结果一致（含 null 空数据）
    } // 逐项循环结束
  }); // 零漂移用例结束

  it('layer / status / verdict / platform_id / q 五类过滤均生效', async () => { // 过滤矩阵
    const prod = await request(app).get('/api/v1/deployments?layer=production'); // 生产层
    expect(prod.body.total).toBe(1); // 唯一生产权威终点
    expect(prod.body.items[0].id).toBe('server.tcloud'); // 腾讯云自建服务器
    const broken = await request(app).get('/api/v1/deployments?status=BROKEN'); // 阻断态
    expect(broken.body.items.every((i: { status: string }) => i.status === 'BROKEN')).toBe(true); // 全部命中
    const empty = await request(app).get('/api/v1/deployments?verdict=EMPTY'); // 空数据
    expect(empty.body.total).toBe(DEPLOYMENT_ITEMS.filter((i) => i.result === null).length); // 空数据项动态计数
    expect(empty.body.items.every((i: { result: unknown }) => i.result === null)).toBe(true); // 明确 null
    const github = await request(app).get('/api/v1/deployments?platform_id=github'); // 平台过滤
    expect(github.body.items.every((i: { platform_id: string }) => i.platform_id === 'github')).toBe(true); // 全部命中
    const alias = await request(app).get('/api/v1/deployments?q=' + encodeURIComponent('data.mixm.top')); // 别名搜索
    expect(alias.body.total).toBe(1); // 命中 EdgeOne 别名
    expect(alias.body.items[0].id).toBe('pages.edgeone'); // 归并到规范 id
  }); // 过滤用例结束

  it('过滤回显与空结果不混淆：无命中时 total=0 但 registry_total 仍为全量', async () => { // 空结果标识
    const res = await request(app).get('/api/v1/deployments?q=not-exist-keyword-xyz'); // 无命中关键词
    expect(res.status).toBe(200); // 200 而非 404
    expect(res.body.total).toBe(0); // 过滤结果为空
    expect(res.body.registry_total).toBe(DEPLOYMENT_ITEMS.length); // 注册表非空，属「无命中」而非「无数据」
    expect(res.body.filters.q).toBe('not-exist-keyword-xyz'); // 过滤条件回显
  }); // 空结果用例结束
}); // 清单分组结束

describe('部署项详情与异常标识', () => { // 详情与异常
  it('GET /deployments/:id 返回完整字段与同平台同类项', async () => { // 详情
    const res = await request(app).get('/api/v1/deployments/server.tcloud'); // 生产项
    expect(res.status).toBe(200); // 200
    expect(res.body.item.layer).toBe('production'); // 生产层
    expect(res.body.item.repository.id).toBe('github:afdk1991/mim'); // 仓库标识
    expect(res.body.item.delivery.artifact_in_head).toBe(true); // 远端 HEAD 仍含工件
    expect(res.body.item.delivery.artifact_in_worktree).toBe(true); // 工作树工件已于 2026-11-10 由 git 恢复，不再缺失
    expect(res.body.item.status).toBe('OK'); // 2026-11-10 23:40 生产已真实上线（/health 200、HTTPS 200）
    expect(res.body.item.result.verdict).toBe('PASS'); // 上线取证齐备，不再是 FAIL / 000
    expect(res.body.item.anomalies.length).toBeGreaterThan(0); // 历史异常（PRODUCTION_UNREACHABLE 等）仍以留痕保留
    expect(Array.isArray(res.body.related)).toBe(true); // 同类项列表
  }); // 详情用例结束

  it('已同步的镜像仓标注 PASS 并以恢复留痕保留历史超时', async () => { // 同步完成标识
    const res = await request(app).get('/api/v1/deployments/repo.gitee'); // Gitee 镜像仓
    expect(res.status).toBe(200); // 200
    expect(res.body.item.status).toBe('OK'); // 2026-11-10 建仓并首次推送后由 UNVERIFIED 转为正常
    expect(res.body.item.result.verdict).toBe('PASS'); // 三方 hash 一致，非「本轮未测」
    expect(res.body.item.missing_fields).toEqual([]); // 凭证与远端 hash 均已取得，不再登记缺失字段
    expect(res.body.item.anomalies.some((a: { code: string }) => a.code === 'REMOTE_TIMEOUT_RECOVERED')).toBe(true); // 历史超时以恢复码留痕，不静默删除
  }); // 同步完成用例结束

  it('IGA 本机直传后以带凭证 200 取证，不再是空数据项', async () => { // IGA 取证
    const res = await request(app).get('/api/v1/deployments/pages.iga'); // IGA Pages 平台
    expect(res.status).toBe(200); // 200
    expect(res.body.item.entry_url).toBe('https://mim-04xa6mw3hm-e1uhm452pi.preview.iga-pages.com'); // 现行项目 96otddwh48 项目级稳定域
    expect(res.body.item.result.http_code).toBe('200'); // 带 iga_token Cookie 复验 200；裸访 401 属平台访问保护
    expect(res.body.item.result.verdict).toBe('PASS'); // 带凭证内容层 200（title=Mim、产物指纹一致），访问保护另以异常码留痕
    expect(res.body.item.anomalies.some((a: { code: string }) => a.code === 'IGA_PROJECT_SPLIT')).toBe(true); // 同名项目分裂留痕
    expect(res.body.item.anomalies.some((a: { code: string }) => a.code === 'PRIVATE_TOKEN_REQUIRED')).toBe(true); // 平台访问保护留痕
  }); // IGA 用例结束

  it('空数据项 result 为 null 且带 EMPTY_RESULT 异常与缺失字段', async () => { // 空数据标识
    const res = await request(app).get('/api/v1/deployments/repo.gitlab'); // GitLab 镜像仓（尚未配置远端）
    expect(res.status).toBe(200); // 200
    expect(res.body.item.result).toBeNull(); // 明确 null，不填 0 / 不冒充成功
    expect(res.body.item.anomalies.some((a: { code: string }) => a.code === 'EMPTY_RESULT')).toBe(true); // 空数据异常
    expect(res.body.item.missing_fields).toContain('http_code'); // 缺失字段
    expect(res.body.item.missing_fields).toContain('git_remote'); // 远端尚未配置
  }); // 空数据用例结束

  it('未登记的部署项 id 返回 404 NOT_FOUND 信封', async () => { // 非法 id
    const res = await request(app).get('/api/v1/deployments/not-a-deployment'); // 未登记 id
    expect(res.status).toBe(404); // 404
    expect(res.body.code).toBe('NOT_FOUND'); // 统一错误码
    expect(res.body.request_id).toBeTruthy(); // 携带追踪 ID
  }); // 404 用例结束

  it('三个端点均匿名可访问，且不产生写操作', async () => { // 只读模型
    const paths = ['/api/v1/deployments/overview', '/api/v1/deployments', '/api/v1/deployments/pages.github']; // 三端点
    for (const path of paths) { // 逐个匿名请求
      const res = await request(app).get(path); // 不带任何 Authorization 头
      expect(res.status).toBe(200); // 200
    } // 循环结束
    const write = await request(app).post('/api/v1/deployments').send({ id: 'x' }); // 试探写操作
    expect(write.status).toBe(404); // 未注册写路由，统一 404 信封
  }); // 只读用例结束
}); // 详情分组结束
