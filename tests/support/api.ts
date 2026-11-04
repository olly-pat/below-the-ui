import { expect, type APIRequestContext, type APIResponse } from '@playwright/test';

export const ACCOUNTS = {
  alice: 'alice-token',
  bob: 'bob-token',
  carol: 'carol-token',
  admin: 'admin-token',
} as const;

export type Account = keyof typeof ACCOUNTS;

export type Order = {
  id: number;
  userName: string;
  status: 'pending' | 'confirmed';
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  coupon: string | null;
  items: { productId: number; sku: string; name: string; qty: number; priceCents: number }[];
};

export type StoredOrder = Order & { events: { type: string; processedAt: string | null }[] };

export type Product = { id: number; sku: string; name: string; priceCents: number };

export type OrderRequest = { items: { productId: number; qty: number }[]; coupon?: string | null };

export class ShopApi {
  private readonly request: APIRequestContext;
  private readonly headers: Record<string, string>;

  constructor(request: APIRequestContext, account: Account) {
    this.request = request;
    this.headers = { authorization: `Bearer ${ACCOUNTS[account]}` };
  }

  async products(): Promise<Product[]> {
    return json(await this.request.get('/api/products'));
  }

  async productBySku(sku: string): Promise<Product> {
    const product = (await this.products()).find((p) => p.sku === sku);
    if (!product) throw new Error(`no product with sku ${sku}`);
    return product;
  }

  placeOrderRaw(body: unknown, idempotencyKey?: string): Promise<APIResponse> {
    const headers = idempotencyKey ? { ...this.headers, 'idempotency-key': idempotencyKey } : this.headers;
    return this.request.post('/api/orders', { headers, data: body });
  }

  async placeOrder(body: OrderRequest, idempotencyKey?: string): Promise<Order> {
    const response = await this.placeOrderRaw(body, idempotencyKey);
    expect(response.status(), await response.text()).toBe(201);
    return response.json();
  }

  getOrderRaw(id: number): Promise<APIResponse> {
    return this.request.get(`/api/orders/${id}`, { headers: this.headers });
  }

  async orders(): Promise<Order[]> {
    return json(await this.request.get('/api/orders', { headers: this.headers }));
  }

  async runWorker(orderId: number): Promise<number> {
    return (await json<{ processed: number }>(await this.request.post(`/_worker/run?order=${orderId}`))).processed;
  }
}

// Stored rows, through the test hooks.
export class StoredState {
  private readonly request: APIRequestContext;

  constructor(request: APIRequestContext) {
    this.request = request;
  }

  async order(id: number): Promise<StoredOrder | null> {
    const response = await this.request.get(`/_test/db/orders/${id}`);
    if (response.status() === 404) return null;
    return json(response);
  }

  async orderIds(account: Account): Promise<number[]> {
    return (await this.rows(account)).map((row) => row.id);
  }

  async ordersWithKey(account: Account, idempotencyKey: string): Promise<{ id: number }[]> {
    return (await this.rows(account)).filter((row) => row.idempotencyKey === idempotencyKey);
  }

  private async rows(account: Account): Promise<{ id: number; idempotencyKey: string | null }[]> {
    return json(await this.request.get(`/_test/db/orders?user=${account}`));
  }
}

async function json<T>(response: APIResponse): Promise<T> {
  expect(response.ok(), `${response.url()} answered ${response.status()}: ${await response.text()}`).toBe(true);
  return response.json();
}
