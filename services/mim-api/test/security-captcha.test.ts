/** 安全加固包测试：验证码适配层（off / image / slider / tencent / geetest4，场景强制与 503 降级） */

import { describe, expect, it, beforeEach } from 'vitest'; // 引入依赖：声明本文件使用的外部能力
import { createHash } from 'node:crypto'; // 引入依赖：声明本文件使用的外部能力
import { AppError } from '@mim/core-domain'; // 引入依赖：声明本文件使用的外部能力
import { createDatabase } from '../src/db.js'; // 引入依赖：声明本文件使用的外部能力
import { // 引入依赖：声明本文件使用的外部能力
  issueCaptcha, // 业务步骤：推进当前流程的下一项处理
  verifyCaptcha, // 业务步骤：推进当前流程的下一项处理
  sceneCaptchaRequired, // 业务步骤：推进当前流程的下一项处理
  captchaMode, // 业务步骤：推进当前流程的下一项处理
  createCaptcha, // 业务步骤：推进当前流程的下一项处理
  captchaHash, // 业务步骤：推进当前流程的下一项处理
  consumeCaptcha, // 业务步骤：推进当前流程的下一项处理
} from '../src/security.js'; // 结束代码块：本层作用域收尾
import type { Db } from '../src/types.js'; // 引入依赖：声明本文件使用的外部能力

let db: Db; // 保存 db：承载本步骤的计算结果供后续使用

beforeEach(() => { // 业务步骤：推进当前流程的下一项处理
  db = createDatabase(':memory:'); // 赋值：更新当前作用域中的状态
}); // 结束函数体：本层作用域收尾

