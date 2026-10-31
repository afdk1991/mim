import pg from 'pg'
const p = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const r = await p.query('select key, sensitive, value from system_config order by sensitive, key')
console.table(r.rows)
const g = await p.query("select action, value, daily_cap, quality_gate from growth_rules where action='post_create'")
console.log('post_create:', g.rows)
await p.end()
