import { signIn } from '../pages/shop.ts';
import { expect, test } from '../support/fixtures.ts';

test.describe('checkout', () => {
  test('the order the customer saw is the order that was stored', async ({ page, catalog, cart, stored }) => {
    await signIn(page, 'alice');
    await catalog.open();
    await catalog.add('NB-A5', 2);
    await catalog.add('MUG-W', 1);
    await cart.open();
    const shownTotal = await cart.shownTotalCents();

    const orderId = await cart.placeOrder();

    const row = await stored.order(orderId);
    expect(row, `the UI confirmed order #${orderId} but there is no such row`).not.toBeNull();
    expect(row).toMatchObject({
      userName: 'alice',
      totalCents: shownTotal,
      items: [
        { sku: 'NB-A5', qty: 2 },
        { sku: 'MUG-W', qty: 1 },
      ],
    });
    await expect(page.getByTestId('nav-cart')).toHaveText('Cart (0)');
  });

  test('a timeout after the order was saved does not charge twice on retry', async ({ page, catalog, cart, stored }) => {
    // Only this test uses carol, so counting her orders is safe in parallel.
    const before = await stored.orderIds('carol');
    let dropped = false;
    await page.route('**/api/orders', async (route) => {
      if (route.request().method() !== 'POST' || dropped) return route.continue();
      dropped = true;
      // The server saves the order, the browser never gets the response.
      await route.fetch();
      await route.abort('timedout');
    });

    await signIn(page, 'carol');
    await catalog.open();
    await catalog.add('TOTE', 1);
    await cart.open();
    await cart.placeOrderButton.click();
    await expect(page.getByTestId('checkout-error')).not.toBeEmpty();

    await cart.placeOrderButton.click();
    const orderId = await cart.confirmedOrderId();

    const newOrders = (await stored.orderIds('carol')).filter((id) => !before.includes(id));
    expect(newOrders, 'the retry created a second order').toEqual([orderId]);
  });

  test('a new order shows as pending until the worker confirms it', async ({ page, catalog, cart, orders, apiAs }) => {
    await signIn(page, 'alice');
    await catalog.open();
    await catalog.add('STK-10', 2);
    await cart.open();
    const orderId = await cart.placeOrder();

    await orders.open();
    await expect(orders.row(orderId).getByTestId('status')).toHaveText('Pending');

    await apiAs('alice').runWorker(orderId);

    await orders.openOrder(orderId);
    await expect(orders.detailStatus, 'the order is still pending, check its outbox event').toHaveText(
      'Confirmed',
    );
  });
});
