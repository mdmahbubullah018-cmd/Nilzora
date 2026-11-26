import { INFO_PAGES } from '@nilzora/contracts';
import { InfoPageScreen } from '@/features/info/info-page-screen';

/** The delivery policy: the same wording as the website. */
export default function DeliveryPolicyScreen() {
  return <InfoPageScreen page={INFO_PAGES.shipping} />;
}
