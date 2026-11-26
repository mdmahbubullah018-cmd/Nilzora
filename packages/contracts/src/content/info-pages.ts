/*
 * The store's information pages
 * -----------------------------
 * The wording of the About page, the Privacy policy and the Terms of service lives here once,
 * so the website and the Android app cannot drift apart. It is plain data: no platform API,
 * no styling, no network. Each app decides how to lay it out.
 *
 * Rules for this file
 * -------------------
 * 1. Every statement describes something the project actually does. No delivery promise, no
 *    refund deadline, no retention period, no registration number, no address and no phone
 *    number is written here, because none of them is decided.
 * 2. Contact details are never text: they come from the store profile at render time (see
 *    ./contact.ts), so an unpublished detail stays unpublished.
 * 3. When the wording changes, INFO_PAGES_UPDATED_ON changes with it: customers read that date
 *    as "last updated".
 */

/** The date these pages were last reworded. Shown to customers as "last updated". */
export const INFO_PAGES_UPDATED_ON = '2026-11-22';

/** One titled block of an information page. */
export interface InfoSection {
  heading: string;
  /** Paragraphs, in reading order. */
  paragraphs: readonly string[];
  /** Bullets shown after the paragraphs. */
  bullets?: readonly string[];
}

/** A page that offers a way to keep reading, named the same on every platform. */
export const INFO_LINK_LABELS = {
  shop: 'Browse the shop',
  faq: 'Frequently asked questions',
  privacy: 'Privacy policy',
  terms: 'Terms of service',
  about: 'About Nilzora',
  support: 'Help & support',
  returns: 'Returns and refunds policy',
  shipping: 'Delivery policy',
} as const;

export type InfoLinkKey = keyof typeof INFO_LINK_LABELS;

export interface InfoPage {
  title: string;
  /** One line under the title, also used as the page description. */
  summary: string;
  /** Lead paragraphs, shown before the first section. */
  intro: readonly string[];
  sections: readonly InfoSection[];
  /** A short, plainly worded note above the sections. */
  notice?: string;
  /** Where to go next, in this order. */
  related: readonly InfoLinkKey[];
}

const ABOUT: InfoPage = {
  title: 'About Nilzora',
  summary:
    'Nilzora is a single-vendor online store for Bangladesh, built around cash on delivery and a short, clear path from browsing to a delivered parcel.',
  intro: [
    'Nilzora sells its own products rather than hosting other sellers, so one store is responsible for the catalogue, the stock you see, the price at checkout and the parcel that arrives.',
    'The store is a website and an Android app that share the same catalogue, the same stock and the same orders. Whatever you do in one is true in the other.',
  ],
  sections: [
    {
      heading: 'What you can count on',
      paragraphs: [
        'The store is built so that the things a shopper needs to trust are decided by Nilzora, not by a browser:',
      ],
      bullets: [
        'Prices, delivery charges, discounts and totals are calculated by the store when you order, not by your device.',
        'Stock is checked when you order, so an item shown as available cannot be sold to two people at once.',
        'Review ratings and star counts come only from customers who received the product. The store can take down a review that breaks its rules.',
        'You pay in cash when the parcel arrives. Nilzora never asks for card or mobile-wallet details.',
      ],
    },
    {
      heading: 'How shopping works',
      paragraphs: [
        'Browse the catalogue by category, brand or search. A product page shows its photos, its options, the price and what stock is left.',
        'Add what you want to your cart and go to checkout. You choose a saved address, see the delivery charge for your district, and confirm the total before the order is placed.',
        'The order then appears in your account with its status, and it can be cancelled there while it is still pending. Once the parcel is delivered, you can review the product you received.',
      ],
    },
    {
      heading: 'Why it looks the way it does',
      paragraphs: [
        'The catalogue is deliberately quiet: one product at a time, honest availability, and reviews kept out of the way until you ask for them. The store would rather show you four accurate facts than eight that need a footnote.',
        'The same care applies to the account area: addresses you can edit, orders you can follow, a wishlist you can keep, and a support conversation that reaches a person.',
      ],
    },
  ],
  related: ['shop', 'faq', 'support'],
};

