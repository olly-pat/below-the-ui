import { randomUUID } from 'node:crypto';
import { expect, test } from '../support/fixtures.ts';

test.describe('orders API', () => {
  test('an order is stored exactly as the API reported it', async ({ apiAs, stored }) => {
    const alice = apiAs('alice');
    const mug = await alice.productBySku('MUG-W');
    const pens = await alice.productBySku('PEN-3');

    const reported = await alice.placeOrder({
      items: [
        { productId: mug.id, qty: 2 },
        { productId: pens.id, qty: 1 },
      ],
    });

    const row = await stored.order(reported.id);
    expect(row, 'the API returned an order id that has no row behind it').not.toBeNull();
    expect(row).toMatchObject({
      userName: 'alice',
      status: 'pending',
      totalCents: 2 * mug.priceCents + pens.priceCents,
      items: [
        { sku: 'MUG-W', qty: 2, priceCents: mug.priceCents },
        { sku: 'PEN-3', qty: 1, priceCents: pens.priceCents },
      ],
    });
  });

  test('a retried request with the same idempotency key creates one order', async ({ apiAs, stored }) => {
    const alice = apiAs('alice');
    const tote = await alice.productBySku('TOTE');
    const key = randomUUID();
    const body = { items: [{ productId: tote.id, qty: 1 }] };

    const first = await alice.placeOrderRaw(body, key);
    const retry = await alice.placeOrderRaw(body, key);

    expect(first.status()).toBe(201);
    expect(retry.status(), 'a retry must return the existing order, not create one').toBe(200);
    expect((await stored.ordersWithKey('alice', key)).map((row) => row.id)).toEqual([(await first.json()).id]);
  });

  test('a customer cannot read another customer order, an admin can', async ({ apiAs }) => {
    const alice = apiAs('alice');
    const notebook = await alice.productBySku('NB-A5');
    const order = await alice.placeOrder({ items: [{ productId: notebook.id, qty: 1 }] });

    expect((await apiAs('bob').getOrderRaw(order.id)).status()).toBe(404);
    expect((await apiAs('admin').getOrderRaw(order.id)).status()).toBe(200);
    expect((await apiAs('bob').orders()).map((o) => o.id)).not.toContain(order.id);
  });

  test('the worker confirms a new order through its outbox event', async ({ apiAs, stored }) => {
    const alice = apiAs('alice');
    const stickers = await alice.productBySku('STK-10');
    const order = await alice.placeOrder({ items: [{ productId: stickers.id, qty: 3 }] });

    expect((await stored.order(order.id))?.events, 'no event was written for the new order').toEqual([
      { type: 'order.created', processedAt: null },
    ]);

    await alice.runWorker(order.id);

    const confirmed = await (await alice.getOrderRaw(order.id)).json();
    expect(confirmed.status).toBe('confirmed');
  });

  test('the coupon is applied once, to the whole order', async ({ apiAs, stored }) => {
    const alice = apiAs('alice');
    const notebook = await alice.productBySku('NB-A5');
    const pens = await alice.productBySku('PEN-3');
    const order = await alice.placeOrder({
      items: [
        { productId: notebook.id, qty: 1 },
        { productId: pens.id, qty: 1 },
      ],
      coupon: 'save15',
    });

    // 15% of $21.00 is $3.15. Rounding per line would give $3.16.
    expect(await stored.order(order.id)).toMatchObject({ coupon: 'SAVE15', discountCents: 315, totalCents: 1785 });
  });

  test.describe('rejects bad input', () => {
    const cases = [
      { name: 'an empty cart', body: { items: [] } },
      { name: 'a zero quantity', body: { items: [{ productId: 1, qty: 0 }] } },
      { name: 'a fractional quantity', body: { items: [{ productId: 1, qty: 1.5 }] } },
      { name: 'an unknown product', body: { items: [{ productId: 9999, qty: 1 }] } },
      { name: 'an unknown coupon', body: { items: [{ productId: 1, qty: 1 }], coupon: 'FREE100' } },
      { name: 'a body that is not an object', body: 'not json' },
    ];
    for (const { name, body } of cases) {
      test(name, async ({ apiAs, stored }) => {
        const before = await stored.orderIds('bob');
        const response = await apiAs('bob').placeOrderRaw(body);
        expect(response.status()).toBe(400);
        expect(await stored.orderIds('bob')).toEqual(before);
      });
    }

    test('a request without a token', async ({ request }) => {
      const response = await request.post('/api/orders', { data: { items: [{ productId: 1, qty: 1 }] } });
      expect(response.status()).toBe(401);
    });
  });
});
