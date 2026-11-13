// 前端版本号单一来源：直接读取本包 package.json，避免在页面里硬编码版本字符串
import pkg from '../package.json';

// 构建期由 Vite 内联；版本递增后重新构建即自动同步，不需要改页面代码
export const APP_VERSION: string = pkg.version;
