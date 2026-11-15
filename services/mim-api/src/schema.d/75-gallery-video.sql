-- 图库 / 视频能力：媒体元数据与收藏账本
-- 说明：图库与视频不新建独立模块表，直接复用 community_thread_media（帖子媒体），
--       这里只补「上传对象键 / 封面对象键 / 时长 / 分辨率 / 体积 / MIME」与用户收藏关系。

ALTER_ADD: community_thread_media.storage_key TEXT
ALTER_ADD: community_thread_media.poster_key TEXT
ALTER_ADD: community_thread_media.mime TEXT NOT NULL DEFAULT ''
ALTER_ADD: community_thread_media.size_bytes INTEGER NOT NULL DEFAULT 0
ALTER_ADD: community_thread_media.duration_seconds INTEGER NOT NULL DEFAULT 0
ALTER_ADD: community_thread_media.width INTEGER NOT NULL DEFAULT 0
ALTER_ADD: community_thread_media.height INTEGER NOT NULL DEFAULT 0

CREATE TABLE IF NOT EXISTS gallery_favorites (
  user_id TEXT NOT NULL REFERENCES users(id),
  media_id TEXT NOT NULL REFERENCES community_thread_media(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, media_id)
);

CREATE INDEX IF NOT EXISTS idx_gallery_favorites_user ON gallery_favorites(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gallery_favorites_media ON gallery_favorites(media_id);
CREATE INDEX IF NOT EXISTS idx_thread_media_kind ON community_thread_media(kind, thread_id);
CREATE INDEX IF NOT EXISTS idx_thread_media_created ON community_thread_media(created_at DESC);
