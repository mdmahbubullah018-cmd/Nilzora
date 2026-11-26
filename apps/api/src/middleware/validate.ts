import type { ValidationIssue } from '@nilzora/contracts';
import type { RequestHandler, Response } from 'express';
import type { z, ZodType } from 'zod';
import { sendError } from '../http/send-error';

export interface RequestSchemas {
  params?: ZodType;
  query?: ZodType;
  body?: ZodType;
}

/** The parsed (and transformed) values for each validated location. */
export type RequestInput<S extends RequestSchemas> = {
  [K in keyof S]: S[K] extends ZodType ? z.output<S[K]> : never;
};

const LOCATIONS = ['params', 'query', 'body'] as const;

/** Caps the issues returned so a huge invalid payload cannot produce a huge response. */
const MAX_ISSUES = 20;

/**
 * Validates path parameters, query string and JSON body at the server boundary.
 * Invalid requests get a 400 `validation_failed` response listing the field
 * paths and messages only; submitted values are never echoed back. Valid input
 * is available to the handler via requestInput().
 */
export function validate(schemas: RequestSchemas): RequestHandler {
  return (req, res, next) => {
    const issues: ValidationIssue[] = [];
    const input: Partial<Record<(typeof LOCATIONS)[number], unknown>> = {};

    for (const location of LOCATIONS) {
      const schema = schemas[location];
      if (!schema) continue;
      const result = schema.safeParse(req[location]);
      if (result.success) {
        input[location] = result.data;
      } else {
        for (const issue of result.error.issues) {
          issues.push({ location, path: issue.path.map(String).join('.'), message: issue.message });
        }
      }
    }

    if (issues.length > 0) {
      sendError(res, 400, 'validation_failed', 'The request is invalid', {
        issues: issues.slice(0, MAX_ISSUES),
      });
      return;
    }
    res.locals.input = input;
    next();
  };
}

/** Typed access to the input stored by validate(schemas). */
export function requestInput<S extends RequestSchemas>(res: Response): RequestInput<S> {
  return res.locals.input as RequestInput<S>;
}
