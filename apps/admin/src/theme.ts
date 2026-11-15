/**
 * 后台明暗偏好：与前台（apps/web/src/appearance.ts）共用同一个 localStorage 键。
 *
 * 同源部署下两端共享 localStorage，因此管理员在前台切到暗色后进入后台也是暗色；
 * 后台只消费本地偏好，不读取后台下发的站点默认值，未切换过的管理员始终看到浅色。
 */

/** 明暗模式：只认 light / dark 两个字面量。 */
export type ThemeMode = 'light' | 'dark';

/** 存储键：必须与前台完全一致，否则两端偏好会各走各的。 */
const MODE_KEY = 'mim.theme.mode';

/** 读取本地明暗偏好：无记录、脏值或存储不可用时一律按浅色。 */
export function readStoredMode(): ThemeMode {
  try { // 无痕模式下读取可能抛异常，不能让它阻断首屏渲染
    const raw = localStorage.getItem(MODE_KEY); // 取出原始字符串
    return raw === 'dark' ? 'dark' : 'light'; // 只有 dark 视为暗色，其余回落浅色
  } catch { // 存储不可用属预期降级路径
    return 'light'; // 回落浅色
  } // try/catch 结束
} // readStoredMode 结束

/** 把明暗写入 <html data-theme>：tokens.css 的暗色分支只认 dark。 */
export function applyThemeMode(mode: ThemeMode): void {
  document.documentElement.dataset.theme = mode; // light 时暗色选择器不命中，自然回落浅色令牌
} // applyThemeMode 结束

/** 当前生效明暗：以已写入的 data-theme 为准，供切换按钮显示对向文案。 */
export function currentThemeMode(): ThemeMode {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'; // 只有 dark 视为暗色
} // currentThemeMode 结束

/** 手动切换明暗：先切页面再落盘，保证即时反馈不被存储异常拖住。 */
export function setThemeMode(mode: ThemeMode): void {
  applyThemeMode(mode); // 立即生效，刷新前也能看到结果
  try { // 存储不可用时仅本次生效，不阻断切换
    localStorage.setItem(MODE_KEY, mode); // 持久化偏好，刷新后保持
  } catch { // 无痕模式等场景忽略写入失败
    /* 忽略写入失败 */
  } // try/catch 结束
} // setThemeMode 结束
