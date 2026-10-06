# Prism

A small business-to-consumer shop: accounts, a searchable catalog, a cart that guests and
members both keep, a single-page checkout that takes card payments through Stripe's test
mode, and an order history where customers follow, filter and cancel their orders. The code
does not know what the shop sells. Every filter comes from the products' own properties at
query time, so the same code sells lamps, books or pet food.

Fastify API on Node, Postgres behind Drizzle, RabbitMQ between the order and payment services,
React storefront built with Vite and served by Caddy. TypeScript end to end. Docker is the only
thing a machine needs; taking test payments also needs a free Stripe account's test keys.

## Running it

```sh
./start.sh        # Linux and macOS
.\start.cmd       # Windows, from cmd or PowerShell
```

| Command | What it does |
| --- | --- |
| `./start.sh` | Copies `.env.example` to `.env` if there is none, then builds, migrates and starts everything, and seeds the shop. |
| `./start.sh --pull` | The same, and refreshes the base images. |
| `./start.sh down` | Stops the stack. |
| `./start.sh reset` | Stops it and deletes the database and the media. |
| `./start.sh seed` | Runs only the seed: placeholder products and a demo shopper, planted into an empty catalog. |
| `./start.sh test` | Runs every test suite in a container. |
| `./start.sh test npm run test:unit` | Runs only the unit tests there. |

On Windows each command is `.\start.cmd ...` with the same arguments.

| What | Where |
| --- | --- |
| Storefront | <http://localhost:3000> |
| API | <http://localhost:3000/api/v1> |
| Inbox for order and password-reset mail (Mailpit), as `prism` / `MAILPIT_PASSWORD` | <http://localhost:8025> |
| RabbitMQ management UI, as `prism` / `RABBITMQ_PASSWORD` | <http://localhost:15672> |

Both passwords are `prism` unless `.env` sets them.

The stack runs with no external accounts: the CAPTCHA uses Google's always-pass test key, the
provider buttons go to a built-in stand-in, and mail lands in Mailpit. Real keys go in `.env`;
`.env.example` describes each one. Its `JWT_SECRET` and `DATA_ENCRYPTION_KEY` are public, so
replace them anywhere but your own machine.

### Taking test payments

Without Stripe keys the cart works and checkout says that payments are not set up. To pay:

1. Sign up at <https://dashboard.stripe.com>, which is free, and stay in test mode.
2. Copy the two test keys from Developers > API keys into `.env`: `STRIPE_SECRET_KEY`
   (`sk_test_...`) and `STRIPE_PUBLISHABLE_KEY` (`pk_test_...`).
3. Run `./start.sh` again.

Stripe tells the shop how each payment went through a webhook. `COMPOSE_PROFILES=stripe` in
`.env` starts the Stripe CLI as a container that forwards those webhooks to the API, so the
laptop needs no public address and no CLI of its own. To run the CLI on the host instead,
remove that line, run
`stripe listen --forward-to localhost:3000/api/v1/payments/webhook`, and put the `whsec_...`
secret it prints into `STRIPE_WEBHOOK_SECRET`.

The seed is separate from the shop: the shop runs without it, and a failed seed leaves an
empty shop. Its data is one archive, `apps/api/seed/data.zip`. After the seed, sign in as
`shopper@prism.test` with the password `correct horse battery staple`.
`apps/api/seed/README.md` has the details.

### Running it without the scripts

1. Copy `.env.example` to `.env`.
2. `docker compose up --build --detach`. If it fails, `docker compose logs migrate` says why.
3. Open <http://localhost:3000>. The storefront answers a few seconds after step 2 returns.
4. `docker compose down` stops the stack. Add `--volumes` to delete the data too.

Placeholder products: `docker compose run --rm --build seed`.

Tests: `docker compose run --rm --build test`. Append `npm run test:unit` for the unit tests
only.

### Working on it without the containers

Only development needs Node.

```sh
npm ci && npm run build                         # the shared package both apps import
npm run dev --workspace @prism/web              # storefront with hot reload, proxied to the running stack
npm run typecheck
npm run test:unit                               # unit tests of every workspace
npm test --workspace @prism/api                 # unit, integration, security and flows; Docker running
```

## Usage

### Shopping

- **Categories**: the cards at the top. Picking one drops the other filters; picking it
  again clears it.
