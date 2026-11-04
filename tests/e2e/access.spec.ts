import { signIn } from '../pages/shop.ts';
import { expect, test } from '../support/fixtures.ts';

test.describe('access to orders', () => {
  test('a customer who guesses another order id sees nothing', async ({ page, orders, apiAs }) => {
    const alice = apiAs('alice');
    const mug = await alice.productBySku('MUG-W');
    const aliceOrder = await alice.placeOrder({ items: [{ productId: mug.id, qty: 1 }] });

    await signIn(page, 'bob');
    await orders.open();
    await expect(orders.row(aliceOrder.id)).toHaveCount(0);

    // Bob has no link to it. Try the URL anyway.
    await orders.openOrder(aliceOrder.id);
    await expect(orders.notFound).toBeVisible();
    await expect(page.getByTestId('order-detail')).toHaveCount(0);
  });

  test('an admin can open any customer order', async ({ page, orders, apiAs }) => {
    const alice = apiAs('alice');
    const pens = await alice.productBySku('PEN-3');
    const aliceOrder = await alice.placeOrder({ items: [{ productId: pens.id, qty: 2 }] });

    await signIn(page, 'admin');
    await orders.openOrder(aliceOrder.id);
    await expect(page.getByTestId('order-total')).toHaveText('$17.00');
  });

  test('signing out clears the session', async ({ page, catalog }) => {
    await signIn(page, 'bob');
    await catalog.open();
    await page.getByTestId('sign-out').click();
    await expect(page.getByTestId('login-bob')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull();
  });
});
