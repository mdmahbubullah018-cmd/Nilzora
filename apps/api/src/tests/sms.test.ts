import { describe, expect, it } from 'vitest';
import {
  disabledSmsSender,
  isBangladeshMobile,
  renderSmsTemplate,
  SmsTemplateError,
} from '../modules/notifications/sms';

describe('SMS channel without a provider', () => {
  it('never claims to have sent anything', async () => {
    expect(
      await disabledSmsSender.send({ to: '+8801712345678', text: 'Hi', idempotencyKey: 'e1' }),
    ).toEqual({
      status: 'rejected',
      reason: 'disabled',
    });
    expect(
      await disabledSmsSender.send({ to: '01712345678', text: 'Hi', idempotencyKey: 'e2' }),
    ).toEqual({
      status: 'rejected',
      reason: 'invalid_number',
    });
  });

  it('accepts only Bangladesh mobile numbers in E.164', () => {
    expect(isBangladeshMobile('+8801912345678')).toBe(true);
    expect(isBangladeshMobile('+8801212345678')).toBe(false);
    expect(isBangladeshMobile('+447700900123')).toBe(false);
  });
});

describe('SMS templates', () => {
  it('fills validated variables and nothing else', () => {
    expect(
      renderSmsTemplate('Nilzora: order {{orderNumber}} is {{status}}.', {
        orderNumber: 'NZ-1001',
        status: 'shipped',
      }),
    ).toBe('Nilzora: order NZ-1001 is shipped.');
  });

  it('refuses a missing, unexpected or malformed variable instead of sending a gap', () => {
    expect(() => renderSmsTemplate('Order {{orderNumber}}', {})).toThrow(SmsTemplateError);
    expect(() =>
      renderSmsTemplate('Order {{orderNumber}}', { orderNumber: 'A', extra: 'B' }),
    ).toThrow(SmsTemplateError);
    expect(() => renderSmsTemplate('Order {{ orderNumber', { orderNumber: 'A' })).toThrow(
      SmsTemplateError,
    );
  });

  it('keeps values on one line and inside two segments', () => {
    expect(renderSmsTemplate('{{a}}', { a: 'one\ntwo' })).toBe('one two');
    expect(() => renderSmsTemplate('x'.repeat(307), {})).toThrow(SmsTemplateError);
  });
});
