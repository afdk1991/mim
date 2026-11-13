/**
 * tools/quick-build-wp/lib/plan.mjs
 *
 * 步骤清单模型：--plan 输出与 --emit 生成脚本共用同一份步骤定义，
 * 保证「清单里声明的步骤」与「脚本里实际执行的步骤」一一对应。
 *
 * 纯 Node 内置模块，零新增依赖。
 */

/**
 * 构造建站计划。
 * @param {{domain?:string, phpVersion?:string, wpVersion?:string, ssl?:boolean}} opts
 * @returns {{tool:string, version:string, options:object, steps:Array<object>}}
 */
export function buildPlan(opts = {}) {
  const domain = opts.domain || 'example.com';
  const phpVersion = opts.phpVersion || '8.2';
  const wpVersion = opts.wpVersion || 'latest';
  const ssl = opts.ssl === true;

  /** @type {Array<{id:string,title:string,idempotent:boolean,optional:boolean,commands:string[]}>} */
  const steps = [
    {
      id: 'env-check',
      title: '环境自检：确认 curl / tar / 包管理器可用',
      idempotent: true,
      optional: false,
      commands: ['command -v curl', 'command -v tar'],
    },
    {
      id: 'install-nginx',
      title: '安装并启用 Nginx（已安装则跳过）',
      idempotent: true,
      optional: false,
      commands: ['apt-get install -y nginx', 'systemctl enable nginx'],
    },
    {
      id: 'install-mysql',
      title: '安装 MySQL 服务端（已安装则跳过）',
      idempotent: true,
      optional: false,
      commands: ['apt-get install -y mysql-server'],
    },
    {
      id: 'install-php',
      title: `安装 PHP ${phpVersion} 及 MySQL 扩展（已安装则跳过）`,
      idempotent: true,
      optional: false,
      commands: ['apt-get install -y php-fpm php-mysql php-cli'],
    },
    {
      id: 'create-db',
      title: '创建 WordPress 数据库与专用账号（已存在则跳过）',
      idempotent: true,
      optional: false,
      commands: ['mysql'],
    },
    {
      id: 'download-wp',
      title: '下载并解压 WordPress 到站点目录（已存在 wp-load.php 则跳过）',
      idempotent: true,
      optional: false,
      commands: ['curl -fSL', 'tar -xzf'],
    },
    {
      id: 'nginx-site',
      title: '写入站点 Nginx 配置与伪静态规则（配置已存在则校验后跳过）',
      idempotent: true,
      optional: false,
      commands: ['nginx -t'],
    },
    {
      id: 'ssl',
      title: '申请并配置 HTTPS 证书（可选，默认关闭）',
      idempotent: true,
      optional: true,
      commands: ['certbot'],
    },
  ];

  return {
    tool: 'quick-build-wp',
    version: '1.0.0',
    options: { domain, phpVersion, wpVersion, ssl },
    steps,
  };
}

/** 计划中必需覆盖的能力键，供 verify 与测试对账。 */
export const REQUIRED_CAPABILITIES = [
  'nginx',
  'mysql',
  'php',
  'curl',
  'wordpress',
  'rewrite',
];
