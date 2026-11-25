// @vitest-environment jsdom
/**
 * a11y 焦点工具纯函数测试。
 *
 * 在 jsdom 内构造静态 DOM，覆盖可聚焦元素查询：
 *   - 按钮 / 链接 / 输入框按 DOM 顺序返回；
 *   - disabled 元素与 aria-hidden 容器内元素被排除；
 *   - 选择器清单覆盖链接、按钮与四类表单控件。
 *
 * 不启动浏览器、不打真实网络；焦点陷阱的键盘循环由 useDialogTrap 实现承载。
 */

import { describe, expect, it } from 'vitest'; // vitest 编排
import { FOCUSABLE_SELECTOR, getFocusable } from './a11y'; // 被测工具

describe('getFocusable 可聚焦元素查询', () => { // 查询套件
  it('按 DOM 顺序返回按钮 / 链接 / 输入框', () => { // 顺序与类型用例
    const container = document.createElement('div'); // 容器节点
    container.innerHTML = [ // 注入候选元素
      '<button type="button" data-test="btn">按钮</button>', // 普通按钮
      '<a href="/home" data-test="link">链接</a>', // 普通链接
      '<input data-test="input" />', // 普通输入框
    ].join(''); // 拼接片段
    document.body.appendChild(container); // 挂到文档
    const items = getFocusable(container); // 查询可聚焦列表
    expect(items.map((el) => el.dataset.test)).toEqual(['btn', 'link', 'input']); // 顺序断言
    container.remove(); // 清理节点
  }); // 顺序用例结束

  it('排除 disabled 元素与 aria-hidden 容器内元素', () => { // 排除规则用例
    const container = document.createElement('div'); // 容器节点
    container.innerHTML = [ // 注入禁用与装饰元素
      '<button type="button" disabled data-test="disabled">禁用</button>', // 禁用按钮
      '<span aria-hidden="true"><button type="button" data-test="hidden">装饰</button></span>', // 装饰容器内按钮
      '<select data-test="select"><option>选项</option></select>', // 可用下拉
    ].join(''); // 拼接片段
    document.body.appendChild(container); // 挂到文档
    const items = getFocusable(container); // 查询列表
    expect(items.map((el) => el.dataset.test)).toEqual(['select']); // 仅保留可用下拉
    container.remove(); // 清理节点
  }); // 排除用例结束

  it('空容器返回空数组', () => { // 空容器边界用例
    expect(getFocusable(null)).toEqual([]); // null 入参返回空
    expect(getFocusable(document.createElement('div'))).toEqual([]); // 空节点返回空
  }); // 边界用例结束
}); // 查询套件结束

describe('FOCUSABLE_SELECTOR 选择器清单', () => { // 清单套件
  it('覆盖链接、按钮与四类表单控件', () => { // 覆盖断言
    expect(FOCUSABLE_SELECTOR).toContain('a[href]'); // 链接选择器在位
    expect(FOCUSABLE_SELECTOR).toContain('button:not([disabled])'); // 按钮选择器在位
    for (const control of ['input', 'select', 'textarea']) { // 逐类表单控件
      expect(FOCUSABLE_SELECTOR).toContain(`${control}:not([disabled])`); // 对应选择器在位
    } // 控件循环结束
  }); // 覆盖用例结束
}); // 清单套件结束
