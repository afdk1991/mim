/** 回归：种子媒体宽高元数据 —— catalog 封面 768×512、演示片 854×480 / 960×540；存量种子行重启幂等补齐 */

import { describe, expect, it } from 'vitest'; // vitest 编排
import { createDatabase, seedCommunity } from '../src/db.js'; // 内存库工厂 + 社区种子入口

/** 种子媒体主键 → 实测 [宽, 高]；与 public/catalog、public/demo 素材分辨率保持一致。 */
const expectedDims: Record<string, [number, number]> = {
  'media-demo-gallery-1': [768, 512],
  'media-demo-gallery-2': [768, 512],
  'media-demo-gallery-3': [768, 512],
  'media-fix-comic-demo-1': [854, 480],
  'media-demo-video-1': [854, 480],
  'media-demo-video-2': [960, 540],
  'media-fix-cover-design-1': [768, 512],
  'media-fix-cover-design-2': [768, 512],
  'media-fix-cover-design-3': [768, 512],
};

/** 读取单条种子媒体的宽高。 */
function readDims(db: ReturnType<typeof createDatabase>, id: string): { width: number; height: number } {
  return db.prepare('SELECT width, height FROM community_thread_media WHERE id = ?').get(id) as { width: number; height: number };
}

describe('种子媒体宽高元数据', () => {
  it('种子图片与演示片写入本地实测分辨率', () => {
    const db = createDatabase(':memory:'); // 内存库，种子随工厂自动写入
    for (const [id, [width, height]] of Object.entries(expectedDims)) {
      const row = readDims(db, id); // 逐条回读
      expect(row.width).toBe(width); // 宽度与素材一致
      expect(row.height).toBe(height); // 高度与素材一致
    }
  });

  it('重启播种只补齐宽高为 0 的存量种子行，不覆盖上传媒体已有元数据', () => {
    const db = createDatabase(':memory:'); // 内存库
    // 模拟存量生产库：一条种子行宽高被旧版本置 0，另一条已是上传媒体的真实元数据
    db.prepare('UPDATE community_thread_media SET width = 0, height = 0 WHERE id = ?').run('media-demo-video-2');
    db.prepare('UPDATE community_thread_media SET width = 1200, height = 800 WHERE id = ?').run('media-demo-gallery-1');
    seedCommunity(db); // 模拟重启再次播种：INSERT OR IGNORE + 幂等回填
    const restored = readDims(db, 'media-demo-video-2'); // 被置 0 的种子行应补齐
    expect(restored.width).toBe(960); // 回填宽度
    expect(restored.height).toBe(540); // 回填高度
    const kept = readDims(db, 'media-demo-gallery-1'); // 已有真实元数据的行不得被回填覆盖
    expect(kept.width).toBe(1200); // 宽度保持原值
    expect(kept.height).toBe(800); // 高度保持原值
  });
});
