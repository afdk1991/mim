/** 验证码通知通道：短信（阿里云 SMS）与邮件（AWS SES）供应商接入与装配 */

import Dysmsapi20170525, * as $Dysmsapi20170525 from '@alicloud/dysmsapi20170525'; // 阿里云短信默认客户端 + 请求模型命名空间
import * as $OpenApi from '@alicloud/openapi-client'; // 阿里云 OpenAPI 通用配置（凭证、endpoint），被短信客户端复用
import * as $Util from '@alicloud/tea-util'; // 阿里云运行时配置（超时、重试等），此处使用默认值
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses'; // AWS SES 客户端与发信命令，用于海外邮箱验证码

/** 验证码下发通道（短信或邮件），发送失败时抛错由路由层翻译为 AUTH_CODE_DELIVERY_FAILED */
export interface CodeChannel { // 统一通道抽象：短信与邮件对上层是同一种能力
  send(identifier: string, code: string): Promise<void>; // 异步发送验证码；失败由实现抛错，由上层统一翻译错误码
} // 接口结束

export interface NotifyChannels { // 可用通道集合：按用户区域选择短信或邮件
  sms?: CodeChannel; // 可选短信通道，未配置凭证时为 undefined
  email?: CodeChannel; // 可选邮件通道，未配置凭证时为 undefined
} // 接口结束

/** 阿里云短信验证码通道（国内手机号）；四项凭证任一缺失则不启用 */
export function createAliyunSmsChannel( // 构造国内短信通道，凭证来自环境变量
  env: Record<string, string | undefined>, // 环境变量只读视图：逐项读取阿里云短信四项凭证
): CodeChannel | undefined { // 返回通道实例；凭证不全时返回 undefined 供上层降级
  const accessKeyId = env.MIM_SMS_ALIYUN_ACCESS_KEY_ID?.trim(); // AccessKeyId：去首尾空白，空串视为未配置
  const accessKeySecret = env.MIM_SMS_ALIYUN_ACCESS_KEY_SECRET?.trim(); // AccessKeySecret：与 Id 成对使用
  const signName = env.MIM_SMS_ALIYUN_SIGN_NAME?.trim(); // 短信签名：必须是控制台已审核通过的签名
  const templateCode = env.MIM_SMS_ALIYUN_TEMPLATE_CODE?.trim(); // 模板编码：如 SMS_xxxx，决定短信文案
  if (!accessKeyId || !accessKeySecret || !signName || !templateCode) return undefined; // 四项缺一不可，任缺即视为未启用

  const config = new $OpenApi.Config({ accessKeyId, accessKeySecret }); // 构造 OpenAPI 配置并注入访问凭证
  config.endpoint = 'dysmsapi.aliyuncs.com'; // 显式指定短信接入点，避免默认地域 endpoint 不匹配导致调用失败
  const client = new Dysmsapi20170525(config); // 创建短信客户端，可跨请求复用减少握手开销

  return { // 返回符合 CodeChannel 的短信实现
    async send(phone, code) { // 发送验证码到指定手机号
      const request = new $Dysmsapi20170525.SendSmsRequest({ // 组装 SendSms 请求体
        phoneNumbers: phone, // 接收号码：已由 auth 层归一为 11 位国内手机号
        signName, // 短信签名，须与模板归属一致
        templateCode, // 模板编码，决定最终文案
        // 阿里云短信模板变量名固定为 code（模板示例：验证码 ${code}，5 分钟内有效）
        templateParam: JSON.stringify({ code }), // 模板变量必须是 JSON 字符串，键名需与模板占位符一致
      }); // 请求组装结束
      const response = await client.sendSmsWithOptions(request, new $Util.RuntimeOptions({})); // 发起调用，运行时参数取默认（不额外设超时与重试）
      const body = response.body; // 业务响应体，含 code / message 等字段
      if (body?.code !== 'OK') { // 阿里云以 OK 表示成功，其它均为失败（限流、欠费、签名不符等）
        throw new Error(`aliyun sms send failed: ${body?.code ?? 'UNKNOWN'} ${body?.message ?? ''}`); // 带上供应商错误码便于排障，由上层翻译为统一错误
      } // 结果判定结束
    }, // send 实现结束
  }; // 通道对象结束
} // createAliyunSmsChannel 结束

/** AWS SES 邮件验证码通道（海外邮箱）；region 未配置时回退 us-east-1 */
export function createSesEmailChannel( // 构造海外邮件通道，凭证来自环境变量
  env: Record<string, string | undefined>, // 环境变量只读视图：逐项读取 SES 三项凭证
): CodeChannel | undefined { // 返回通道实例；凭证不全时返回 undefined
  const accessKeyId = env.MIM_EMAIL_SES_ACCESS_KEY_ID?.trim(); // SES AccessKeyId
  const secretAccessKey = env.MIM_EMAIL_SES_SECRET_ACCESS_KEY?.trim(); // SES SecretAccessKey
  const from = env.MIM_EMAIL_SES_FROM_ADDRESS?.trim(); // 发件人地址，必须在 SES 中完成验证否则会被拒发
  if (!accessKeyId || !secretAccessKey || !from) return undefined; // 三项缺一不可，缺省即视为未启用

  const client = new SESClient({ // 创建 SES 客户端
    region: env.MIM_EMAIL_SES_REGION?.trim() || 'us-east-1', // 未指定区域时回退 us-east-1，避免 SDK 因缺 region 直接抛错
    credentials: { accessKeyId, secretAccessKey }, // 显式传入静态凭证，不依赖运行环境的实例角色
  }); // 客户端创建结束

  return { // 返回符合 CodeChannel 的邮件实现
    async send(email, code) { // 发送验证码到指定邮箱
      await client.send( // 调用 SES 发信接口，失败会抛 SDK 异常由上层翻译
        new SendEmailCommand({ // 组装发信命令
          Source: from, // 发件人：必须是 SES 已验证地址
          Destination: { ToAddresses: [email] }, // 收件人列表，此处为单个邮箱
          Message: { // 邮件内容容器
            Subject: { Data: 'Your Mim verification code', Charset: 'UTF-8' }, // 主题；声明 UTF-8 避免特殊字符乱码
            Body: { // 正文容器
              Text: {
                Data: `Your Mim verification code is ${code}. It expires in 5 minutes. If you did not request it, please ignore this email.`, // 纯文本正文：含验证码、有效期与防钓鱼提示
                Charset: 'UTF-8', // 正文字符集
              }, // Text 正文结束
            }, // Body 结束
          }, // Message 结束
        }), // 命令组装结束
      ); // 发送结束
    }, // send 实现结束
  }; // 通道对象结束
} // createSesEmailChannel 结束

/** 依据环境变量装配可用通道；凭证不全的通道保持缺省，由路由层按缺省拒绝（生产 503） */
export function createNotifyChannels(env: Record<string, string | undefined>): NotifyChannels { // 装配入口：返回当前环境实际可用的通道
  return { // 同时尝试装配两种通道，各自独立判定是否可用
    sms: createAliyunSmsChannel(env), // 短信通道：国内手机号使用
    email: createSesEmailChannel(env), // 邮件通道：海外邮箱使用
  }; // 返回通道集合
} // createNotifyChannels 结束
