const FAULTS = new Set(window.FAULTS ?? []);
const COUPONS = { SAVE15: 15 };
const ACCOUNTS = [
  { name: 'alice', label: 'Alice', token: 'alice-token' },
  { name: 'bob', label: 'Bob', token: 'bob-token' },
  { name: 'carol', label: 'Carol', token: 'carol-token' },
  { name: 'admin', label: 'Admin', token: 'admin-token' },
];

const app = document.getElementById('app');
const nav = document.getElementById('nav');
const state = { products: [], me: null, lastOrder: null };

const money = (cents) => `$${(cents / 100).toFixed(2)}`;
const escape = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const store = {
  get: (key, fallback) => JSON.parse(sessionStorage.getItem(key) ?? 'null') ?? fallback,
  set: (key, value) => sessionStorage.setItem(key, JSON.stringify(value)),
  drop: (key) => sessionStorage.removeItem(key),
};

async function api(path, options = {}) {
  const token = localStorage.getItem('token');
  const response = await fetch(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(body?.error ?? response.statusText), { status: response.status });
  return body;
}

// Same rule as server/orders.ts priceOrder. Duplicated on purpose, see total_drift.
function cartTotals(lines, coupon) {
  const percent = COUPONS[coupon] ?? 0;
  const subtotal = lines.reduce((sum, line) => sum + line.priceCents * line.qty, 0);
  const discount = FAULTS.has('total_drift')
    ? lines.reduce((sum, line) => sum + Math.round((line.priceCents * line.qty * percent) / 100), 0)
    : Math.round((subtotal * percent) / 100);
  return { subtotal, discount, total: subtotal - discount };
}

function cartLines() {
  const cart = store.get('cart', {});
  return state.products
    .filter((product) => cart[product.id])
    .map((product) => ({ ...product, qty: cart[product.id] }));
}

function renderNav() {
  if (!state.me) {
    nav.innerHTML = '';
    return;
  }
  const count = Object.values(store.get('cart', {})).reduce((sum, qty) => sum + qty, 0);
  nav.innerHTML = `
    <a href="#/catalog">Catalog</a>
    <a href="#/cart" data-testid="nav-cart">Cart (${count})</a>
    <a href="#/orders">Orders</a>
    <span class="muted" data-testid="signed-in-as">${escape(state.me.name)}</span>
    <button class="secondary" data-testid="sign-out">Sign out</button>`;
  nav.querySelector('[data-testid=sign-out]').onclick = () => {
    localStorage.removeItem('token');
    sessionStorage.clear();
    state.me = null;
    location.hash = '#/login';
  };
}

function viewLogin() {
  app.innerHTML = `<section><h1>Sign in</h1><div class="row">${ACCOUNTS.map(
    (account) => `<button data-testid="login-${account.name}" data-token="${account.token}">${account.label}</button>`,
  ).join('')}</div></section>`;
  for (const button of app.querySelectorAll('button')) {
    button.onclick = () => {
      localStorage.setItem('token', button.dataset.token);
      location.hash = '#/catalog';
    };
  }
}

function viewCatalog() {
  app.innerHTML = `<section><h1>Catalog</h1><table>
    <tr><th>Item</th><th class="num">Price</th><th>Qty</th><th></th></tr>
    ${state.products
      .map(
        (product) => `<tr data-testid="product-${escape(product.sku)}">
          <td>${escape(product.name)}</td><td class="num">${money(product.priceCents)}</td>
          <td><input type="number" min="1" max="99" value="1" data-testid="qty" /></td>
          <td><button data-testid="add" data-id="${product.id}">Add</button></td></tr>`,
      )
      .join('')}
  </table></section>`;
  for (const button of app.querySelectorAll('[data-testid=add]')) {
    button.onclick = () => {
      const qty = Number(button.closest('tr').querySelector('input').value);
      if (!Number.isInteger(qty) || qty < 1) return;
      const cart = store.get('cart', {});
      cart[button.dataset.id] = (cart[button.dataset.id] ?? 0) + qty;
      store.set('cart', cart);
      renderNav();
    };
  }
}

