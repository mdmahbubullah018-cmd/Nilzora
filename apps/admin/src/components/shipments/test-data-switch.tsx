import type { Route } from 'next';
import { withQuery } from '@/components/admin-kit/href';
import { SegmentedNav } from '@/components/admin-kit/segmented-nav';

/**
 * Test (mock courier) shipments are left out of every list and total unless staff ask for
 * them through this switch; each view has its own address.
 */
export function TestDataSwitch({
  path,
  includeTest,
  params = {},
}: {
  path: Route;
  includeTest: boolean;
  /** The page's other filters, kept when switching. */
  params?: Readonly<Record<string, string | undefined>>;
}) {
  return (
    <SegmentedNav
      label="Test data"
      current={includeTest ? 'test' : 'real'}
      options={[
        {
          key: 'real',
          label: 'Real shipments',
          href: withQuery(path, { ...params, test: undefined }),
        },
        { key: 'test', label: 'Include test data', href: withQuery(path, { ...params, test: 1 }) },
      ]}
    />
  );
}
