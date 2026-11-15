/*
 * 单页应用前置脚本：地址栏归一化（清理异常查询串与残留裸问号）。
 * 外置原因：生产环境的脚本安全策略允许同源外置脚本，归一化可稳定生效。
 */
(function () { // 立即执行，隔离内部变量，避免污染全局
  // ---------- 地址栏归一化：清理异常查询串与裸问号（幂等） ---------- //
  var href = location.href; // 当前完整地址，用于判断末位是否为问号
  var search = location.search; // 查询串部分（含前导问号；空查询串时为 ''）
  // 仅处理两种异常形态：①查询串恰为异常注入值；②空查询串且地址以问号结尾
  if (search === '?tads' || (search === '' && href.charAt(href.length - 1) === '?')) {
    history.replaceState(null, '', location.pathname + location.hash); // 原地保留路径与 hash，不新增历史、不触发跳转
  } // 归一化分支结束
})(); // 立即执行结束
