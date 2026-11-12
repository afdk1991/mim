# API 性能基准结果（2026-11-13）

- 基址：`http://127.0.0.1:8787`
- 门槛：p95 ≤ 100ms；采样 20 次 / 端点，并发 3，预热 3 次

| 端点 | 路径 | 样本 | p50 | p95 | p99 | 状态 |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| health | `/health` | 20 | 5.0ms | 7.7ms | 8.5ms | ✅ 达标 |
| navigation-summary | `/api/v1/navigation/summary` | 20 | 2.7ms | 18.7ms | 18.8ms | ✅ 达标 |
| navigation-links | `/api/v1/navigation/links` | 20 | 2.6ms | 12.8ms | 13.5ms | ✅ 达标 |
