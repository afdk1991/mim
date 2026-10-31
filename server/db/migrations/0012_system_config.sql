/* ============================================================================
 * 0012_system_config —— 外部接入参数后台可配（绝不复用已占用迁移编号）
 *
 * 背景：微信/支付宝商户号、内容安全密钥、备案主体等属于「部署期外部输入」，
 *   不应写死在代码里（代码里写死 = 换商户/换主体就得发版）。这些参数收敛到一张
 *   system_config 表，由 admin_config_set 在后台配置；config_get 只回非敏感键。
 *
 * 表结构：
 *   key        配置项路径（点分命名空间，如 payment.merchant_id），主键
 *   value      jsonb，默认 null；非敏感键可被前端展示，敏感键绝不进公开回包
 *   sensitive  true = 凭据类（商户密钥/JWT 等），公开读过滤、回显打码
 *   updated_at 更新时间（epoch 毫秒）
 *   updated_by 最后修改者 uid（审计可与 audit_logs 对照）
 *
 * 幂等：create table if not exists + on conflict do nothing。
 *   种子只在首次写入；管理员后台改过的值不会被重复执行覆盖。
 * ========================================================================== */

create table if not exists system_config (
  key        text primary key,
  value      jsonb not null default 'null'::jsonb,
  sensitive  boolean not null default false,
  updated_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  updated_by text
);

/* ---- 非敏感键（config_get 公开可读）：先置空串/占位，运营在后台填 ---- */
insert into system_config (key, value, sensitive) values
  ('payment.scan_qr_url',  '""'::jsonb, false),
  ('payment.scan_remark',  '"扫码支付（接入微信/支付宝后由后台替换）"'::jsonb, false),
  ('legal.icp',             '""'::jsonb, false),
  ('legal.police',          '""'::jsonb, false),
  ('legal.entity',          '""'::jsonb, false),
  ('legal.credit_code',     '""'::jsonb, false),
  ('legal.domain',          '""'::jsonb, false),
  ('site.support_email',    '""'::jsonb, false),
  ('site.address',          '""'::jsonb, false),
  ('site.logo_url',         '""'::jsonb, false),
  ('deploy.server_info',    '""'::jsonb, false),
  ('ci.secrets_checklist',  '"[]"'::jsonb, false)
on conflict (key) do nothing;

/* ---- 敏感键（sensitive=true，value 默认 null）：仅占位，后台填入真实凭据 ---- */
insert into system_config (key, value, sensitive) values
  ('payment.merchant_id',   'null'::jsonb, true),
  ('payment.merchant_key',   'null'::jsonb, true),
  ('payment.notify_token',   'null'::jsonb, true),
  ('jwt_secret',              'null'::jsonb, true),
  ('sync_token',             'null'::jsonb, true),
  ('database_url',           'null'::jsonb, true),
  ('content_security_secret','null'::jsonb, true)
on conflict (key) do nothing;

/* ---- 补成长规则种子：post_create（0005 未含，边界压测 EDGE-5 需据此命中日上限） ---- */
insert into growth_rules (action, value, daily_cap, quality_gate) values
  ('post_create', 2, 3, true)
on conflict (action) do nothing;
