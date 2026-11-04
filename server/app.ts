import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import type { Db } from './db.ts';
import { CLIENT_FAULTS, type Fault } from './faults.ts';
import { HttpError, canRead, createOrder, loadOrder, parseOrderInput, runWorker, type User } from './orders.ts';

const PUBLIC_DIR = join(import.meta.dirname, '..', 'public');
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const MAX_BODY_BYTES = 64 * 1024;

type Options = { db: Db; faults: Set<Fault>; testHooks: boolean };
type Request = { req: IncomingMessage; res: ServerResponse; url: URL } & Options;

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'body too large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'body must be valid JSON');
  }
}

function authenticate({ req, db }: Request): User {
  const match = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '');
  const user = match && (db.prepare('SELECT id, name, role FROM users WHERE token = ?').get(match[1]) as User | undefined);
  if (!user) throw new HttpError(401, 'sign in first');
  return user;
}

function orderId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(404, 'order not found');
  return id;
}

async function serveStatic({ res, url, faults }: Request) {
  if (url.pathname === '/config.js') {
    const clientFaults = [...faults].filter((fault) => CLIENT_FAULTS.includes(fault));
    res.writeHead(200, { 'content-type': 'text/javascript' });
    res.end(`window.FAULTS = ${JSON.stringify(clientFaults)};`);
    return;
  }
  const file = normalize(join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(PUBLIC_DIR)) throw new HttpError(404, 'not found');
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    throw new HttpError(404, 'not found');
  }
}

async function route(r: Request) {
  const { req, res, url, db, faults } = r;
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (method === 'GET' && path === '/api/health') return send(res, 200, { ok: true });

  if (method === 'GET' && path === '/api/products') {
    const rows = db.prepare('SELECT id, sku, name, price_cents AS priceCents FROM products ORDER BY id').all();
    return send(res, 200, rows);
  }

  if (method === 'GET' && path === '/api/me') return send(res, 200, authenticate(r));

  if (method === 'GET' && path === '/api/orders') {
    const user = authenticate(r);
    const ids = (
      user.role === 'admin'
        ? db.prepare('SELECT id FROM orders ORDER BY id DESC').all()
        : db.prepare('SELECT id FROM orders WHERE user_id = ? ORDER BY id DESC').all(user.id)
    ) as { id: number }[];
    return send(res, 200, ids.map(({ id }) => loadOrder(db, id)));
  }

  if (method === 'POST' && path === '/api/orders') {
    const user = authenticate(r);
    const rawKey = req.headers['idempotency-key'];
    const key = typeof rawKey === 'string' && rawKey.length > 0 && rawKey.length <= 100 ? rawKey : null;
    const { order, created } = createOrder(db, faults, user, parseOrderInput(await readJson(req)), key);
    return send(res, created ? 201 : 200, order);
  }

  const orderMatch = /^\/api\/orders\/([^/]+)$/.exec(path);
  if (method === 'GET' && orderMatch) {
    const user = authenticate(r);
    const order = loadOrder(db, orderId(orderMatch[1]));
    // 404, not 403: other people's order ids are none of your business.
    if (!order || !canRead(faults, user, order)) throw new HttpError(404, 'order not found');
    return send(res, 200, order);
  }

  if (method === 'POST' && path === '/_worker/run') {
    const raw = url.searchParams.get('order');
    return send(res, 200, { processed: runWorker(db, raw === null ? null : orderId(raw)) });
  }

  if (r.testHooks && path.startsWith('/_test/')) return testHooks(r);

  if (method === 'GET' && !path.startsWith('/api/')) return serveStatic(r);
  throw new HttpError(404, 'not found');
}

// Read-only views of stored rows for tests. Enabled with TEST_HOOKS=1.
function testHooks({ res, url, db }: Request) {
  const match = /^\/_test\/db\/orders\/(\d+)$/.exec(url.pathname);
  if (match) {
    const order = loadOrder(db, Number(match[1]));
    if (!order) throw new HttpError(404, 'no such row');
    const events = db.prepare('SELECT type, processed_at AS processedAt FROM events WHERE order_id = ?').all(order.id);
    return send(res, 200, { ...order, events });
  }
  if (url.pathname === '/_test/db/orders') {
    const user = url.searchParams.get('user');
    const rows = db
      .prepare(
        `SELECT o.id, o.idempotency_key AS idempotencyKey FROM orders o JOIN users u ON u.id = o.user_id
         WHERE u.name = ? ORDER BY o.id`,
      )
      .all(user);
    return send(res, 200, rows);
  }
  throw new HttpError(404, 'not found');
}

export function createApp(options: Options): Server {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      await route({ req, res, url, ...options });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) console.error(error);
      send(res, status, { error: error instanceof Error ? error.message : 'internal error' });
    }
  });
}
