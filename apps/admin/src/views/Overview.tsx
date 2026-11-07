// 概览视图：回显当前身份来源、角色与实时权限，便于管理员自检权限是否生效
import type { AdminIdentity } from '../api';

// 组件入参：身份信息由 App 统一加载后下发，避免每个视图重复请求 /admin/me
interface OverviewProps {
  // 当前身份、角色与权限
  identity: AdminIdentity;
} // OverviewProps 结束：仅一个 identity 字段，保持组件契约最小化

// 概览组件：纯展示，无副作用
export function Overview({ identity }: OverviewProps) {
  // 身份来源文案：引导通道与账号通道的权限计算方式不同，需明确区分
  const source = identity.bootstrap ? '引导令牌（超管通道）' : '账号登录（RBAC）';
  // 主体标识：引导通道没有真实用户
  const subject = identity.user ? `${identity.user.display_name}（${identity.user.id}）` : '—';
  // 所属地区：多区域部署时用于确认数据边界
  const region = identity.user ? identity.user.region : '全部';
  // 角色数量与权限数量
  const roleCount = identity.roles.length;
  // 权限点数量：与角色数量并列展示，并复用于下方空态分支判断，避免 JSX 里重复取 length
  const permissionCount = identity.permissions.length;

  // 指标卡片数据：抽到 TS 位置便于加注释
  const cards = [
    { label: '身份来源', value: source }, // 卡片一：区分超管引导令牌与 RBAC 账号两条鉴权通道
    { label: '当前主体', value: subject }, // 卡片二：展示操作者身份，审计排查时定位到人
    { label: '数据区域', value: region }, // 卡片三：展示数据边界，多区域部署时防止误判串数据
    { label: '角色 / 权限', value: `${roleCount} / ${permissionCount}` }, // 卡片四：数量概览，一眼看出授权是否过少
  ]; // 卡片数组结束：统一 {label,value} 结构，让下方 map 渲染逻辑保持一致

  // 渲染：上方四张身份指标卡片，下方左右两栏分别列出生效角色与生效权限明细
  return (
    <div className="page"> {/* 页面根容器：复用全局 .page 纵向布局与内边距 */}
      <div className="page-head"> {/* 页头行：标题与说明文字同行排列 */}
        <h2>概览</h2> {/* 页面标题：与左侧导航「概览」同名，保持信息架构一致 */}
        <span className="count">权限每请求实时查库，变更后刷新即生效</span> {/* 说明文案：强调权限不落缓存，改授权后刷新即可验证 */}
      </div> {/* 页头结束 */}
      <div className="cards"> {/* 指标卡片区：四张卡片横向栅格排列 */}
        {cards.map((card) => ( // 遍历卡片数组逐张渲染；label 恒定唯一，可直接作 key
          // 单个指标卡片
          <div className="card" key={card.label}> {/* 卡片容器：key 稳定避免 React 不必要重挂载 */}
            <div className="card-label">{card.label}</div> {/* 指标名称 */}
            <div className="card-value">{card.value}</div> {/* 指标值：已在上方格式化为字符串 */}
          </div> // 卡片结束：此处已回到 map 回调的括号内，属 JS 上下文可用行注释
        ))} {/* 卡片列表渲染结束：回到 div.cards 子元素上下文，须用花括号注释 */}
      </div> {/* 指标卡片区结束 */}
      <div className="split" style={{ marginTop: 16 }}> {/* 双栏布局容器：行内 16px 间距，避免为一次性间距新增 CSS 类 */}
        <div className="panel"> {/* 左栏面板：生效角色列表 */}
          <div className="panel-head"> {/* 面板头：当前仅放标题，操作位留给未来扩展 */}
            <h3>生效角色</h3> {/* 面板标题 */}
          </div> {/* 面板头结束 */}
          {roleCount === 0 ? ( // 无角色走空态分支：避免渲染空容器让管理员误以为加载失败
            // 空态：账号存在但未授予任何角色
            <div className="empty">未授予任何角色</div> // 空态文案：提示需先去角色管理授权
          ) : ( // 有角色分支：渲染徽标列表
            // 逐个渲染角色徽标
            <div> {/* 角色徽标容器：默认流式换行排列 */}
              {identity.roles.map((role) => ( // 遍历角色数组，逐个输出徽标
                <span className="badge builtin" key={role}> {/* 角色徽标：builtin 样式标识系统/内置来源，key 用角色名因其唯一 */}
                  {role} {/* 角色名文本 */}
                </span> // 单个角色徽标结束
              ))} {/* 角色列表渲染结束 */}
            </div> // 角色徽标容器结束
          )} {/* 角色区条件渲染结束 */}
        </div> {/* 左栏面板结束 */}
        <div className="panel"> {/* 右栏面板：生效权限列表，结构与左栏对称便于扫读对比 */}
          <div className="panel-head"> {/* 面板头 */}
            <h3>生效权限</h3> {/* 面板标题 */}
          </div> {/* 面板头结束 */}
          {permissionCount === 0 ? ( // 无权限走空态分支：提示该身份当前不可执行任何受保护操作
            // 空态：无任何权限点
            <div className="empty">无权限</div> // 空态文案
          ) : ( // 有权限分支：渲染徽标列表
            // 逐个渲染权限徽标
            <div> {/* 权限徽标容器 */}
              {identity.permissions.map((permission) => ( // 遍历权限点数组
                <span className="badge" key={permission}> {/* 权限徽标：普通样式，与角色的 builtin 样式区分层级 */}
                  {permission} {/* 权限点文本：形如 plans:write 的「资源:动作」串 */}
                </span> // 单个权限徽标结束
              ))} {/* 权限列表渲染结束 */}
            </div> // 权限徽标容器结束
          )} {/* 权限区条件渲染结束 */}
        </div> {/* 右栏面板结束 */}
      </div> {/* 双栏布局结束 */}
    </div> // 页面根容器结束：此处已回到 return 的括号内，属 JS 上下文
  ); // 返回 JSX：纯展示组件，无 Hooks、无副作用，身份数据完全来自 props
} // Overview 组件结束