const PRIVACY: InfoPage = {
  title: 'Privacy policy',
  summary:
    'What Nilzora collects when you shop on the website or in the Android app, why it is collected, who is involved, and the choices you have.',
  notice:
    'This policy describes how the Nilzora store works today. It is written for customers rather than as legal advice, and it promises only what the store actually does.',
  intro: [
    'Nilzora keeps the information needed to sell you a product, deliver it, let you review it and help you when something goes wrong. This page lists that information, where it goes and what you can do about it.',
  ],
  sections: [
    {
      heading: 'What this policy covers',
      paragraphs: [
        'This policy covers the Nilzora website, the Nilzora Android app, and the store tools the Nilzora team uses to run orders, stock and support. Both the website and the app use the same store account and the same database.',
        'Nilzora takes payment in cash on delivery only, so the store never asks for, and never stores, card numbers, mobile-wallet PINs or bank credentials.',
      ],
    },
    {
      heading: 'What you give us',
      paragraphs: ['You choose what to share, and most of it is only asked for when it is needed:'],
      bullets: [
        'An account: your email address and a password. You may also add a name, a phone number and a profile photo.',
        'Sign-in with Google, if you choose it instead of a password. Nilzora receives the email address and basic profile that Google confirms.',
        'Delivery addresses: the recipient’s name, phone number, division, district, area, address line and any postal code or landmark.',
        'Orders: the products and options you chose, the quantities, the address you sent them to, an optional delivery note, and any coupon code you used.',
        'Reviews: a star rating, an optional title, your review text and up to four photos.',
        'Support messages: whatever you type, plus any images, documents or voice recordings you attach to a conversation.',
        'A wishlist of products you saved.',
      ],
    },
    {
      heading: 'What the store records as you use it',
      paragraphs: [
        'Some information is created by the software rather than typed by you. It is what makes an order traceable and an account safe:',
      ],
      bullets: [
        'Order history: each status the order passed through, its payment state and the stock it used.',
        'Cart contents: kept on the server so a cart survives a reload, and tied to your account once you sign in (a guest cart uses a cookie instead).',
        'Review moderation: whether a review is published or has been taken down, and any note the store added.',
        'Support conversations: the messages and attachments in a thread, and its status.',
        'Notification details: the push token of a device you registered, its platform and app version, and whether you want product announcements on that device.',
        'Sign-in sessions and security records, such as a count of failed sign-in attempts, so a password cannot be guessed indefinitely.',
        'Service logs with a request id and the network address a request came from, used to rate-limit abuse and to diagnose faults. Logs never contain your password.',
      ],
    },
    {
      heading: 'Cookies on the website',
      paragraphs: [
        'The website uses only what it needs to keep you signed in and to remember a guest cart. There are no advertising cookies, no third-party analytics scripts and no tracking pixels.',
        'Sign-in cookies are marked HttpOnly and SameSite=Lax, and are Secure with the __Host- prefix in production. A guest cart cookie lasts up to 30 days. Fonts are served by the site itself, so opening a page does not call out to another company.',
      ],
    },
    {
      heading: 'How the information is used',
      paragraphs: ['Nilzora uses it to run the store, and for nothing that is not on this list:'],
      bullets: [
        'To place, confirm, deliver and follow your order, and to take cash for it on delivery.',
        'To show your published reviews to other shoppers, under the name you are shown by.',
        'To answer your support conversations and to resolve returns and refunds.',
        'To check stock and stop the same unit being sold twice.',
        'To keep your account secure: verify your email, end sessions, rate-limit repeated attempts, and detect misuse.',
        'To send order-update notifications to your devices, and product announcements if you leave them switched on.',
        'To remember your cart, wishlist and the addresses you saved.',
      ],
    },
    {
      heading: 'Who else is involved',
      paragraphs: [
        'Nilzora runs the store on services that process data for it, each for one job. They are not allowed to use it for their own advertising:',
      ],
      bullets: [
        'Supabase, which hosts the PostgreSQL database that holds accounts, orders, reviews and support conversations, with row-level security switched on.',
        'Cloudflare R2, which stores the images and files you upload: product photos, your profile photo, review photos and support attachments.',
        'Firebase Cloud Messaging (Google), which delivers push notifications to the Android app.',
        'Google Sign-In, only if you choose to sign in with Google.',
        'The mail service the store has configured, which sends verification, password-reset and order-update emails.',
        'The Nilzora team members allowed to see orders, and the courier company the store books to deliver your parcel, which receives the recipient’s name, phone number, address and the cash amount to collect.',
      ],
    },
    {
      heading: 'How it is protected',
      paragraphs: [
        'Passwords are stored as Argon2id hashes and are never kept or logged in readable form. Sessions are per device and can be ended by signing out.',
        'The database enforces who may read what, so a customer can see their own orders and nobody else’s, and only published products and approved reviews are public. Keys that could bypass those rules stay on the server and are never sent to the app or the browser.',
        'Traffic is served over HTTPS, repeated attempts are rate-limited, and important staff actions are recorded in an audit log. The store owner’s account must pass two-factor authentication before it can use the store tools.',
      ],
    },
    {
      heading: 'Keeping it and deleting it',
      paragraphs: [
        'Records stay in the store’s database until they are deleted. Deleting an address removes it from your account, but an order keeps the address it was placed with, because that is what the parcel was sent to.',
        'A published review stays on the product page while the product is sold, unless you or the store remove it.',
        'Nilzora does not yet have a self-service “delete my account” button. If you want your account reviewed or removed, ask the store through Help & support; the answer will tell you what can be removed and what has to be kept for the order records.',
      ],
    },
    {
      heading: 'Your choices',
      paragraphs: ['You can manage most of this yourself:'],
      bullets: [
        'Edit your name, phone number and photo, and add or delete delivery addresses, from your account.',
        'Switch product announcements on or off per device in Settings, without affecting order updates, and delete notifications from your notification list in the Android app.',
        'Sign out, which ends that device’s session and removes its push token from your account.',
        'Save or remove wishlist items at any time.',
        'Ask the store through Help & support to see, correct or remove the information it holds about you.',
      ],
    },
    {
      heading: 'Children',
      paragraphs: [
        'Nilzora is a shopping service intended for customers who can place an order and pay for it on delivery. The store does not run an age check, and it does not knowingly collect information about children.',
      ],
    },
    {
      heading: 'Changes to this policy',
      paragraphs: [
        'When the wording changes, the date at the top of this page changes with it. Read the page again after an update if you want to know what is different.',
      ],
    },
  ],
  related: ['terms', 'faq', 'support'],
};

