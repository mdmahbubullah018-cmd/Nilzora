/*
 * The customer FAQ
 * ----------------
 * Every answer here describes a screen or a rule that exists in this project, so the website
 * and the Android app can offer the same questions and the same wording. Policy questions are
 * answered by pointing at the Privacy policy and the Terms of service rather than by repeating
 * them, so there is only one place to change a promise.
 *
 * Nothing here names a delivery time, a refund deadline, a fee, a phone number or an address:
 * those are the store's decisions, and a question without a decided answer is not listed.
 */

export const FAQ_CATEGORIES = [
  'ordering',
  'payment',
  'delivery',
  'returns',
  'reviews',
  'account',
  'app',
] as const;

/** The page's own title and lead line, shared so both platforms introduce it the same way. */
export const FAQ_TITLE = 'Frequently asked questions';
export const FAQ_SUMMARY =
  'Short answers about placing an order, paying on delivery, delivery, returns, reviews, your account and the app.';

export type FaqCategory = (typeof FAQ_CATEGORIES)[number];

/** The heading each group of questions is shown under. */
export const FAQ_CATEGORY_LABELS: Readonly<Record<FaqCategory, string>> = {
  ordering: 'Ordering',
  payment: 'Payment',
  delivery: 'Delivery',
  returns: 'Returns and refunds',
  reviews: 'Reviews',
  account: 'Account and privacy',
  app: 'Wishlist and the app',
};

export interface FaqEntry {
  /** Stable id: used as the accordion's key and as its anchor on the website. */
  id: string;
  category: FaqCategory;
  question: string;
  answer: string;
}