- **Search**: suggestions appear as you type. Submitting searches names and descriptions.
- **Filters**: brands, a price range, a minimum rating, and one group per property of the
  matching products, each value with its count. A value the other filters leave nothing for
  is grayed out, not removed.
- **Active filters** sit beside "Results", each with a cross. "Clear all filters" keeps the
  search text and the category.
- **Sort**: relevance, price either way, or rating.
- The filters live in the URL, so a filtered view is a link.
- A narrow screen puts the filters in a drawer.
- **Product page**: pictures, price, stock, brand, category, rating, description,
  properties, and weight and size in metric or imperial units. A quantity and "Add to cart",
  or "Sold out" when there is no stock.

### Cart

- The cart button in the header shows how many items the cart holds, at every width.
- **Cart page**: each line with its picture, name, unit price, a quantity stepper, a remove
  button and the line total. The subtotal changes as soon as a quantity does.
- Asking for more than the stock says how many are left. A line the shop can no longer supply
  in full says so, with a button that reduces it to what is left.
- **Recommended for you**: in-stock products from the same categories as the cart, best rated
  first.
- **Guests** keep their cart for 30 days in the browser that made it. **Members** keep theirs
  in the account, across devices and sign-ins. Signing in moves a guest's cart into the
  account's.

### Checkout

One page, in four parts, with the order summary beside it, or folded at the top on a narrow
screen. The summary has steppers and remove buttons too.

1. **Contact**: name, email, phone.
2. **Shipping address**. Once it is complete, the page looks it up in OpenStreetMap and says
   "Address found", or that it could not find it.
3. **Shipping**: standard, €4.90 and free from €50, or express, €9.90.
4. **Payment**: Stripe's card fields.

A signed-in customer starts with the account email, and after a first order with that order's
contact, address and shipping. "Place order" checks every field and the card before anything
is sent, places the order, then has Stripe confirm the payment. The order page that follows is
the confirmation; it updates by itself once the payment settles, and the confirmation mail
arrives in Mailpit.

Stripe's test cards, with any future expiry and any CVC:

| Card | What happens |
| --- | --- |
| `4242 4242 4242 4242` | Paid |
| `4000 0000 0000 9995` | Declined: insufficient funds |
| `4000 0000 0000 0069` | Declined: expired card |
| `4000 0000 0000 0127` | Declined: incorrect CVC |
| `4000 0000 0000 3220` | Asks for 3D Secure; approve or fail it |
| `4242 4242 4242 4241` | Refused by the card field before submission: invalid number |

A declined order releases its stock and mails the reason; the cart keeps its items, so
"Place order" again tries another card. To see a gateway timeout, set `STRIPE_TIMEOUT_MS=1` in
`.env`, run `docker compose up -d api`, and place an order.

### Orders

- **Orders** (signed in): status chips, any number at once, a date range whose ends both
  count, and newest, oldest or status order. The filters live in the URL.
- **Order page**: status, a timeline of every change, the tracking number once shipped, the
  items, totals, address, and how it was paid. A guest opens it from the link in the
  confirmation mail.
- **Cancel** works until the order is processing. A paid order is refunded in full, which
  shows in the timeline and arrives as a second mail.
- After payment a simulated warehouse moves the order to processing, then shipped with a
  tracking number and a mail, then delivered, one step every `FULFILLMENT_STEP_SECONDS`
  (600 by default). An order unpaid for 30 minutes is canceled and its stock released.

### Accounts

- **Register**: email address, a password of at least twelve characters, and the CAPTCHA.
- **Sign in** with the password or a provider button. With no provider keys the button opens
  a stand-in consent page, where any address works.
- **Password reset**: "Forgot your password?" mails a link to the Mailpit inbox. Setting the
  new password signs every session out.
- **Two-factor authentication**: on the account page, scan the QR code with an
  authenticator app and confirm a code. Sign-in then asks for a code, and so does turning
  it off.
- **Change password** on the account page. A provider-only account can set one.
- **Sign out** revokes the session.

### The API

Every route is under `/api/v1` and answers JSON. A refusal is
`{ "error": { "code", "message", "issues" } }`, where `issues` names the rejected fields, or
the products a stock refusal is about. Authenticated routes take
`Authorization: Bearer <access token>`; cart and order routes take it when there is one.

