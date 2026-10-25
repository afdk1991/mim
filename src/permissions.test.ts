/* 权限模型单测（node:test 零依赖，Node ≥ 22.18 原生 TS 剥离直接运行）
   覆盖 can() 的三态身份 × 作者归属矩阵 —— 本地守卫是云端 RLS 之外的第二道防线。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { can } from './permissions.ts'

const ME = 'me'

const ACTIONS = [
  'post:delete',
  'article:edit',
  'article:delete',
  'snippet:delete',
  'profile:edit',
] as const

test('guest 身份一律拒绝（含本人内容）', () => {
  for (const action of ACTIONS) {
    assert.equal(can('guest', ME, action, { authorId: ME }), false, `guest 不应能 ${action}`)
    assert.equal(can('guest', ME, action, { authorId: 'u1' }), false)
  }
})

test('作者本人可删改自己的内容（local / cloud 同规则）', () => {
  for (const mode of ['local', 'cloud'] as const) {
    for (const action of ACTIONS) {
      assert.equal(can(mode, ME, action, { authorId: ME }), true, `${mode} 本人应可 ${action}`)
    }
  }
})

test('非作者不可删改他人内容（local / cloud 同规则）', () => {
  for (const mode of ['local', 'cloud'] as const) {
    for (const action of ACTIONS) {
      assert.equal(can(mode, ME, action, { authorId: 'u1' }), false, `${mode} 他人不应可 ${action}`)
    }
  }
})