const TERMS: InfoPage = {
  title: 'Terms of service',
  summary:
    'The rules that apply when you shop with Nilzora on the website or in the Android app: your account, prices and stock, cash on delivery, delivery, cancellation, returns and reviews.',
  notice:
    'These terms describe how the Nilzora store operates today. They are written to be read by customers rather than as legal advice.',
  intro: [
    'By creating an account or placing an order with Nilzora you accept these terms. They apply to the website and to the Android app, which share the same account, catalogue and orders.',
  ],
  sections: [
    {
      heading: 'Your account',
      paragraphs: [
        'You need an account to check out. You can sign in with an email address and password, or with Google if you prefer. Nilzora emails a six-digit code to confirm a new address before it can be used.',
        'Keep your password to yourself, because anything done through your account is treated as done by you. Repeated failed sign-in attempts can lock sign-in for a while, which protects the account. If you think someone else has access, change the password and tell the store.',
        'Your account is for your own use. Do not create accounts to abuse coupons, stock limits or reviews, and do not use another person’s account.',
      ],
    },
    {
      heading: 'Products, prices and availability',
      paragraphs: [
        'Each product page is written and photographed by Nilzora. Colours can look different from screen to screen, and small differences of shade or finish are not a fault.',
        'Prices are shown in Bangladeshi taka. The price, the delivery charge and the total you see at checkout are calculated by the store from its own records, and that total is the one that applies to your order.',
        'Stock is real stock: a product marked as out of stock cannot be ordered, and some products limit how many one order may contain. Availability can change while you browse, so it is confirmed again when you place the order.',
      ],
    },
    {
      heading: 'Your cart and checkout',
      paragraphs: [
        'A cart is only a list of what you are considering. It reserves no stock and holds no price until you place the order.',
        'At checkout you choose a delivery address, see the delivery charge for its district, apply a coupon if you have one, and see the final total before you confirm. When the store accepts the order it is given an order number, appears in your account, and its details are recorded as they were at that moment.',
      ],
    },
    {
      heading: 'Paying cash on delivery',
      paragraphs: [
        'Cash on delivery is the payment method Nilzora offers today. You pay the full total of the order, including the delivery charge, in cash to the person delivering it. No card or mobile-wallet details are collected, and none are stored with your account.',
        'Placing an order is a commitment to accept and pay for it. Please order only what you intend to receive, keep the phone number on the order reachable, and have the cash ready. If a parcel cannot be delivered because the recipient cannot be reached or refuses it, the order may be cancelled.',
        'Each order is checked by the store before it is confirmed, and the store may contact you first. Because orders that are refused cost the store a delivery, the store may decline or cancel orders from an account that repeatedly refuses parcels.',
      ],
    },
    {
      heading: 'Placing, confirming and cancelling an order',
      paragraphs: [
        'An order can be cancelled from your account while it is still pending, with an optional reason. Cancelling also releases the stock it was holding, and a coupon used on a cancelled order can be used again. Once the order moves past pending, it can no longer be cancelled in your account, so contact the store if something has gone wrong.',
        'If the store cannot fulfil an order, it may cancel it and will contact you using the phone number on the order. Nothing is charged, because payment happens on delivery.',
      ],
    },
    {
      heading: 'Delivery',
      paragraphs: [
        'Nilzora delivers to the divisions and districts listed when you add an address. Your district decides the delivery zone, and the store sets the charge for each zone; the exact charge for your address is shown at checkout before you order.',
        'Deliveries go to the recipient, phone number and address you entered. Please keep that phone reachable: the person delivering the parcel needs it to find you. If details are wrong, tell the store as soon as you notice.',
      ],
    },
    {
      heading: 'Returns and refunds',
      paragraphs: [
        'You can ask to return items from a delivered order from the Returns area of your account, within the return window the store sets, choosing the items, how many of each, and a reason. The store then decides on the request, records the items when they arrive, and completes the return. The Returns and refunds policy explains each step.',
        'A refund can only cover the cash collected for the units you send back. It is recorded against the return and paid the way the store agrees with you. Ask the store through Help & support if you are unsure whether an item can be returned, or what has happened to a refund.',
      ],
    },
    {
      heading: 'Reviews and other content you post',
      paragraphs: [
        'Reviews are open to customers who received the product: one review per product, with a rating and text and, optionally, up to four photos. A review is published when you post it, and the store may take down a review that is not about the product or that breaks the rules below.',
        'Write about your own experience with the product. Do not post someone else’s words or photos, personal details about another person, or content that is unlawful, hateful or misleading.',
        'When you publish a review or upload photos, you give Nilzora permission to show them on the product page and in the app for as long as the review is published. You keep ownership of what you wrote.',
      ],
    },
    {
      heading: 'Using the store fairly',
      paragraphs: [
        'Use the store for shopping. Do not attempt to break or probe its security, scrape it, place orders you do not intend to accept, interfere with stock or reviews, or use it to harm someone else.',
        'The store may refuse or cancel an order, or suspend an account, when it has a clear reason to believe it is being misused.',
      ],
    },
    {
      heading: 'The Nilzora brand and this website',
      paragraphs: [
        'The Nilzora name, its logo, the look of the store and the text Nilzora writes are the store’s brand assets. Product photos and descriptions are provided by Nilzora for shopping on Nilzora. Please do not copy or reuse them elsewhere without permission.',
      ],
    },
    {
      heading: 'When the service is unavailable',
      paragraphs: [
        'The store depends on networks, hosting and delivery, so it can be unavailable for a while: during maintenance, after a fault, or when a connection drops. When that happens, the store fixes it as soon as it can. An order is only placed when the store has confirmed it, so a failed attempt leaves nothing behind.',
      ],
    },
    {
      heading: 'Changes to these terms',
      paragraphs: [
        'These terms will change as the store does — for example when a new payment method or delivery option arrives. The date at the top of the page shows when the wording last changed, and the terms in force when you place an order are the ones that apply to it.',
      ],
    },
  ],
  related: ['privacy', 'faq', 'support'],
};

