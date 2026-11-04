import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

const SCHEMA = `
  CREATE TABLE users (
    id    INTEGER PRIMARY KEY,
    name  TEXT NOT NULL UNIQUE,
    role  TEXT NOT NULL CHECK (role IN ('customer', 'admin')),
    token TEXT NOT NULL UNIQUE
  );
  CREATE TABLE products (
    id          INTEGER PRIMARY KEY,
    sku         TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    price_cents INTEGER NOT NULL CHECK (price_cents > 0)
  );
  CREATE TABLE orders (
    id              INTEGER PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id),
    status          TEXT NOT NULL CHECK (status IN ('pending', 'confirmed')),
    subtotal_cents  INTEGER NOT NULL,
    discount_cents  INTEGER NOT NULL,
    total_cents     INTEGER NOT NULL,
    coupon          TEXT,
    idempotency_key TEXT,
    created_at      TEXT NOT NULL,
    UNIQUE (user_id, idempotency_key)
  );
  CREATE TABLE order_items (
    order_id    INTEGER NOT NULL REFERENCES orders(id),
    product_id  INTEGER NOT NULL REFERENCES products(id),
    qty         INTEGER NOT NULL CHECK (qty > 0),
    price_cents INTEGER NOT NULL
  );
  -- Outbox: the worker reads this table to confirm orders.
  CREATE TABLE events (
    id           INTEGER PRIMARY KEY,
    order_id     INTEGER NOT NULL REFERENCES orders(id),
    type         TEXT NOT NULL,
    processed_at TEXT
  );
`;

// Demo accounts with fixed tokens.
const USERS = [
  ['alice', 'customer', 'alice-token'],
  ['bob', 'customer', 'bob-token'],
  ['carol', 'customer', 'carol-token'],
  ['admin', 'admin', 'admin-token'],
] as const;

// Prices picked so that per-line and per-order discounts can round differently.
const PRODUCTS = [
  ['NB-A5', 'A5 notebook', 1250],
  ['PEN-3', 'Gel pen set', 850],
  ['MUG-W', 'White mug', 1999],
  ['TOTE', 'Canvas tote', 1475],
  ['STK-10', 'Sticker pack', 399],
] as const;

export function openDb(): Db {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  const addUser = db.prepare('INSERT INTO users (name, role, token) VALUES (?, ?, ?)');
  for (const user of USERS) addUser.run(...user);
  const addProduct = db.prepare('INSERT INTO products (sku, name, price_cents) VALUES (?, ?, ?)');
  for (const product of PRODUCTS) addProduct.run(...product);
  return db;
}