function env(overrides: Record<string, string>): Record<string, string | undefined> { // 定义函数 env：封装可复用业务步骤
  return { ...overrides }; // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾

describe('模式开关与场景强制', () => { // 用例「模式开关与场景强制」：覆盖对应业务契约
  it('未配置 MIM_CAPTCHA_MODE 时为 off，所有场景均不强制', () => { // 用例「未配置 MIM_CAPTCHA_MODE 时为 off，所有场景均不强制」：覆盖对应业务契约
    expect(captchaMode({})).toBe('off'); // 断言：校验接口返回符合契约
    expect(sceneCaptchaRequired({}, 'login')).toBe(false); // 断言：校验接口返回符合契约
    expect(sceneCaptchaRequired({ MIM_CAPTCHA_MODE: 'image', MIM_CAPTCHA_LOGIN: '1' }, 'login')).toBe(true); // 断言：校验接口返回符合契约
    expect(sceneCaptchaRequired({ MIM_CAPTCHA_MODE: 'image', MIM_CAPTCHA_LOGIN: '1' }, 'report')).toBe(false); // 断言：校验接口返回符合契约
  }); // 结束函数体：本层作用域收尾

  it('旧 MIM_CAPTCHA_REQUIRED=1 视为全场景强制', () => { // 用例「旧 MIM_CAPTCHA_REQUIRED=1 视为全场景强制」：覆盖对应业务契约
    const e = { MIM_CAPTCHA_MODE: 'image', MIM_CAPTCHA_REQUIRED: '1' }; // 保存 e：承载本步骤的计算结果供后续使用
    expect(sceneCaptchaRequired(e, 'register')).toBe(true); // 断言：校验接口返回符合契约
    expect(sceneCaptchaRequired(e, 'post')).toBe(true); // 断言：校验接口返回符合契约
  }); // 结束函数体：本层作用域收尾

  it('off 模式 verifyCaptcha 直接放行，不校验任何字段', async () => { // 用例「off 模式 verifyCaptcha 直接放行，不校验任何字段」：覆盖对应业务契约
    await expect(verifyCaptcha(db, env({}), 'login', {})).resolves.toBeUndefined(); // 断言：校验接口返回符合契约
  }); // 结束函数体：本层作用域收尾
}); // 结束代码块：本层作用域收尾

describe('image 图形验证码', () => { // 用例「image 图形验证码」：覆盖对应业务契约
  const e = { MIM_CAPTCHA_MODE: 'image', MIM_CAPTCHA_LOGIN: '1' }; // 保存 e：承载本步骤的计算结果供后续使用

  it('签发题目返回 id / svg / 过期时间；正确答案一次性消费后不可重用', async () => { // 用例「签发题目返回 id / svg / 过期时间；正确答案一次性消费后不可重用」：覆盖对应业务契约
    const issue = issueCaptcha(db, env(e), 'login'); // 保存 issue：承载本步骤的计算结果供后续使用
    expect(issue.required).toBe(true); // 断言：校验接口返回符合契约
    expect(issue.mode).toBe('image'); // 断言：校验接口返回符合契约
    expect(issue.id).toBeTruthy(); // 断言：校验接口返回符合契约
    expect(issue.svg).toContain('<svg'); // 断言：校验接口返回符合契约

    const captcha = createCaptcha(); // 保存 captcha：承载本步骤的计算结果供后续使用
    db.prepare('INSERT INTO captchas (id, answer_hash, expires_at, used_at, created_at) VALUES (?, ?, ?, NULL, ?)').run( // 预编译 SQL：固定语句结构后绑定参数执行
      captcha.id, // 业务步骤：推进当前流程的下一项处理
      captchaHash(captcha.answer), // 业务步骤：推进当前流程的下一项处理
      captcha.expires_at, // 业务步骤：推进当前流程的下一项处理
      new Date().toISOString(), // 业务步骤：推进当前流程的下一项处理
    ); // 调用结束：参数列表与链式调用收尾
    expect(consumeCaptcha(db, captcha.id, captcha.answer)).toBe(true); // 断言：校验接口返回符合契约
    // 一次性消费：同一题目第二次校验失败（防重放）
    expect(consumeCaptcha(db, captcha.id, captcha.answer)).toBe(false); // 断言：校验接口返回符合契约
  }); // 结束函数体：本层作用域收尾

  it('答案错误 / 缺失抛 AUTH_CODE_INVALID(400)', async () => { // 用例「答案错误 / 缺失抛 AUTH_CODE_INVALID(400)」：覆盖对应业务契约
    await expect(verifyCaptcha(db, env(e), 'login', { captcha_id: issueCaptcha(db, env(e), 'login').id, captcha_code: 'wrong' })).rejects.toMatchObject({ // 断言：校验接口返回符合契约
      code: 'AUTH_CODE_INVALID', // 对象字段：声明结构中的一项数据
      status: 400, // 对象字段：声明结构中的一项数据
    }); // 结束函数体：本层作用域收尾
    await expect(verifyCaptcha(db, env(e), 'login', {})).rejects.toMatchObject({ code: 'AUTH_CODE_INVALID' }); // 断言：校验接口返回符合契约
  }); // 结束代码块：本层作用域收尾
}); // 结束代码块：本层作用域收尾

describe('slider 滑动拼图', () => { // 用例「slider 滑动拼图」：覆盖对应业务契约
  const e = { MIM_CAPTCHA_MODE: 'slider', MIM_CAPTCHA_LOGIN: '1' }; // 保存 e：承载本步骤的计算结果供后续使用

  function persistSlider(expectedX: number): string { // 定义函数 persistSlider：封装可复用业务步骤
    const id = `slider-test-${expectedX}`; // 保存 id：承载本步骤的计算结果供后续使用
    const digest = createHash('sha256').update(String(expectedX)).digest('hex'); // 保存 digest：承载本步骤的计算结果供后续使用
    db.prepare('INSERT INTO captchas (id, answer_hash, expires_at, used_at, created_at) VALUES (?, ?, ?, NULL, ?)').run( // 预编译 SQL：固定语句结构后绑定参数执行
      id, // 业务步骤：推进当前流程的下一项处理
      digest, // 业务步骤：推进当前流程的下一项处理
      new Date(Date.now() + 600_000).toISOString(), // 业务步骤：推进当前流程的下一项处理
      new Date().toISOString(), // 业务步骤：推进当前流程的下一项处理
    ); // 调用结束：参数列表与链式调用收尾
    return id; // 返回结果：把本步骤产物交给调用方
  } // 结束函数体：本层作用域收尾

  it('签发题目返回背景 SVG 与缺口位置，不下发目标 x', () => { // 用例「签发题目返回背景 SVG 与缺口位置，不下发目标 x」：覆盖对应业务契约
    const issue = issueCaptcha(db, env(e), 'login'); // 保存 issue：承载本步骤的计算结果供后续使用
    expect(issue.mode).toBe('slider'); // 断言：校验接口返回符合契约
    expect(issue.slider?.background).toContain('<svg'); // 断言：校验接口返回符合契约
    expect(issue.slider?.gap.y).toBeGreaterThanOrEqual(0); // 断言：校验接口返回符合契约
    expect(issue.slider).not.toHaveProperty('x'); // 断言：校验接口返回符合契约
  }); // 结束函数体：本层作用域收尾

  it('容差内通过一次；超出容差失败；消费后不可重用', async () => { // 用例「容差内通过一次；超出容差失败；消费后不可重用」：覆盖对应业务契约
    const id = persistSlider(120); // 保存 id：承载本步骤的计算结果供后续使用
    await expect(verifyCaptcha(db, env(e), 'login', { captcha_id: id, slider_x: 125 })).resolves.toBeUndefined(); // 断言：校验接口返回符合契约
    await expect(verifyCaptcha(db, env(e), 'login', { captcha_id: id, slider_x: 125 })).rejects.toMatchObject({ code: 'AUTH_CODE_INVALID' }); // 断言：校验接口返回符合契约

    const outside = persistSlider(121); // 保存 outside：承载本步骤的计算结果供后续使用
    await expect(verifyCaptcha(db, env(e), 'login', { captcha_id: outside, slider_x: 200 })).rejects.toMatchObject({ code: 'AUTH_CODE_INVALID' }); // 断言：校验接口返回符合契约
  }); // 结束代码块：本层作用域收尾
}); // 结束代码块：本层作用域收尾

describe('第三方验证码缺凭证返回 503，不放行', () => { // 用例「第三方验证码缺凭证返回 503，不放行」：覆盖对应业务契约
  it('tencent 模式未配置密钥：签发与校验均抛 PROVIDER_NOT_CONFIGURED(503)', async () => { // 用例「tencent 模式未配置密钥：签发与校验均抛 PROVIDER_NOT_CONFIGURED(503)」：覆盖对应业务契约
    const e = { MIM_CAPTCHA_MODE: 'tencent', MIM_CAPTCHA_LOGIN: '1' }; // 保存 e：承载本步骤的计算结果供后续使用
    expect(() => issueCaptcha(db, env(e), 'login')).toThrow(AppError); // 断言：校验接口返回符合契约
    try { // 异常保护：确保失败路径可回收资源
      issueCaptcha(db, env(e), 'login'); // 业务步骤：推进当前流程的下一项处理
    } catch (err) { // 结束代码块：本层作用域收尾
      expect((err as AppError).status).toBe(503); // 断言：校验接口返回符合契约
    } // 结束代码块：本层作用域收尾
    await expect(verifyCaptcha(db, env(e), 'login', { ticket: 't', randstr: 'r' })).rejects.toMatchObject({ // 断言：校验接口返回符合契约
      code: 'PROVIDER_NOT_CONFIGURED', // 对象字段：声明结构中的一项数据
      status: 503, // 对象字段：声明结构中的一项数据
    }); // 结束函数体：本层作用域收尾
  }); // 结束函数体：本层作用域收尾

  it('geetest4 模式未配置密钥：签发与校验均抛 503', async () => { // 用例「geetest4 模式未配置密钥：签发与校验均抛 503」：覆盖对应业务契约
    const e = { MIM_CAPTCHA_MODE: 'geetest4', MIM_CAPTCHA_LOGIN: '1' }; // 保存 e：承载本步骤的计算结果供后续使用
    try { // 异常保护：确保失败路径可回收资源
      issueCaptcha(db, env(e), 'login'); // 业务步骤：推进当前流程的下一项处理
    } catch (err) { // 结束代码块：本层作用域收尾
      expect((err as AppError).status).toBe(503); // 断言：校验接口返回符合契约
    } // 结束代码块：本层作用域收尾
    await expect( // 断言：校验接口返回符合契约
      verifyCaptcha(db, env(e), 'login', { lot_number: 'l', captcha_output: 'o', pass_token: 'p', gen_time: '1' }), // 业务步骤：推进当前流程的下一项处理
    ).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED', status: 503 }); // 调用结束：参数列表与链式调用收尾
  }); // 结束函数体：本层作用域收尾
}); // 结束代码块：本层作用域收尾