function viewCart() {
  const lines = cartLines();
  const coupon = store.get('coupon', '');
  const totals = cartTotals(lines, coupon);
  const confirmation = state.lastOrder
    ? `<div class="notice" data-testid="order-confirmation" data-order-id="${state.lastOrder.id}">
        Order <a href="#/orders/${state.lastOrder.id}">#${state.lastOrder.id}</a> placed.</div>`
    : '';
  if (lines.length === 0) {
    app.innerHTML = `${confirmation}<section><h1>Cart</h1><p class="muted" data-testid="cart-empty">Your cart is empty.</p></section>`;
    return;
  }
  app.innerHTML = `${confirmation}<section><h1>Cart</h1><table>
    ${lines
      .map(
        (line) => `<tr data-testid="cart-line-${escape(line.sku)}"><td>${escape(line.name)}</td>
          <td class="num">${line.qty} x ${money(line.priceCents)}</td><td class="num">${money(line.qty * line.priceCents)}</td></tr>`,
      )
      .join('')}
    </table>
    <div class="row"><input placeholder="Coupon" value="${escape(coupon)}" data-testid="coupon" />
      <button class="secondary" data-testid="apply-coupon">Apply</button>
      <span class="error" data-testid="coupon-error"></span></div>
    <div class="totals">
      <span>Subtotal</span><span data-testid="cart-subtotal">${money(totals.subtotal)}</span>
      <span>Discount</span><span data-testid="cart-discount">${money(totals.discount)}</span>
      <span class="grand">Total</span><span class="grand" data-testid="cart-total">${money(totals.total)}</span>
    </div>
    <div class="row"><button data-testid="place-order">Place order</button>
      <span class="error" data-testid="checkout-error"></span></div>
  </section>`;

  app.querySelector('[data-testid=apply-coupon]').onclick = () => {
    const code = app.querySelector('[data-testid=coupon]').value.trim().toUpperCase();
    if (code && !(code in COUPONS)) {
      app.querySelector('[data-testid=coupon-error]').textContent = 'Unknown coupon';
      return;
    }
    store.set('coupon', code);
    viewCart();
  };

  const placeOrder = app.querySelector('[data-testid=place-order]');
  placeOrder.onclick = async () => {
    if (placeOrder.disabled) return;
    placeOrder.disabled = true;
    // One key per cart, reused on retry.
    const key = store.get('checkoutKey', null) ?? crypto.randomUUID();
    store.set('checkoutKey', key);
    try {
      const order = await api('/api/orders', {
        method: 'POST',
        headers: { 'idempotency-key': key },
        body: JSON.stringify({ items: lines.map((l) => ({ productId: l.id, qty: l.qty })), coupon: coupon || null }),
      });
      state.lastOrder = order;
      for (const key of ['cart', 'coupon', 'checkoutKey']) store.drop(key);
      renderNav();
      viewCart();
    } catch (error) {
      app.querySelector('[data-testid=checkout-error]').textContent = error.message;
      placeOrder.disabled = false;
    }
  };
}

async function viewOrders() {
  const orders = await api('/api/orders');
  app.innerHTML = `<section><h1>Orders</h1>${
    orders.length === 0
      ? '<p class="muted" data-testid="no-orders">No orders yet.</p>'
      : `<table><tr><th>Order</th><th>Placed</th><th class="num">Total</th><th>Status</th></tr>
        ${orders
          .map(
            (order) => `<tr data-testid="order-row-${order.id}">
              <td><a href="#/orders/${order.id}">#${order.id}</a></td>
              <td>${new Date(order.createdAt).toLocaleString()}</td>
              <td class="num">${money(order.totalCents)}</td>
              <td class="status-${order.status}" data-testid="status">${order.status === 'confirmed' ? 'Confirmed' : 'Pending'}</td></tr>`,
          )
          .join('')}</table>`
  }</section>`;
}

async function viewOrder(id) {
  try {
    const order = await api(`/api/orders/${encodeURIComponent(id)}`);
    app.innerHTML = `<section data-testid="order-detail"><h1>Order #${order.id}</h1>
      <p>Status: <span class="status-${order.status}" data-testid="order-status">${order.status === 'confirmed' ? 'Confirmed' : 'Pending'}</span></p>
      <table>${order.items
        .map((item) => `<tr><td>${escape(item.name)}</td><td class="num">${item.qty} x ${money(item.priceCents)}</td></tr>`)
        .join('')}</table>
      <div class="totals"><span class="grand">Total</span><span class="grand" data-testid="order-total">${money(order.totalCents)}</span></div>
    </section>`;
  } catch (error) {
    if (error.status !== 404) throw error;
    app.innerHTML = '<section><p data-testid="not-found">Order not found.</p></section>';
  }
}

async function render() {
  const [, page, id] = (location.hash || '#/catalog').split('/');
  if (!localStorage.getItem('token')) {
    state.me = null;
    renderNav();
    return viewLogin();
  }
  state.me ??= await api('/api/me').catch(() => null);
  if (!state.me) {
    localStorage.removeItem('token');
    return render();
  }
  if (state.products.length === 0) state.products = await api('/api/products');
  if (page !== 'cart') state.lastOrder = null;
  renderNav();
  if (page === 'cart') return viewCart();
  if (page === 'orders' && id) return viewOrder(id);
  if (page === 'orders') return viewOrders();
  return viewCatalog();
}

window.addEventListener('hashchange', render);
render();
