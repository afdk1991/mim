-- 独立商城后台写入面（shop-admin 路由）：充值卡密作废留痕列。
-- ALTER_ADD 指令行：列已存在则跳过；全新库由主 schema.sql 建表时不带此列，加载器在同一路径补齐。
ALTER_ADD: wallet_cards.voided_at TEXT
