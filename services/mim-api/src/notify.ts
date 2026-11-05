/** 验证码通知通道：短信（阿里云 SMS）与邮件（AWS SES）供应商接入与装配 */

import Dysmsapi20170525, * as $Dysmsapi20170525 from '@alicloud/dysmsapi20170525';
import * as $OpenApi from '@alicloud/openapi-client';
import * as $Util from '@alicloud/tea-util';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

/** 验证码下发通道（短信或邮件），发送失败时抛错由路由层翻译为 AUTH_CODE_DELIVERY_FAILED */
export interface CodeChannel {
  send(identifier: string, code: string): Promise<void>;
}

export interface NotifyChannels {
  sms?: CodeChannel;
  email?: CodeChannel;
}

/** 阿里云短信验证码通道（国内手机号）；四项凭证任一缺失则不启用 */
export function createAliyunSmsChannel(
  env: Record<string, string | undefined>,
): CodeChannel | undefined {
  const accessKeyId = env.MIM_SMS_ALIYUN_ACCESS_KEY_ID?.trim();
  const accessKeySecret = env.MIM_SMS_ALIYUN_ACCESS_KEY_SECRET?.trim();
  const signName = env.MIM_SMS_ALIYUN_SIGN_NAME?.trim();
  const templateCode = env.MIM_SMS_ALIYUN_TEMPLATE_CODE?.trim();
  if (!accessKeyId || !accessKeySecret || !signName || !templateCode) return undefined;

  const config = new $OpenApi.Config({ accessKeyId, accessKeySecret });
  config.endpoint = 'dysmsapi.aliyuncs.com';
  const client = new Dysmsapi20170525(config);

  return {
    async send(phone, code) {
      const request = new $Dysmsapi20170525.SendSmsRequest({
        phoneNumbers: phone,
        signName,
        templateCode,
        // 阿里云短信模板变量名固定为 code（模板示例：验证码 ${code}，5 分钟内有效）
        templateParam: JSON.stringify({ code }),
      });
      const response = await client.sendSmsWithOptions(request, new $Util.RuntimeOptions({}));
      const body = response.body;
      if (body?.code !== 'OK') {
        throw new Error(`aliyun sms send failed: ${body?.code ?? 'UNKNOWN'} ${body?.message ?? ''}`);
      }
    },
  };
}

/** AWS SES 邮件验证码通道（海外邮箱）；region 未配置时回退 us-east-1 */
export function createSesEmailChannel(
  env: Record<string, string | undefined>,
): CodeChannel | undefined {
  const accessKeyId = env.MIM_EMAIL_SES_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.MIM_EMAIL_SES_SECRET_ACCESS_KEY?.trim();
  const from = env.MIM_EMAIL_SES_FROM_ADDRESS?.trim();
  if (!accessKeyId || !secretAccessKey || !from) return undefined;

  const client = new SESClient({
    region: env.MIM_EMAIL_SES_REGION?.trim() || 'us-east-1',
    credentials: { accessKeyId, secretAccessKey },
  });

  return {
    async send(email, code) {
      await client.send(
        new SendEmailCommand({
          Source: from,
          Destination: { ToAddresses: [email] },
          Message: {
            Subject: { Data: 'Your Mim verification code', Charset: 'UTF-8' },
            Body: {
              Text: {
                Data: `Your Mim verification code is ${code}. It expires in 5 minutes. If you did not request it, please ignore this email.`,
                Charset: 'UTF-8',
              },
            },
          },
        }),
      );
    },
  };
}

/** 依据环境变量装配可用通道；凭证不全的通道保持缺省，由路由层按缺省拒绝（生产 503） */
export function createNotifyChannels(env: Record<string, string | undefined>): NotifyChannels {
  return {
    sms: createAliyunSmsChannel(env),
    email: createSesEmailChannel(env),
  };
}
