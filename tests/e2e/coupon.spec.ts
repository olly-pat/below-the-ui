import { signIn } from '../pages/shop.ts';
import { expect, test } from '../support/fixtures.ts';

// Carts picked for their rounding, not for their realism.
const CARTS = [
  { name: 'notebook and pens', lines: { 'NB-A5': 1, 'PEN-3': 1 } },
  { name: 'three mugs', lines: { 'MUG-W': 3 } },
  { name: 'tote and stickers', lines: { TOTE: 1, 'STK-10': 2 } },
  { name: 'two notebooks, pens and a mug', lines: { 'NB-A5': 2, 'PEN-3': 1, 'MUG-W': 1 } },
];

test.describe('coupon totals', () => {
  for (const { name, lines } of CARTS) {
    test(`${name}: the discounted total shown is the total charged`, async ({ page, catalog, cart, stored }) => {
      await signIn(page, 'alice');
      await catalog.open();
      for (const [sku, qty] of Object.entries(lines)) await catalog.add(sku, qty);
      await cart.open();
      await cart.applyCoupon('SAVE15');
      await expect(page.getByTestId('cart-discount')).not.toHaveText('$0.00');
      const shownTotal = await cart.shownTotalCents();

      const orderId = await cart.placeOrder();

      const row = await stored.order(orderId);
      expect(row?.coupon).toBe('SAVE15');
      expect(row?.totalCents, 'the customer was shown one total and charged another').toBe(shownTotal);
    });
  }

  test('an unknown coupon is refused before checkout', async ({ page, catalog, cart }) => {
    await signIn(page, 'alice');
    await catalog.open();
    await catalog.add('PEN-3', 1);
    await cart.open();
    await cart.applyCoupon('FREE100');
    await expect(page.getByTestId('coupon-error')).toHaveText('Unknown coupon');
    await expect(page.getByTestId('cart-discount')).toHaveText('$0.00');
  });
});
