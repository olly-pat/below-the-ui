# below-the-ui

Playwright and TypeScript tests that compare what the UI shows with what the
system actually stored.

The app under test is a small order desk: catalog, cart with a coupon, checkout,
order history and a background worker that confirms orders. Each test acts like
a customer, in the browser or through the API, and then checks the stored order
before deciding anything passed.

```
browser    cart shows $17.85, banner says order #12 placed
API        POST /api/orders  201  { id: 12, totalCents: 1785 }
storage    orders row 12, its items, its outbox event    <- tests read this
worker     POST /_worker/run?order=12  confirms it
```

## Why

A green UI test proves the screen looked right. The bugs I remember best were
the ones where the screen looked right and the data did not: a confirmation for
an order that was never saved, a retry that charged twice, a total the cart and
the server rounded differently, an order anyone could open by changing a number
in the URL.

The confirmation banner is where those bugs hide, so the tests do not stop there.

## Fault drills

The server can bring back five real bugs on request. CI runs the suite against
each one and fails if the suite stays green. Tests that cannot fail are
decoration.

```
$ npm run faults

CAUGHT  ghost_success: the API answers 201 and the UI shows a confirmation, but the order is never stored
        api/orders.api.spec.ts > orders API > an order is stored exactly as the API reported it
        api/orders.api.spec.ts > orders API > a retried request with the same idempotency key creates one order
        and 11 more
CAUGHT  double_submit: the idempotency key is ignored, so a retried request creates a second order
        api/orders.api.spec.ts > orders API > a retried request with the same idempotency key creates one order
        e2e/checkout.spec.ts > checkout > a timeout after the order was saved does not charge twice on retry
CAUGHT  order_leak: any signed-in customer can open any order by its id
        api/orders.api.spec.ts > orders API > a customer cannot read another customer order, an admin can
        e2e/access.spec.ts > access to orders > a customer who guesses another order id sees nothing
CAUGHT  lost_event: the order is stored but its outbox event is not, so it never leaves pending
        api/orders.api.spec.ts > orders API > the worker confirms a new order through its outbox event
        e2e/checkout.spec.ts > checkout > a new order shows as pending until the worker confirms it
CAUGHT  total_drift: the cart rounds the discount per line, the server per order, and the totals disagree
        e2e/coupon.spec.ts > coupon totals > notebook and pens: the discounted total shown is the total charged
        e2e/coupon.spec.ts > coupon totals > two notebooks, pens and a mug: the discounted total shown is the total charged

Every fault was caught.
```

`total_drift` lives in the browser. The cart prices itself so the total updates
instantly, which means the pricing rule exists twice. With the fault on, the
cart takes 15% off each line and the server takes 15% off the order. For a
$12.50 notebook and an $8.50 pen set that is one cent. Nobody complains about
one cent until the accountant does.

`double_submit` is caught in the browser by breaking the network at the worst
moment. The request reaches the server, the order is saved, the response never
arrives. The customer sees an error and clicks again, as customers do.
`page.route` arranges this on demand, and the test counts the rows.

## How it is built

| Layer | Checks | Where |
| --- | --- | --- |
| API | storage matches the response, idempotency, access, the worker, input validation | `tests/api` |
| E2E | what the customer saw against what was stored, retries, order status, access by URL | `tests/e2e` |

Tests read stored state through read-only hooks under `/_test/db`. They exist
only when the server starts with `TEST_HOOKS=1`.

Page objects in `tests/pages` only know where things are. Assertions stay in the
tests, so a failure points at a rule and not at a helper.

Fixtures in `tests/support/fixtures.ts` give each test the API client, the
stored state reader and the pages it needs.

Tests run in parallel and never wipe shared data. Each one checks the orders it
created. The one test that counts rows has a customer of its own. Tests also
tell the worker which order to confirm. Without that they confirm each other's
orders, and one of them fails once in twenty runs.

No retries. A test that passes on the second attempt is a finding. Traces and
screenshots are kept for every failure.

Selectors use test ids and roles, not CSS classes or copy that a designer may
rewrite on Friday.

## Running it

```
npm install
npx playwright install chromium
npm test              # whole suite, about 4 seconds
npm run test:api      # API layer
npm run test:e2e      # browser layer
npm run faults        # break the app five ways, expect red each time
npm run report        # last HTML report
npm start             # the app, on http://127.0.0.1:4173
```

Node 24 or newer. Node runs the TypeScript server directly and SQLite comes from
the standard library, so there is no build step, no Docker and no database to
install.

## About the app

`server/` and `public/` are a small stand-in, written so the tests have
something real to run against. They cover the parts of a checkout where
accuracy matters: money in integer cents, a coupon, idempotent order creation,
an outbox event, an asynchronous worker and orders that belong to one customer.

Sign in hands out fixed demo tokens. Please do not do this in production.

MIT licensed. Olya Piatak.
