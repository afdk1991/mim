-- =============================================================================
-- 0006 Vector：pgvector 检索 + 全文混合检索（RRF 融合）
-- 维度约定：与 .env 的 EMBEDDING_DIM 保持一致，默认 1536。
--   pgvector 0.8.x 索引上限：vector ≤ 2000 维；>2000 维请改用 halfvec（≤4000）
-- 召回陷阱：带过滤条件的向量查询，HNSW 可能「先按向量取 top-k、再过滤」，
--   过滤后结果不足 → 需要 hnsw.iterative_scan（0.8+）。本文件在函数内开启，
--   且用 set_config(..., is_local => true) 保证只在当前事务生效（事务池安全）。
-- =============================================================================

-- ---------- 扩展 ----------
do $$
begin
  create extension if not exists vector;
exception when others then
  raise notice '[0006] pgvector 不可用，本迁移的表与函数将跳过向量部分：%', sqlerrm;
end $$;

-- ---------- 切片表 ----------
create table if not exists public.document_chunks (
  id           bigserial primary key,
  document_id  uuid not null references public.documents (id) on delete cascade,
  chunk_index  int not null,
  content      text not null,
  token_count  int,
  created_at   timestamptz not null default now(),
  tsv          tsvector generated always as (
                 to_tsvector('simple', coalesce(content, ''))
               ) stored
);

create index if not exists document_chunks_document_idx
  on public.document_chunks (document_id, chunk_index);

alter table public.document_chunks enable row level security;

-- 切片可见性跟随所属文档（避免向量检索成为绕过文档权限的旁路）
drop policy if exists "chunks 跟随文档可见性" on public.document_chunks;
create policy "chunks 跟随文档可见性" on public.document_chunks
  for select using (
    exists (
      select 1 from public.documents d
      where d.id = document_chunks.document_id
        and (d.is_public or d.owner = public.jwt_uid())
    )
  );

drop policy if exists "chunks 跟随文档可写" on public.document_chunks;
create policy "chunks 跟随文档可写" on public.document_chunks
  for all to authenticated
  using (
    exists (select 1 from public.documents d
            where d.id = document_chunks.document_id and d.owner = public.jwt_uid())
  )
  with check (
    exists (select 1 from public.documents d
            where d.id = document_chunks.document_id and d.owner = public.jwt_uid())
  );

-- ---------- 向量列与索引（扩展可用时才建） ----------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'vector') then
    alter table public.document_chunks
      add column if not exists embedding vector(1536);

    create index if not exists document_chunks_embedding_idx
      on public.document_chunks
      using hnsw (embedding vector_cosine_ops)
      with (m = 16, ef_construction = 64);

    create index if not exists document_chunks_tsv_idx
      on public.document_chunks using gin (tsv);
  else
    raise notice '[0006] 未建 embedding 列：缺少 vector 扩展';
  end if;
end $$;

-- ---------- 检索函数（仅在扩展可用时创建，否则 vector 类型缺失会让整条迁移失败） ----------
do $mig$
begin
  if not exists (select 1 from pg_extension where extname = 'vector') then
    raise notice '[0006] 缺少 vector 扩展，跳过 match_chunks / hybrid_search';
    return;
  end if;

  -- 纯向量检索
  execute $fn$
    create or replace function public.match_chunks(
      query_embedding vector(1536),
      match_count     int default 8,
      match_threshold float default 0.0,
      filter_document uuid default null
    )
    returns table (
      chunk_id     bigint,
      document_id  uuid,
      chunk_index  int,
      content      text,
      similarity   float
    )
    language plpgsql
    stable
    -- 关键：security invoker（默认）——调用者的 RLS 生效，
    -- 否则任何人都能绕过文档权限把别人的切片搜出来
    as $$
    begin
      -- 过滤场景提升召回；参数不存在（pgvector < 0.8）时静默跳过
      begin
        perform set_config('hnsw.iterative_scan', 'on', true);
      exception when others then
        null;
      end;

      return query
        select c.id,
               c.document_id,
               c.chunk_index,
               c.content,
               1 - (c.embedding <=> query_embedding) as similarity
        from public.document_chunks c
        where c.embedding is not null
          and (filter_document is null or c.document_id = filter_document)
          and 1 - (c.embedding <=> query_embedding) >= match_threshold
        order by c.embedding <=> query_embedding
        limit match_count;
    end $$;
  $fn$;

  -- 混合检索（向量 + 全文，RRF 融合）
  execute $fn$
    create or replace function public.hybrid_search(
      query_text      text,
      query_embedding vector(1536),
      match_count     int default 8,
      rrf_k           int default 60
    )
    returns table (
      chunk_id    bigint,
      document_id uuid,
      content     text,
      score       float
    )
    language plpgsql
    stable
    as $$
    begin
      begin
        perform set_config('hnsw.iterative_scan', 'on', true);
      exception when others then
        null;
      end;

      return query
        with vec as (
          select c.id,
                 row_number() over (order by c.embedding <=> query_embedding) as rn
          from public.document_chunks c
          where c.embedding is not null
          order by c.embedding <=> query_embedding
          limit match_count * 4
        ),
        txt as (
          select c.id,
                 row_number() over (
                   order by ts_rank(c.tsv, plainto_tsquery('simple', query_text)) desc
                 ) as rn
          from public.document_chunks c
          where c.tsv @@ plainto_tsquery('simple', query_text)
          order by ts_rank(c.tsv, plainto_tsquery('simple', query_text)) desc
          limit match_count * 4
        ),
        fused as (
          select coalesce(v.id, t.id) as id,
                 coalesce(1.0 / (rrf_k + v.rn), 0.0)
                 + coalesce(1.0 / (rrf_k + t.rn), 0.0) as score
          from vec v
          full outer join txt t on t.id = v.id
        )
        select c.id, c.document_id, c.content, f.score
        from fused f
        join public.document_chunks c on c.id = f.id
        order by f.score desc
        limit match_count;
    end $$;
  $fn$;

  execute 'grant execute on function public.match_chunks(vector, int, float, uuid)
             to anon, authenticated, service_role';
  execute 'grant execute on function public.hybrid_search(text, vector, int, int)
             to anon, authenticated, service_role';
  execute 'comment on function public.match_chunks(vector, int, float, uuid) is
             ''向量近邻检索；security invoker，结果受文档 RLS 裁剪；函数内开启 hnsw.iterative_scan 提升过滤场景召回''';
end $mig$;