/*
 * The returns and delivery policies. Like the others, they describe only what the store does:
 * no refund deadline, delivery time or service area is written here, because those are the
 * owner's to set (the return window is a store setting; delivery charges are per zone). When the
 * owner publishes their own page in the admin workspace, it replaces this text.
 */
const RETURNS: InfoPage = {
  title: 'Returns and refunds policy',
  summary:
    'How to return items from a delivered order, what happens at each step, and how refunds of cash-on-delivery payments work.',
  notice:
    'This policy describes how returns work in the Nilzora store today. It is written for customers rather than as legal advice.',
  intro: [
    'If something you received is not right, you can ask to return it from your account. Every request is looked at by a person, and you can follow it in your account from start to finish.',
  ],
  sections: [
    {
      heading: 'What can be returned',
      paragraphs: [
        'Items from an order that has been delivered can be returned within the return window the store sets. Your order page shows whether the order can still be returned, so you never need to work the dates out yourself.',
        'You choose which items to return and how many of each, up to the quantity you received, and give a reason. A description and photos help the store understand the problem.',
      ],
    },
    {
      heading: 'How a return works',
      paragraphs: [
        'Each request moves through the same steps, and its status is shown in your account:',
      ],
      bullets: [
        'Requested: the store has your request and will look at it.',
        'Approved or rejected: the store decides on the request and tells you why if it cannot accept it.',
        'Received: the items have arrived back with the store and have been checked.',
        'Completed: the return is finished, and any refund is recorded against it.',
        'You can cancel a request yourself while it is still waiting for a decision.',
      ],
    },
    {
      heading: 'Refunds',
      paragraphs: [
        'Because you paid in cash on delivery, a refund can only cover cash the store actually collected for the units you return. The delivery charge is refunded only when the store agrees that it should be.',
        'Refunds are requested, approved and completed by the store, and each step is recorded against your return. The store agrees the refund method with you. Ask through Help & support if you are unsure what has happened to a refund.',
      ],
    },
    {
      heading: 'Wrong, damaged or missing items',
      paragraphs: [
        'If a parcel arrives damaged, or something is wrong or missing, please tell the store as soon as you can through Help & support or by starting a return, with photos if possible. It is much easier to put right when it is reported early.',
      ],
    },
  ],
  related: ['terms', 'shipping', 'support'],
};

