/** zod 入参校验，失败统一翻译为 VALIDATION_FAILED */

import { z } from 'zod';
import { AppError } from '@mim/core-domain';

export function parse<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value ?? {});
  if (!result.success) {
    throw new AppError('VALIDATION_FAILED', 'request validation failed', {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
}
