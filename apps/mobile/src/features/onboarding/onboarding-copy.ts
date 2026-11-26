/*
 * The first-launch tutorial's words.
 *
 * The app is English-only, and so is this tutorial: there is no second language here, no
 * switch and no locale detection. Every string a shopper can see or hear lives in this file,
 * including the few words the miniature screens draw, so neither the scenes nor the chrome
 * hard-code a word.
 */

export type OnboardingStepId = 'browse' | 'photos' | 'variants' | 'cart' | 'order';

export interface OnboardingStep {
  id: OnboardingStepId;
  /** The headline with the emphasis phrase separated out, for the two-tone title. */
  lead: string;
  highlight: string;
  /** The headline as one sentence: what a screen reader announces. */
  title: string;
  body: string;
}

export interface OnboardingCopy {
  /** The tutorial's own name, used by the progress indicator. */
  progressLabel: string;
  steps: readonly OnboardingStep[];
  skip: string;
  skipHint: string;
  next: string;
  nextHint: string;
  previous: string;
  previousHint: string;
  start: string;
  /** The few words the miniature screens draw. */
  demo: Readonly<{
    search: string;
    product: string;
    price: string;
    addToCart: string;
    cart: string;
    colour: string;
    size: string;
    cod: string;
    address: string;
    total: string;
    placeOrder: string;
  }>;
}

export const ONBOARDING_COPY: OnboardingCopy = {
  progressLabel: 'Introduction page',
  steps: [
    {
      id: 'browse',
      lead: 'Find what',
      highlight: 'you need',
      title: 'Find what you need',
      body: 'Browse the categories or search, then tap a product to open it.',
    },
    {
      id: 'photos',
      lead: 'Swipe through',
      highlight: 'the photos',
      title: 'Swipe through the photos',
      body: 'Every product has more than one photo. Swipe to look closely before you choose.',
    },
    {
      id: 'variants',
      lead: 'Choose colour',
      highlight: 'and size',
      title: 'Choose colour and size',
      body: 'Pick the colour and size you want; the price and the stock update as you choose.',
    },
    {
      id: 'cart',
      lead: 'Add to',
      highlight: 'your cart',
      title: 'Add to your cart',
      body: 'Keep everything you want in the cart, then check out once.',
    },
    {
      id: 'order',
      lead: 'Order with',
      highlight: 'cash on delivery',
      title: 'Order with cash on delivery',
      body: 'Enter your address, choose cash on delivery, and pay when the parcel reaches you.',
    },
  ],
  skip: 'Skip',
  skipHint: 'Goes straight to the shop',
  next: 'Next',
  nextHint: 'Goes to the next step',
  previous: 'Previous',
  previousHint: 'Goes back one step',
  start: 'Start shopping',
  demo: {
    search: 'Search',
    product: 'Premium Panjabi',
    price: '৳1,020',
    addToCart: 'Add to cart',
    cart: 'Cart',
    colour: 'Colour',
    size: 'Size',
    cod: 'Cash on delivery',
    address: 'Address',
    total: 'Total',
    placeOrder: 'Place order',
  },
};