const SHIPPING: InfoPage = {
  title: 'Delivery policy',
  summary:
    'Where Nilzora delivers, how the delivery charge is worked out, how to follow your order, and what to do if a delivery goes wrong.',
  notice:
    'This policy describes how delivery works in the Nilzora store today. It is written for customers rather than as legal advice.',
  intro: [
    'Nilzora delivers in Bangladesh, and you pay for your order in cash when it arrives. The charge for your address is always shown at checkout before you place the order.',
  ],
  sections: [
    {
      heading: 'Where we deliver and what it costs',
      paragraphs: [
        'You can deliver to any division and district offered when you add an address. Your district decides the delivery zone (inside or outside Dhaka), and the store sets the charge for each zone.',
        'The charge for your address is calculated by the store and shown at checkout, together with any free-delivery coupon that applies. That is the charge you pay.',
      ],
    },
    {
      heading: 'Following your order',
      paragraphs: ['Your order shows its status in your account and in the Android app:'],
      bullets: [
        'Pending: the order is placed and waiting for the store to check and confirm it. You can still cancel it yourself.',
        'Confirmed and processing: the store is preparing your parcel.',
        'Shipped: the parcel is with the courier. Where the courier provides tracking, it appears on your order.',
        'Delivered: the parcel was handed over and the cash collected.',
      ],
    },
    {
      heading: 'Delivery times',
      paragraphs: [
        'How long delivery takes depends on your area and the courier. The store does not promise a fixed delivery date on this page; if your order is taking longer than you expected, ask through Help & support and the store will check with the courier.',
      ],
    },
    {
      heading: 'At the door',
      paragraphs: [
        'The parcel goes to the recipient, phone number and address on the order. Keep that phone reachable, because the courier may call to find you, and have the full order total ready in cash.',
        'If the recipient cannot be reached or the parcel is refused, the courier may return it to the store and the order may be cancelled.',
      ],
    },
    {
      heading: 'If something goes wrong',
      paragraphs: [
        'If the address or phone number on an order is wrong, tell the store straight away through Help & support. If a parcel arrives damaged or incomplete, report it as described in the Returns and refunds policy.',
      ],
    },
  ],
  related: ['returns', 'terms', 'support'],
};

