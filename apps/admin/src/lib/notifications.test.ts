import { NOTIFICATION_KIND_ICONS, NOTIFICATION_KIND_LABELS, notificationKindLabel } from './notifications';
import { STAFF_NOTIFICATION_KINDS } from '@nilzora/contracts';
import { describe, expect, it } from 'vitest';

/*
 * The inbox names and icons every kind the database can store. A kind added to the enum
 * without a label would show as a generic "Notification", so the maps are checked against
 * the contract itself rather than a copy of its list.
 */

describe('notification kind presentation', () => {
  it('names and icons every kind the contract accepts', () => {
    for (const kind of STAFF_NOTIFICATION_KINDS) {
      expect(NOTIFICATION_KIND_LABELS[kind], `label for ${kind}`).toBeTruthy();
      expect(NOTIFICATION_KIND_ICONS[kind], `icon for ${kind}`).toBeTruthy();
    }
    expect(Object.keys(NOTIFICATION_KIND_LABELS)).toHaveLength(STAFF_NOTIFICATION_KINDS.length);
  });

  it('names the internal chat kinds', () => {
    expect(notificationKindLabel('chat_message')).toBe('Chat message');
    expect(notificationKindLabel('chat_escalation')).toBe('Chat escalation');
  });

  it('still tolerates a kind a newer API may add', () => {
    expect(notificationKindLabel('something_new')).toBe('Notification');
  });
});