| Method and path | What it does |
| --- | --- |
| `POST /auth/register` | Opens an account. Body: `email`, `password`, `captchaToken`. |
| `POST /auth/login` | Signs in. Answers a grant, or a challenge when 2FA is on. |
| `POST /auth/login/2fa` | Finishes a challenged sign-in with a code. |
| `POST /auth/refresh` | Trades the refresh cookie for a new access token and cookie. |
| `POST /auth/logout` | Revokes the session. |
| `GET /auth/me` | The signed-in user. |
| `POST /auth/password/forgot` | Sends a reset link. Answers the same whether the address exists. |
| `POST /auth/password/reset` | Sets a password against a token from the mail. |
| `POST /auth/password` | Changes, or sets, the password of the signed-in user. |
| `POST /auth/2fa/setup` | Starts enrollment: an `otpauth://` URI and a QR code. |
| `POST /auth/2fa/enable` | Confirms enrollment with a live code. |
| `POST /auth/2fa/disable` | Turns 2FA off with a live code. |
| `GET /auth/oauth/providers` | Which provider buttons to show. |
| `GET /auth/oauth/:provider` | Starts a provider sign-in. |
| `GET /auth/oauth/:provider/callback` | Where the provider returns. |
| `GET /products` | Searches the catalog. See the query keys below. |
| `GET /products/suggest?q=` | Names containing the typed text, those starting with it first. |
| `GET /products/:slug` | One product with its measurements in both unit systems. |
| `GET /cart` | The caller's cart. A guest's is found by the `prism_cart` cookie. |
| `POST /cart/items` | Adds `quantity` of `productId`. Starts a guest cart and sets its cookie when needed. |
| `PUT /cart/items/:productId` | Sets the quantity of a line. |
| `DELETE /cart/items/:productId` | Removes a line. |
| `GET /cart/recommendations` | Products to go with the cart. |
| `GET /checkout/config` | Whether payments are on, and Stripe's publishable key. |
| `GET /checkout/prefill` | The signed-in customer's email and last order details. |
| `POST /checkout/address` | Looks an address up: `verified`, `not_found` or `unavailable`. |
| `POST /orders` | Places an order from the caller's cart. Body: `contact`, `address`, `shippingMethod`, `expectedTotalCents`. Answers the order and the client secret Stripe.js confirms with; a guest also gets the order's key. |
| `GET /orders` | The signed-in customer's orders. Reads `status` (repeats), `from`, `to`, `sort` (`newest`, `oldest`, `status`), `page`, `perPage`. |
| `GET /orders/:id` | One order. A guest adds `?key=`. |
| `POST /orders/:id/cancel` | Cancels an order not yet processing, and refunds it if paid. |
| `POST /payments/webhook` | Where Stripe reports payments and refunds. Checks Stripe's signature. |
| `GET /media/:file` | A product image. |
| `GET /health` | Liveness. |

`GET /products` reads `q`, `category`, `brand`, `priceMin` and `priceMax` in cents, `rating`
as a minimum, `sort` (`relevance`, `price_asc`, `price_desc`, `rating`), `page`, `perPage`,
and `p.<name>=<value>` for any property. `brand` and `p.<name>` repeat: values under one key
are alternatives, and different keys all have to hold. The answer carries the page of items,
the total, and the facets.

## Entity relationship diagram

[![Entity relationship diagram: every table with its columns, keys and relationships](docs/erd.svg)](docs/erd.svg)

Open the image for full size. It is drawn from `docs/erd.mmd`: paste that into
<https://mermaid.live> and download the SVG to redraw it.

`outbox_message` stands alone: it holds messages on their way to RabbitMQ.

The schema is `apps/api/src/db/schema.ts`, and the migrations under `apps/api/drizzle/` are
applied at start. Deleting a user or a product cascades to the rows that hang off it, except
that an account with orders cannot be deleted, and an order line keeps its snapshot when its
product goes. A category or brand with products refuses deletion.

## Design notes

- **Transactions.** Opening a session, rotating a refresh token and resetting a password
  each run in one transaction. One conditional `UPDATE` spends a reset link, so it works
  once however many requests carry it.
- **Constraints** are the quoted notes in the diagram.
- **Tokens.** The access token lives only in the tab's memory. The refresh token is an
  httpOnly cookie scoped to the auth routes. It rotates on every use, and a reused token
  revokes the session.
- **Search.** `product.search` is a generated `tsvector` under a GIN index, name weighted
  above description, matched with `plainto_tsquery` and ranked with `ts_rank`. The name also
  matches as a substring.