/** The editorial pages, keyed by the slug the storefront and the app use. */
export const INFO_PAGES = {
  about: ABOUT,
  privacy: PRIVACY,
  terms: TERMS,
  returns: RETURNS,
  shipping: SHIPPING,
} as const;

/**
 * Bangladesh-specific points a qualified local lawyer must review before launch. They are not
 * shown to customers: they record what this wording deliberately does NOT claim.
 */
export const LEGAL_REVIEW_ITEMS = [
  'Digital Commerce Operation Guidelines 2021 (Ministry of Commerce): whether they require stated delivery and refund timelines, seller identity details (trade licence, registration) or other disclosures on these pages.',
  'Consumer Rights Protection Act 2009: whether the returns and refunds wording meets its requirements for defective or misdescribed goods.',
  'Personal data protection: the current status of Bangladesh personal data protection legislation, and whether it requires a named contact, consent records, data-subject request timelines or data-localisation statements.',
  'Business identity on the site: trade licence, VAT/e-BIN and any Digital Business Identity (DBID) registration the store must display.',
  'Cash-on-delivery terms: whether declining orders from accounts that repeatedly refuse parcels needs further notice or wording.',
  'Whether a notice-style agreement at sign-up and checkout is sufficient, or an explicit opt-in checkbox is required.',
] as const;

export type InfoPageSlug = keyof typeof INFO_PAGES;

export const INFO_PAGE_SLUGS = [
  'about',
  'privacy',
  'terms',
  'returns',
  'shipping',
] as const satisfies readonly InfoPageSlug[];

/** The page for a slug, or undefined when the slug is not one of the three. */
export function infoPage(slug: string): InfoPage | undefined {
  return Object.hasOwn(INFO_PAGES, slug) ? INFO_PAGES[slug as InfoPageSlug] : undefined;
}

/**
 * A heading that is stable as an anchor and readable as a fragment: lower case, words joined
 * by hyphens, punctuation dropped. Used by the website's list of sections and by the app's, so
 * both point at the same place.
 */
export function sectionAnchor(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}