export const FAQ_ENTRIES: readonly FaqEntry[] = [
  {
    id: 'account-needed',
    category: 'ordering',
    question: 'Do I need an account to place an order?',
    answer:
      'Yes. Checkout needs a Nilzora account so the order can be recorded against you and delivered to a saved address. Create one with an email address and password, or sign in with Google. Browsing the catalogue, a product page and the wishlist needs no account.',
  },
  {
    id: 'how-to-order',
    category: 'ordering',
    question: 'How do I place an order?',
    answer:
      'Open a product, choose its options and quantity, and add it to your cart. In the cart, continue to checkout, pick a delivery address, check the delivery charge and the total, and confirm. The order then appears in your account with an order number and its status.',
  },
  {
    id: 'change-order',
    category: 'ordering',
    question: 'Can I change an order after placing it?',
    answer:
      'There is no edit button on an order. While it is still pending you can cancel it from your account and place a new one with the right items or address. Once it has moved past pending, contact the store through Help & support.',
  },
  {
    id: 'product-options',
    category: 'ordering',
    question: 'What are the options on a product page?',
    answer:
      'Some products come in options such as a size or a colour. Each option can have its own picture, price and stock. Choose one option for every group before you add the product to the cart; the page then shows that choice’s price and availability.',
  },
  {
    id: 'quantity-limit',
    category: 'ordering',
    question: 'Why can I only buy a few of one product?',
    answer:
      'Stock is real, and some products also set a limit per order. The quantity control stops at whichever is lower, so the order cannot take more units than the store has or allows.',
  },
  {
    id: 'out-of-stock',
    category: 'ordering',
    question: 'The product I want is out of stock. What can I do?',
    answer:
      'An out-of-stock product cannot be ordered, and Nilzora has no back-in-stock alert yet. Save it to your wishlist to find it again quickly, and check the product page later.',
  },
  {
    id: 'payment-methods',
    category: 'payment',
    question: 'How can I pay for my order?',
    answer:
      'Cash on delivery is the only payment method Nilzora offers today. You pay the full order total, including the delivery charge, in cash when the parcel arrives.',
  },
  {
    id: 'cards-and-wallets',
    category: 'payment',
    question: 'Do you take cards, bKash or Nagad?',
    answer:
      'Not today. Nilzora does not ask for card or mobile-wallet details anywhere on the website or in the app, and keeps none on your account.',
  },
  {
    id: 'delivery-charge',
    category: 'payment',
    question: 'How is the delivery charge worked out?',
    answer:
      'Your district decides the delivery zone, and the store sets one charge per zone. Checkout shows the exact charge for the address you choose before you confirm, and the total you see there is the amount you pay on delivery.',
  },
  {
    id: 'total-changes',
    category: 'payment',
    question: 'Can the total change after I order?',
    answer:
      'No. The store calculates the price, the delivery charge and any discount when the order is placed, and it records that total with the order. Nothing is charged before delivery, because payment is cash on delivery.',
  },
  {
    id: 'where-you-deliver',
    category: 'delivery',
    question: 'Where do you deliver?',
    answer:
      'Within Bangladesh, to the divisions and districts offered when you add a delivery address. The district you choose decides the delivery zone and therefore the charge.',
  },
  {
    id: 'delivery-time',
    category: 'delivery',
    question: 'How long does delivery take?',
    answer:
      'Nilzora does not publish a delivery time yet. The store arranges delivery once your order is confirmed, and reaches you on the phone number on the order if it needs to. Ask the store through Help & support about a specific order.',
  },
  {
    id: 'follow-order',
    category: 'delivery',
    question: 'How do I follow my order?',
    answer:
      'Open My orders in your account. Each order shows its current status and the history of statuses it has passed through. If you allow notifications, the Android app also tells you when an order’s status changes.',
  },
  {
    id: 'wrong-address',
    category: 'delivery',
    question: 'I entered the wrong address. What now?',
    answer:
      'Contact the store through Help & support as soon as you notice. An order keeps the address it was placed with, so correcting it is something the store has to do before the parcel goes out. You can fix the saved address in your account for future orders.',
  },
  {
    id: 'return-an-item',
    category: 'returns',
    question: 'How do I return something?',
    answer:
      'Open Returns in your account and start a return for a delivered order: choose the items, how many of each, and a reason. The store then reviews the request, records the items when they reach it, and completes the return.',
  },
  {
    id: 'return-window',
    category: 'returns',
    question: 'How long do I have to ask for a return?',
    answer:
      'The store sets its own return window. Send the request from Returns, and the store checks whether the delivered order can still be returned; if you are unsure, ask through Help & support before sending anything back.',
  },
  {
    id: 'refunds',
    category: 'returns',
    question: 'How does a refund work?',
    answer:
      'A refund can only cover the cash collected for the units you send back, so it can never exceed what you paid for them. The store records the refund against the return and pays it the way you agree with support.',
  },
  {
    id: 'cancel-order',
    category: 'returns',
    question: 'How do I cancel an order?',
    answer:
      'Open the order in your account and cancel it while it is still pending; you can add a reason. Cancelling releases the stock the order was holding. An order that has moved past pending can no longer be cancelled there.',
  },
  {
    id: 'who-can-review',
    category: 'reviews',
    question: 'Who can write a review?',
    answer:
      'Customers who received the product they are reviewing. A product you have not had delivered shows no review form; once your order is delivered, the form appears on the product page.',
  },
  {
    id: 'review-not-showing',
    category: 'reviews',
    question: 'Why is my review not showing on the product page?',
    answer:
      'Reviews are checked by the store before they are published. A new review waits in moderation, and only you and the store can see it until it is approved. Your account shows whether it is waiting, published or not published.',
  },
  {
    id: 'review-photos',
    category: 'reviews',
    question: 'Can I add photos to a review?',
    answer:
      'Yes, up to four per review. Each photo must be a JPEG, PNG or WebP of at most 5 MB and at least 300 pixels on each side. Photos appear with the review once it is published.',
  },
  {
    id: 'edit-review',
    category: 'reviews',
    question: 'Can I edit or delete my review?',
    answer:
      'Editing and deleting a review from your account is not available yet. Ask the store through Help & support if a published review needs to be changed or removed.',
  },
  {
    id: 'forgot-password',
    category: 'account',
    question: 'I forgot my password. How do I get back in?',
    answer:
      'Use “Forgot your password” on the sign-in screen. Nilzora emails a six-digit code, and the code lets you set a new password. If the email does not arrive, check the address you registered with and try again.',
  },
  {
    id: 'verify-email',
    category: 'account',
    question: 'Why do I have to confirm my email address?',
    answer:
      'Signing in needs a confirmed address, because that is where verification and password-reset codes go. When you register, Nilzora emails a six-digit code; enter it to finish setting up the account.',
  },
  {
    id: 'delete-address',
    category: 'account',
    question: 'How do I delete a delivery address?',
    answer:
      'Open Saved addresses in your account and delete the address. Orders you already placed keep the address they were sent to, because that is the record of where the parcel went.',
  },
  {
    id: 'delete-account',
    category: 'account',
    question: 'Can I delete my account?',
    answer:
      'There is no self-service delete button yet. Ask the store through Help & support and it will tell you what can be removed and what has to be kept with your order records. The Privacy policy explains what is stored.',
  },
  {
    id: 'what-data',
    category: 'account',
    question: 'What information does Nilzora keep about me?',
    answer:
      'Your account, delivery addresses, orders, reviews, wishlist and support conversations, plus the records that keep them working. The Privacy policy lists all of it, who processes it, and the choices you have.',
  },
  {
    id: 'marketing-notifications',
    category: 'account',
    question: 'How do I stop product notifications?',
    answer:
      'Open Settings from your account and switch product announcements off for each device. Order updates are separate: they tell you about an order you placed, and they are not affected by that switch.',
  },
  {
    id: 'wishlist',
    category: 'app',
    question: 'Where is my wishlist kept?',
    answer:
      'The heart saves a product on the device you tapped it on. Once you sign in, those saved products are offered to your account and the wishlist follows you between the website and the app.',
  },
  {
    id: 'app-or-website',
    category: 'app',
    question: 'Do I need the app to shop with Nilzora?',
    answer:
      'No. The website and the Android app use the same account, catalogue, stock and orders, so you can start on one and continue on the other.',
  },
  {
    id: 'contact-a-person',
    category: 'app',
    question: 'How do I reach a person?',
    answer:
      'Use Help & support to open a conversation with the store; you can send text, pictures, documents or a voice message. The Contact page in the app shows the phone number, email address and address the store has published.',
  },
];

