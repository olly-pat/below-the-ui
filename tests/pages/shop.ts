import { expect, type Locator, type Page } from '@playwright/test';
import { ACCOUNTS, type Account } from '../support/api.ts';

export async function signIn(page: Page, account: Account) {
  await page.addInitScript((token) => localStorage.setItem('token', token), ACCOUNTS[account]);
}

export class CatalogPage {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async open() {
    await this.page.goto('/#/catalog');
    await expect(this.page.getByRole('heading', { name: 'Catalog' })).toBeVisible();
  }

  async add(sku: string, qty = 1) {
    const row = this.page.getByTestId(`product-${sku}`);
    await row.getByTestId('qty').fill(String(qty));
    await row.getByTestId('add').click();
  }
}

export class CartPage {
  private readonly page: Page;
  readonly total: Locator;
  readonly placeOrderButton: Locator;
  readonly confirmation: Locator;

  constructor(page: Page) {
    this.page = page;
    this.total = page.getByTestId('cart-total');
    this.placeOrderButton = page.getByTestId('place-order');
    this.confirmation = page.getByTestId('order-confirmation');
  }

  async open() {
    await this.page.goto('/#/cart');
    await expect(this.page.getByRole('heading', { name: 'Cart' })).toBeVisible();
  }

  async applyCoupon(code: string) {
    await this.page.getByTestId('coupon').fill(code);
    await this.page.getByTestId('apply-coupon').click();
  }

  // The total the customer agreed to, in cents.
  async shownTotalCents(): Promise<number> {
    return parseMoney(await this.total.innerText());
  }

  async placeOrder(): Promise<number> {
    await this.placeOrderButton.click();
    return this.confirmedOrderId();
  }

  async confirmedOrderId(): Promise<number> {
    await expect(this.confirmation).toBeVisible();
    return Number(await this.confirmation.getAttribute('data-order-id'));
  }
}

export class OrdersPage {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async open() {
    await this.page.goto('/#/orders');
    await expect(this.page.getByRole('heading', { name: 'Orders' })).toBeVisible();
  }

  row(orderId: number): Locator {
    return this.page.getByTestId(`order-row-${orderId}`);
  }

  async openOrder(orderId: number) {
    await this.page.goto(`/#/orders/${orderId}`);
  }

  get detailStatus(): Locator {
    return this.page.getByTestId('order-status');
  }

  get notFound(): Locator {
    return this.page.getByTestId('not-found');
  }
}

export function parseMoney(text: string): number {
  const match = /^\$(\d+)\.(\d{2})$/.exec(text.trim());
  if (!match) throw new Error(`not a money amount: "${text}"`);
  return Number(match[1]) * 100 + Number(match[2]);
}
