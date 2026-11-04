import { test as base } from '@playwright/test';
import { CartPage, CatalogPage, OrdersPage } from '../pages/shop.ts';
import { ShopApi, StoredState, type Account } from './api.ts';

type Fixtures = {
  apiAs: (account: Account) => ShopApi;
  stored: StoredState;
  catalog: CatalogPage;
  cart: CartPage;
  orders: OrdersPage;
};

export const test = base.extend<Fixtures>({
  apiAs: async ({ request }, use) => {
    await use((account) => new ShopApi(request, account));
  },
  stored: async ({ request }, use) => {
    await use(new StoredState(request));
  },
  catalog: async ({ page }, use) => {
    await use(new CatalogPage(page));
  },
  cart: async ({ page }, use) => {
    await use(new CartPage(page));
  },
  orders: async ({ page }, use) => {
    await use(new OrdersPage(page));
  },
});

export { expect } from '@playwright/test';
