// 概览视图：回显当前身份来源、角色与实时权限，便于管理员自检权限是否生效
import type { AdminIdentity } from '../api';

// 组件入参：身份信息由 App 统一加载后下发，避免每个视图重复请求 /admin/me
interface OverviewProps {
  // 当前身份、角色与权限
  identity: AdminIdentity;
}

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
  const permissionCount = identity.permissions.length;

  // 指标卡片数据：抽到 TS 位置便于加注释
  const cards = [
    { label: '身份来源', value: source },
    { label: '当前主体', value: subject },
    { label: '数据区域', value: region },
    { label: '角色 / 权限', value: `${roleCount} / ${permissionCount}` },
  ];

  // 渲染
  return (
    <div className="page">
      <div className="page-head">
        <h2>概览</h2>
        <span className="count">权限每请求实时查库，变更后刷新即生效</span>
      </div>
      <div className="cards">
        {cards.map((card) => (
          // 单个指标卡片
          <div className="card" key={card.label}>
            <div className="card-label">{card.label}</div>
            <div className="card-value">{card.value}</div>
          </div>
        ))}
      </div>
      <div className="split" style={{ marginTop: 16 }}>
        <div className="panel">
          <div className="panel-head">
            <h3>生效角色</h3>
          </div>
          {roleCount === 0 ? (
            // 空态：账号存在但未授予任何角色
            <div className="empty">未授予任何角色</div>
          ) : (
            // 逐个渲染角色徽标
            <div>
              {identity.roles.map((role) => (
                <span className="badge builtin" key={role}>
                  {role}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="panel">
          <div className="panel-head">
            <h3>生效权限</h3>
          </div>
          {permissionCount === 0 ? (
            // 空态：无任何权限点
            <div className="empty">无权限</div>
          ) : (
            // 逐个渲染权限徽标
            <div>
              {identity.permissions.map((permission) => (
                <span className="badge" key={permission}>
                  {permission}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
