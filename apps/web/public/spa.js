/*
 * apps/web/public/spa.js —— 单页应用前置脚本（构建后位于 dist 根，与 index.html 同级）
 * 职责：地址栏归一化（清理 EdgeOne WAF 注入的 ?tads / 残留裸问号）
 * 为什么外置：生产 nginx 的 CSP 为 script-src 'self'，会阻止 index.html 内联脚本执行；
 * 外置同源脚本不受该限制，因此归一化在 https://mim.mixm.top 上也能真正生效。
 * 说明：会话门禁由 App.tsx 按需执行（商城目录匿名可浏览，收费/私密视图内嵌登录卡片），本脚本不做整站锁定。
 */
(function () { // 立即执行，隔离内部变量，避免污染全局
  // ---------- 地址栏归一化：清理 ?tads 与裸问号（与 index.html 顶部极简内联同口径、幂等） ---------- //
  var href = location.href; // 当前完整地址，用于判断末位是否为问号
  var search = location.search; // 查询串部分（含前导问号；空查询串时为 ''）
  // 仅处理两种异常形态：①查询串恰为平台注入的 ?tads；②空查询串且地址以问号结尾
  if (search === '?tads' || (search === '' && href.charAt(href.length - 1) === '?')) {
    history.replaceState(null, '', location.pathname + location.hash); // 原地保留路径与 hash，不新增历史、不触发跳转
  } // 归一化分支结束
})(); // 立即执行结束