- **Facets.** The category facet counts the whole shop. Every other facet counts its values
  under every filter except its own.
- **SQL.** Every value a shopper supplies is a bound parameter.
- **Images.** Files in the `MEDIA_DIR` volume, named by `product_image.file` and served at
  `/media/` by `@fastify/static`.
- **Carts.** Both kinds live in Postgres, so a cart is never lost and stock is checked against
  one truth. A guest cart belongs to an opaque cookie whose SHA-256 is stored, like a refresh
  token. Prices are never stored in a cart: every read joins today's price and stock.
- **Placing an order** is one transaction that reserves every line with
  `UPDATE product SET stock = stock - q WHERE id = $1 AND stock >= q`, in product id order,
  then writes the order, its lines and its first event. Of two checkouts racing for the last
  unit, the second waits for the first and then finds it gone, so two payments can never be
  taken for one item. A failed, expired or canceled order gives its stock back.
- **Payments.** The browser sends the card to Stripe's own fields; Prism only creates a
  PaymentIntent and reads Stripe's signed webhooks, checked against the raw body. Card data
  never touches Prism, which keeps it in PCI DSS's smallest scope (SAQ A).
- **Messages.** The payment service publishes `payment.status`; the order service consumes it
  and updates the order, the stock and the customer. Cancellations go the other way as
  `order.canceled`, and the payment service refunds. A message is written to `outbox_message`
  in the same transaction as the change it announces, then published by a relay with a broker
  confirm, so a committed change always gets its message. Consumers apply every change as a
  conditional `UPDATE`, so a duplicate does nothing.
- **Failed messages.** Both queues are quorum queues with `x-delivery-limit: 5` and a
  dead-letter exchange. A handler that fails rejects its message back to the queue; after the
  sixth failed delivery, or at once for a malformed message, RabbitMQ moves it to the
  `dead-letter` queue, which the management UI shows.
- **Encryption at rest.** The order contact, shipping address and guest key, and each
  payment's Stripe id and card summary, are sealed with AES-256-GCM under
  `DATA_ENCRYPTION_KEY` before they reach Postgres, so a dump or backup holds ciphertext.
  Status, dates and amounts stay plain: lists filter on them and they identify nobody.
- **Encryption in transit.** Card data goes from the browser to Stripe over TLS. The deployed
  shop is served over HTTPS by its reverse proxy, and the API calls Stripe over TLS.

## Testing

```sh
./start.sh test                       # every suite of every workspace, in a container
./start.sh test npm run test:unit     # only the unit tests, in the same container
```

This needs only Docker. The integration, security and flow suites run the real application
on a real Postgres, started through Testcontainers. Only what would reach the outside world
is substituted: the clock, the mailer, the password hasher, the message queue, Stripe and the
address lookup. Stripe's stand-in signs its webhooks the way Stripe does. CI runs every suite
before each deploy.

| Suite | Where | Covers |
| --- | --- | --- |
| Unit | `apps/api/tests/unit`, `packages/shared/tests`, `apps/web/tests` | JWT creation, verification and expiry; input schemas; product conversions; the search SQL and its bindings; URL filter arithmetic; cart rules and totals; prices and shipping; field encryption; order emails; Stripe error messages |
| Integration | `apps/api/tests/integration` | Every auth, catalog, cart, checkout, order and webhook endpoint; overselling under ten concurrent checkouts; encryption at rest; the database's constraints; RabbitMQ itself, with its dead-letter queue |
| Security | `apps/api/tests/security` | Injection, forged tokens and webhooks, other customers' orders, prices in request bodies, mass assignment, path traversal, rate limiting, script payloads in pages and mail |
| Flows | `apps/api/tests/flows` | Registration, a guest checkout and a member checkout, each a whole journey through the API |

Checked by hand, because a third party's screen is involved: the CAPTCHA, a provider sign-in
with real Google or GitHub keys, 2FA enrollment with a phone app, and payments with Stripe's
test cards. Encryption is checked by hand too:

- At rest: `docker compose exec postgres psql -U prism -c "select contact, shipping_address from customer_order limit 1"`
  shows bytes, not text, while the order page shows the address.
- In transit: in the browser's network tab, the card number is only ever sent to Stripe's
  domains, over HTTPS, and `POST /orders` carries no card field.