/** Case- and accent-insensitive words of a search, ignoring extra spaces. */
function words(query: string): string[] {
  return query
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9']+/)
    .filter((word) => word !== '');
}

/**
 * Whether a question matches a search: every word the customer typed must appear in the
 * question or its answer, in any order. An empty search matches everything.
 */
export function faqMatches(entry: FaqEntry, query: string): boolean {
  const wanted = words(query);
  if (wanted.length === 0) return true;
  const haystack = `${entry.question} ${entry.answer}`.toLowerCase();
  return wanted.every((word) => haystack.includes(word));
}

/** The entries a search keeps, in their original order. */
export function searchFaq(query: string, entries: readonly FaqEntry[] = FAQ_ENTRIES): FaqEntry[] {
  return entries.filter((entry) => faqMatches(entry, query));
}

export interface FaqGroup {
  category: FaqCategory;
  label: string;
  entries: FaqEntry[];
}

/**
 * The entries grouped by category, in the fixed category order, skipping a group a search
 * left empty. A group with nothing to show is not rendered by either platform.
 */
export function groupFaq(entries: readonly FaqEntry[]): FaqGroup[] {
  return FAQ_CATEGORIES.flatMap((category) => {
    const found = entries.filter((entry) => entry.category === category);
    return found.length === 0
      ? []
      : [{ category, label: FAQ_CATEGORY_LABELS[category], entries: found }];
  });
}
