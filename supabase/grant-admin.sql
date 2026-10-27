/* 管理后台授权脚本（Supabase Dashboard → SQL Editor 粘贴执行）
   ------------------------------------------------------------------
   用途：把某个已注册账号提升为 admin，解锁 https://<你的域名>/#/admin

   为什么需要它：注册只会自动分配默认角色 user，而 user_roles 表的写策略
   要求调用者已是 admin —— 没有这一脚，谁都进不了管理后台。

   用法：
     1. 先在应用里注册该账号（记下用户名，例如 alice）
     2. 把下方 :name 替换为用户名或邮箱，执行
     3. 回到应用刷新页面，「🛡️ 管理后台」入口即出现（无需重新登录）

   说明：auth.users.email 对用户名注册是合成邮箱 <username>@mim.app，
        本脚本两种写法都支持（alice 与 alice@mim.app 都能命中）。
------------------------------------------------------------------- */

-- ① 先看看有哪些账号（找不到用户名时跑这段）
select id, email, created_at
from auth.users
order by created_at desc
limit 20;

-- ② 授予 admin（把 'alice' 换成你的用户名或邮箱）
select public.grant_admin_by_name('alice');

-- ③ 核对结果
select u.email, r.name as role
from public.user_roles ur
join auth.users u on u.id = ur.user_id
join public.roles r on r.id = ur.role_id
where r.name = 'admin';

/* 撤销（如需）：
delete from public.user_roles ur
using public.roles r
where r.id = ur.role_id and r.name = 'admin' and ur.user_id = '<uuid>';
*/

/* 提示：若尚未应用 0010_admin_bootstrap.sql，本脚本会报函数不存在，
   请先跑 `npm run db:apply:remote`（或本地 `npm run db:apply`）应用全部迁移。 */
