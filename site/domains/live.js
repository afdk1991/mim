/* site/domains/live.js
 * 领域静态页的「动态部分」：核心内容已在 HTML 里静态渲染完成，本脚本只做异步增强。
 *
 * 设计边界（对应项目的动静结合口径）：
 *   1. 只调用 HEAD 已提交、且与本次在途改动无关的公开只读端点：/api/v1/health 与 /api/v1/community/trending；
 *      不引用任何仅存在于未提交改动里的接口或字段（例如未合并的 domains 端点一律不碰）。
 *   2. 默认同源相对路径：页面被生产 nginx 或同域静态托管时直接可用；跨域不可用时静默降级。
 *   3. 任何失败（超时 / 跨域 / 非 2xx / 结构不符）都不抛错、不改动静态内容，只把状态条文案换成降级说明。
 *   4. 禁用 JavaScript 时页面仍完整可读：HTML 里已写好占位文案，脚本只是替换它。
 *   5. 不使用 innerHTML 渲染远端数据，全部走 createElement + textContent，避免注入。
 */
(function () {
  'use strict'; // 严格模式：避免隐式全局变量污染页面
  // 状态容器：由生成器写在每个详情页的 .live 元素上，缺失时脚本直接退出
  var box = document.querySelector('[data-live]');
  // 容器不存在说明当前页不是领域详情页（例如索引页），无需执行
  if (!box) return;
  // 业务前缀：允许页面通过 data-api 覆盖，默认同源 /api/v1
  var apiBase = box.getAttribute('data-api') || '/api/v1';
  // 去掉末尾斜杠，避免拼出双斜杠地址
  apiBase = apiBase.replace(/\/+$/, '');
  // 状态圆点：用于表达在线 / 降级 / 失败三种状态
  var dot = box.querySelector('.live-dot');
  // 状态主文案节点：脚本只改这里的文字
  var label = box.querySelector('[data-live-label]');
  // 动态列表容器：承载最多 3 条社区动态，失败时保持为空
  var list = box.querySelector('[data-live-list]');

  /**
   * 带超时的 fetch：避免弱网下状态条长时间停在「检测中」。
   * @param {string} url 请求地址
   * @param {number} ms 超时毫秒数
   * @returns {Promise<Response>} 原始响应对象
   */
  function fetchWithTimeout(url, ms) {
    // 用 AbortController 在超时后主动中断请求
    var controller = new AbortController();
    // 定时器到点即中断
    var timer = setTimeout(function () { controller.abort(); }, ms);
    // 返回包了一层清理逻辑的 Promise
    return fetch(url, { signal: controller.signal, headers: { accept: 'application/json' }, credentials: 'omit' })
      .then(function (res) { clearTimeout(timer); return res; })
      .catch(function (err) { clearTimeout(timer); throw err; });
  }

  /**
   * 设置状态条的可视状态。
   * @param {'ok'|'warn'|'fail'} state 状态类型
   * @param {string} text 主文案
   */
  function setState(state, text) {
    // 有节点才改，避免空引用报错
    if (label) label.textContent = text;
    // 圆点颜色：在线用薄荷绿，降级用琥珀，失败用灰
    if (dot) {
      // 在线
      if (state === 'ok') dot.style.background = 'var(--mint)';
      // 降级：接口可达但数据不足
      else if (state === 'warn') dot.style.background = 'var(--amber)';
      // 失败或不可用
      else dot.style.background = 'var(--fg-mute)';
    }
  }

  /**
   * 把一条社区动态渲染成列表项（只用 textContent，杜绝 HTML 注入）。
   * @param {{title:string, at:string}} item 归一化后的条目
   */
  function appendItem(item) {
    // 列表容器缺失则跳过
    if (!list) return;
    // 创建列表项
    var li = document.createElement('li');
    // 标题节点
    var title = document.createElement('span');
    // 标题文本来自接口，按纯文本写入
    title.textContent = item.title;
    // 时间节点
    var time = document.createElement('time');
    // 时间文本同样按纯文本写入
    time.textContent = item.at;
    // 挂到列表项
    li.appendChild(title);
    // 有时间才追加，避免空标签
    if (item.at) li.appendChild(time);
    // 挂到列表容器
    list.appendChild(li);
  }

  /**
   * 归一化社区动态响应：兼容数组与常见包裹结构，且不假设未提交改动的字段。
   * @param {unknown} data 接口返回的 JSON
   * @returns {Array<{title:string, at:string}>} 最多 3 条
   */
  function normalizeTrending(data) {
    // 候选数组：顶层数组，或 items / threads / data 包裹
    var arr = Array.isArray(data) ? data
      : (data && (data.items || data.threads || data.data)) || [];
    // 非数组一律按空处理
    if (!Array.isArray(arr)) return [];
    // 逐条归一化后截取前 3 条
    return arr.slice(0, 3).map(function (raw) {
      // 标题：兼容 title / name 两种常见字段
      var title = (raw && (raw.title || raw.name)) || '社区动态';
      // 时间：兼容 created_at / createdAt，缺失时留空
      var at = (raw && (raw.created_at || raw.createdAt)) || '';
      // 时间只保留日期部分，避免时区展示差异
      if (at) at = String(at).slice(0, 10);
      // 返回归一化条目
      return { title: String(title).slice(0, 80), at: at };
    });
  }

  // 第一步：探活。健康检查是 HEAD 已提交的公开端点，返回极小，适合做状态灯
  fetchWithTimeout(apiBase + '/health', 3000)
    .then(function (res) {
      // 非 2xx 视为服务异常，但仍继续尝试拉动态列表
      if (!res.ok) throw new Error('health ' + res.status);
      // 在线状态
      setState('ok', '接口在线');
      // 继续拉社区动态（失败不影响在线状态）
      return fetchWithTimeout(apiBase + '/community/trending', 3000);
    })
    .then(function (res) {
      // 动态列表不可用：保留在线状态，只补充说明
      if (!res || !res.ok) { setState('ok', '接口在线 · 动态暂不可用'); return null; }
      // 解析 JSON
      return res.json();
    })
    .then(function (data) {
      // 未拿到数据（上一步已降级）则结束
      if (data === null || data === undefined) return;
      // 归一化条目
      var items = normalizeTrending(data);
      // 没有条目时只更新说明，不伪造内容
      if (items.length === 0) { setState('ok', '接口在线 · 暂无动态'); return; }
      // 逐条渲染
      for (var i = 0; i < items.length; i += 1) appendItem(items[i]);
      // 最终状态：在线且有动态
      setState('ok', '接口在线 · 以下是社区最新动态');
    })
    .catch(function () {
      // 统一降级：跨域未授权 / 超时 / 离线都落这里，静态内容不受影响
      setState('fail', '实时数据暂不可用（静态内容不受影响）');
    });
}());
