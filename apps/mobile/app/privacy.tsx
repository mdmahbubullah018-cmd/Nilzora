import { INFO_PAGES, storeContactSection } from '@nilzora/contracts';
import { InfoPageScreen } from '@/features/info/info-page-screen';
import { useStoreProfile } from '@/features/store/store-hooks';

/**
 * The privacy policy. The same wording as the website, plus the store's own published contact
 * details at the end. While the profile is still loading there is no contact section at all, so
 * a slow network never shows "no details published" by mistake; if the read fails, the page says
 * so in the same words the website uses.
 */
export default function PrivacyScreen() {
  const query = useStoreProfile();
  const contact =
    query.data === undefined
      ? query.status === 'error'
        ? storeContactSection(null)
        : undefined
      : storeContactSection(query.data.profile);

  return <InfoPageScreen page={INFO_PAGES.privacy} contact={contact} />;
}
