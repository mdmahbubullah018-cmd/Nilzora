import { INFO_PAGES } from '@nilzora/contracts';
import { InfoPageScreen } from '@/features/info/info-page-screen';

/**
 * The returns and refunds policy: the same wording as the website. (Requesting a return is the
 * Returns screen; this explains how a request is handled.)
 */
export default function ReturnsPolicyScreen() {
  return <InfoPageScreen page={INFO_PAGES.returns} />;
}
