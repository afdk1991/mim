# schema.d — 域外挂建表脚本

各业务域把自己新增的 DDL 放在本目录，文件名为 `NN-域名.sql`（按文件名升序执行）。
- 所有语句必须幂等：`CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` / 幂等 INSERT（`INSERT ... WHERE NOT EXISTS`）。
- 需要给**已有表**补列时，用指令行：`ALTER_ADD: 表名 列名 TEXT NOT NULL DEFAULT ''''`，加载器会先补列再执行其余语句。
- 禁止在此目录写 `DROP` / `DELETE` / 无条件 `UPDATE`。
