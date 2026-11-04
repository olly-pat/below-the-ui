import type { Db } from './db.ts';
import type { Fault } from './faults.ts';

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type User = { id: number; name: string; role: 'customer' | 'admin' };

export type OrderItemInput = { productId: number; qty: number };

export type Order = {
  id: number;
  userName: string;
  status: 'pending' | 'confirmed';
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  coupon: string | null;
  createdAt: string;
  items: { productId: number; sku: string; name: string; qty: number; priceCents: number }[];
};

export const COUPONS: Record<string, number> = { SAVE15: 15 };

export function priceOrder(lines: { priceCents: number; qty: number }[], coupon: string | null) {
  const subtotal = lines.reduce((sum, line) => sum + line.priceCents * line.qty, 0);
  const percent = coupon === null ? 0 : COUPONS[coupon];
  if (percent === undefined) throw new HttpError(400, `unknown coupon ${coupon}`);
  const discount = Math.round((subtotal * percent) / 100);
  return { subtotal, discount, total: subtotal - discount };
}

export function parseOrderInput(body: unknown): { items: OrderItemInput[]; coupon: string | null } {
  if (typeof body !== 'object' || body === null) throw new HttpError(400, 'body must be a JSON object');
  const { items, coupon } = body as { items?: unknown; coupon?: unknown };
  if (!Array.isArray(items) || items.length === 0 || items.length > 20) {
    throw new HttpError(400, 'items must be an array of 1 to 20 lines');
  }
  const parsed = items.map((item: unknown) => {
    const { productId, qty } = (item ?? {}) as { productId?: unknown; qty?: unknown };
    if (!Number.isInteger(productId)) throw new HttpError(400, 'productId must be an integer');
    if (!Number.isInteger(qty) || (qty as number) < 1 || (qty as number) > 99) {
      throw new HttpError(400, 'qty must be an integer from 1 to 99');
    }
    return { productId: productId as number, qty: qty as number };
  });
  if (coupon !== undefined && coupon !== null && typeof coupon !== 'string') {
    throw new HttpError(400, 'coupon must be a string');
  }
  const code = typeof coupon === 'string' && coupon.trim() ? coupon.trim().toUpperCase() : null;
  return { items: parsed, coupon: code };
}

export function loadOrder(db: Db, id: number): Order | undefined {
  const row = db
    .prepare(
      `SELECT o.*, u.name AS user_name FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = ?`,
    )
    .get(id) as Record<string, string | number | null> | undefined;
  if (!row) return undefined;
  const items = db
    .prepare(
      `SELECT i.product_id, p.sku, p.name, i.qty, i.price_cents
       FROM order_items i JOIN products p ON p.id = i.product_id
       WHERE i.order_id = ? ORDER BY i.rowid`,
    )
    .all(id) as Record<string, string | number>[];
  return {
    id: Number(row.id),
    userName: String(row.user_name),
    status: row.status as Order['status'],
    subtotalCents: Number(row.subtotal_cents),
    discountCents: Number(row.discount_cents),
    totalCents: Number(row.total_cents),
    coupon: row.coupon === null ? null : String(row.coupon),
    createdAt: String(row.created_at),
    items: items.map((item) => ({
      productId: Number(item.product_id),
      sku: String(item.sku),
      name: String(item.name),
      qty: Number(item.qty),
      priceCents: Number(item.price_cents),
    })),
  };
}

export function createOrder(
  db: Db,
  faults: Set<Fault>,
  user: User,
  input: { items: OrderItemInput[]; coupon: string | null },
  idempotencyKey: string | null,
): { order: Order; created: boolean } {
  const key = faults.has('double_submit') ? null : idempotencyKey;
  if (key !== null) {
    const existing = db
      .prepare('SELECT id FROM orders WHERE user_id = ? AND idempotency_key = ?')
      .get(user.id, key) as { id: number } | undefined;
    if (existing) return { order: loadOrder(db, existing.id)!, created: false };
  }

  const findProduct = db.prepare('SELECT id, price_cents FROM products WHERE id = ?');
  const lines = input.items.map((item) => {
    const product = findProduct.get(item.productId) as { id: number; price_cents: number } | undefined;
    if (!product) throw new HttpError(400, `unknown product ${item.productId}`);
    return { productId: product.id, qty: item.qty, priceCents: product.price_cents };
  });
  const price = priceOrder(lines, input.coupon);

  db.exec('BEGIN');
  try {
    const result = db
      .prepare(
        `INSERT INTO orders (user_id, status, subtotal_cents, discount_cents, total_cents, coupon, idempotency_key, created_at)
         VALUES (?, 'pending', ?, ?, ?, ?, ?, ?)`,
      )
      .run(user.id, price.subtotal, price.discount, price.total, input.coupon, key, new Date().toISOString());
    const orderId = Number(result.lastInsertRowid);
    const addItem = db.prepare('INSERT INTO order_items (order_id, product_id, qty, price_cents) VALUES (?, ?, ?, ?)');
    for (const line of lines) addItem.run(orderId, line.productId, line.qty, line.priceCents);
    if (!faults.has('lost_event')) {
      db.prepare(`INSERT INTO events (order_id, type) VALUES (?, 'order.created')`).run(orderId);
    }
    const order = loadOrder(db, orderId)!;
    db.exec(faults.has('ghost_success') ? 'ROLLBACK' : 'COMMIT');
    return { order, created: true };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function canRead(faults: Set<Fault>, user: User, order: Order): boolean {
  if (faults.has('order_leak')) return true;
  return user.role === 'admin' || order.userName === user.name;
}

// Confirms orders with an unprocessed event. With an order id, only that order,
// so parallel tests do not confirm each other's orders.
export function runWorker(db: Db, orderId: number | null): number {
  const pending = 'SELECT id, order_id FROM events WHERE processed_at IS NULL';
  const events = (
    orderId === null
      ? db.prepare(`${pending} ORDER BY id`).all()
      : db.prepare(`${pending} AND order_id = ? ORDER BY id`).all(orderId)
  ) as { id: number; order_id: number }[];
  const confirm = db.prepare(`UPDATE orders SET status = 'confirmed' WHERE id = ? AND status = 'pending'`);
  const markDone = db.prepare('UPDATE events SET processed_at = ? WHERE id = ?');
  for (const event of events) {
    confirm.run(event.order_id);
    markDone.run(new Date().toISOString(), event.id);
  }
  return events.length;
}
