import { INFO_PAGES, storeContactSection } from '@nilzora/contracts';
import { InfoPageScreen } from '@/features/info/info-page-screen';
import { useStoreProfile } from '@/features/store/store-hooks';

/**
 * The terms of service. Shared wording, and the store's published contact details at the end.
 * Nothing about jurisdiction, registration or dispute resolution is claimed: the owner has not
 * decided it.
 */
export default function TermsScreen() {
  const query = useStoreProfile();
  const contact =
    query.data === undefined
      ? query.status === 'error'
        ? storeContactSection(null)
        : undefined
      : storeContactSection(query.data.profile);

  return <InfoPageScreen page={INFO_PAGES.terms} contact={contact} />;
}
