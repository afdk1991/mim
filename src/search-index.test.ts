/* 全站搜索索引单测（node:test 零依赖，Node ≥ 22.18 原生 TS 剥离直接运行）
   覆盖 matchSearchPages 的双向 includes 匹配 + 索引自身完整性。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchSearchPages, SEARCH_PAGES } from './search-index.ts'

test('空关键词（含纯空白）返回空', () => {
  assert.deepEqual(matchSearchPages(''), [])
  assert.deepEqual(matchSearchPages('   '), [])
})

test('英文关键词命中 BOM 工具台，大小写不敏感、自动去空白', () => {
  for (const kw of ['bom', 'BOM', '  bom  ', 'BoM']) {
    const r = matchSearchPages(kw)
    assert.equal(r.length, 1, `"${kw}" 应仅命中 1 条，实际 ${r.length}`)
    assert.equal(r[0].href, '#/bom')
  }
})

test('中文关键词命中（名称或关键词双向 includes）', () => {
  const r = matchSearchPages('机箱')
  assert.equal(r.length, 1)
  assert.equal(r[0].href, '#/bom')
  const tool = matchSearchPages('工具')
  assert.ok(tool.some((p) => p.href === '#/bom'), '"工具" 应命中 BOM 工具台')
})

test('一词多页：商城同时命中商城中心与优选商城', () => {
  const r = matchSearchPages('商城')
  assert.equal(r.length, 2, `应命中 2 条，实际 ${r.length}: ${r.map((p) => p.href).join(',')}`)
  assert.ok(r.some((p) => p.href === '#/mall'))
  assert.ok(r.some((p) => p.href === '#/mall/youxuan'))
})

test('索引完整性：href 唯一且均为 hash 路由，关键词非空', () => {
  const hrefs = SEARCH_PAGES.map((p) => p.href)
  assert.equal(new Set(hrefs).size, hrefs.length, '存在重复 href')
  for (const p of SEARCH_PAGES) {
    assert.ok(p.href.startsWith('#/'), `非法路由: ${p.href}`)
    assert.ok(p.name.length > 0, `名称为空: ${p.href}`)
    assert.ok(p.keywords.length > 0, `关键词为空: ${p.href}`)
  }
})
