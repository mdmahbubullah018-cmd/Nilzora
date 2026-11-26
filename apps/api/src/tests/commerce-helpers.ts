import { apiErrorBodySchema } from '@nilzora/contracts';
import { FakeCommerce } from './commerce-fakes';
import { FakeIdentity } from './fakes';
import { testApp } from './helpers';

/** A valid delivery address in Dhaka (inside_dhaka), as a customer would type it. */
export const DHAKA_ADDRESS = {
  recipientName: 'Rahima Khatun',
  phone: '01712-345678',
  division: 'Dhaka',
  district: 'Dhaka',
  area: 'Dhanmondi',
  addressLine: 'House 12, Road 5',
};

/** A valid delivery address outside Dhaka. */
export const KHULNA_ADDRESS = {
  recipientName: 'Karim Ahmed',
  phone: '+8801812345678',
  division: 'Khulna',
  district: 'Khulna',
  area: 'Sonadanga',
  addressLine: 'House 5, Road 2',
  postalCode: '9100',
  landmark: 'Near the bus stand',
  label: 'Home',
};

export function errorOf(body: unknown) {
  return apiErrorBodySchema.parse(body).error;
}

/**
 * A small store: one open category with a featured lamp (low stock, order limit 3),
 * a mug with one unit left, a well-stocked pen and a sold-out plate; plus a draft
 * product and an active product in a hidden category, which must never be visible.
 */
export function commerceSetup(env: Record<string, string> = {}) {
  const identity = new FakeIdentity();
  const commerce = new FakeCommerce(identity);
  const customer = identity.addUser({ email: 'rahima@example.com' });
  const other = identity.addUser({ email: 'karim@example.com' });
  const suspended = identity.addUser({ email: 'held@example.com', status: 'suspended' });

  const kitchen = commerce.addCategory({
    slug: 'home-kitchen',
    name: 'Home & Kitchen',
    description: 'Everyday home essentials.',
  });
  const seasonal = commerce.addCategory({ slug: 'seasonal', name: 'Seasonal', isActive: false });
  const products = {
    lamp: commerce.addProduct({
      slug: 'desk-lamp',
      name: 'Desk Lamp',
      summary: 'A warm reading light.',
      categoryId: kitchen.id,
      priceMinor: 10_000,
      compareAtPriceMinor: 12_000,
      stock: 5,
      maxOrderQuantity: 3,
      isFeatured: true,
    }),
    mug: commerce.addProduct({
      slug: 'ceramic-mug',
      name: 'Ceramic Mug',
      categoryId: kitchen.id,
      priceMinor: 2_500,
      stock: 1,
    }),
    pen: commerce.addProduct({
      slug: 'gel-pen',
      name: 'Gel Pen',
      description: 'Smooth blue ink.',
      categoryId: kitchen.id,
      priceMinor: 1_000,
      stock: 100,
    }),
    plate: commerce.addProduct({
      slug: 'dinner-plate',
      name: 'Dinner Plate',
      categoryId: kitchen.id,
      priceMinor: 3_000,
      stock: 0,
      maxOrderQuantity: 4,
    }),
    draft: commerce.addProduct({
      slug: 'smart-watch',
      name: 'Smart Watch',
      categoryId: kitchen.id,
      priceMinor: 99_000,
      status: 'draft',
    }),
    lantern: commerce.addProduct({
      slug: 'paper-lantern',
      name: 'Paper Lantern',
      categoryId: seasonal.id,
      priceMinor: 2_000,
    }),
  };

  return {
    identity,
    commerce,
    customer,
    other,
    suspended,
    products,
    tokens: {
      customer: identity.tokenFor(customer),
      other: identity.tokenFor(other),
      suspended: identity.tokenFor(suspended),
    },
    app: testApp({ auth: identity.deps, commerce: commerce.stores, env }),
  };
}
