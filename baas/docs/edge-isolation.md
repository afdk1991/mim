# Edge Functions 隔离方案（从「够用」到「强隔离」）

Edge Runtime 默认是 **V8 isolate 级隔离**（同一进程内多 isolate），启动快、开销小，
但所有函数共享同一个操作系统进程、同一个网络命名空间。运行不可信第三方函数时，
这个级别是不够的。

## 三档隔离对比

| 档位 | 机制 | 隔离强度 | 冷启动 | 适用场景 |
|---|---|---|---|---|
| L1 · 容器级（**默认提供**） | `cap_drop: ALL` + `no-new-privileges` + 只读根 + tmpfs + PID/内存/CPU 上限 | 中 | 无额外开销 | 自有函数、内部工具、绝大多数自托管场景 |
| L2 · microVM（Firecracker / Cloud Hypervisor） | 每租户/每函数一台轻量虚机，独立内核 | 高 | 100–200ms | 运行**不可信第三方**函数、多租户平台 |
| L3 · 进程沙箱 +  seccomp/gVisor | runsc 运行时或自定义 seccomp profile | 中高 | 低 | 想要强于容器、又不必上 VM 的场景 |

## 已落地：L1（开箱可用）

```bash
docker compose -f docker-compose.yml -f docker-compose.hardened.yml up -d
```

对应 `docker-compose.hardened.yml`：

- `cap_drop: ALL` + `no-new-privileges:true`：容器无法提权、无法加载内核模块
- `read_only: true` + `tmpfs /tmp`：根文件系统只读，函数无法落盘持久化
  （Deno 缓存通过 `DENO_DIR=/tmp/deno` 落到 tmpfs）
- `pids_limit` / `mem_limit` / `deploy.resources.limits`：防 fork 炸弹与内存打满
- 非 root 用户（`user: "1000:1000"`）

**残留风险（L1 无法消除）**：共享内核。内核漏洞、同一主机上的侧信道仍可跨容器。
因此不可信代码应走 L2。

## 启用 L2（microVM）需要的前提

Firecracker 依赖 **KVM**（`/dev/kvm`），意味着：

1. 宿主必须是裸金属或支持嵌套虚拟化的云主机 —— **多数云上 Docker 容器里跑不了**
2. 需要把 `/dev/kvm` 挂进管理进程，并由管理进程按函数拉起 microVM
3. 冷启动从毫秒级升到百毫秒级，需要预热池

因此本仓库**没有默认内置 L2**：在无法确认目标机支持 KVM 的情况下给出编排，
只会得到一个启动即失败的栈。落地路径建议：

- 平台型部署：引入 Firecracker 的函数运行时层（如基于 `firecracker-go-sdk` 的自研调度器
  或支持 microVM 的开源 FaaS），Edge Functions 退化为「可信函数」层
- 折中方案：**按租户拆分函数容器**（一个租户一个 `functions` 实例 + L1 加固 + 网络策略隔离），
  配合库内配额（`db/migrations/0010_quotas.sql`）限制滥用

## 与配额的配合

隔离解决「能做什么」，配额解决「能做多少」。当前配额在库内：

```sql
select public.within_quota('rag_search', 100, 'hour');  -- 判定
select public.bump_usage('rag_search', 1, 'hour');       -- 计数
```

`functions/rag-search` 已经接了这两个调用（超限返回 429）。
