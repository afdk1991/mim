# mim-mail-proxy：Mim 邮箱聚合代理（Cloudflare Workers）

浏览器无法直连邮箱的 IMAP(993)/SMTP(465) 端口，本 Worker 使用 `cloudflare:sockets`
的 `connect()` 建立隐式 TLS 连接做最小协议中转。免费额度内即可运行。

## 路由

| 路由 | 请求体（POST + JSON） | 返回 |
| --- | --- | --- |
| `POST /imap/list` | `{host, port?, user?, pass?, folder?, count?}` | `{exists, messages:[{uid,flags,date,from,to,subject,preview}]}` |
| `POST /imap/fetch` | `{host, port?, user?, pass?, folder?, uid}` | `{uid, from, to, subject, date, text}` |
| `POST /smtp/send` | `{host, port?, user?, pass?, from?, to, subject, body}` | `{ok:true}` |

凭据优先级：Worker 环境变量 `MAIL_USER` / `MAIL_PASS` → 请求体 `user` / `pass`。

## 部署步骤（免费）

```bash
cd worker/mail-proxy
npm i -D wrangler @cloudflare/workers-types
npx wrangler login
npx wrangler deploy
```

部署完成后，把 `https://mim-mail-proxy.<你的子域>.workers.dev` 填入
`src/site-config.ts` 的 `mailProxyUrl`（或在邮箱页「代理地址」输入框中填写）。

## 凭据配置（二选一）

- 方式 A（推荐，前端无需输入密码）：

  ```bash
  npx wrangler secret put MAIL_USER   # 填邮箱地址
  npx wrangler secret put MAIL_PASS   # 填授权码
  ```

  配置后，邮箱页的「授权码」输入框留空即可。
- 方式 B：在邮箱页表单里直接填账号 + 授权码，随请求发送。

## 邮箱授权码获取

- **QQ 邮箱**：网页版「设置 → 账户 → POP3/IMAP/SMTP 服务」开启 IMAP/SMTP 并生成授权码
- **163 邮箱**：「设置 → POP3/SMTP/IMAP」开启服务并新增授权密码
- **Gmail**：开启两步验证后生成「应用专用密码」

## CORS 与安全

- 默认只放行 `https://afdk1991.github.io` 与本地 `localhost:5173`；
  如需自定义来源，给 Worker 设环境变量 `ALLOW_ORIGIN`。
- 这是个人学习项目的最小实现（无速率限制 / 审计日志），
  请勿把 Worker 地址公开用于承载重要邮箱账号。
