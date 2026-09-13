# Prism

A small business-to-consumer shop: accounts, a searchable catalog, and nothing it does not
need. Nothing in the code knows what the shop sells. A product is a name, a description, a
price, stock, a category, a brand, its pictures, its weight and size, and a bag of named
properties. Every filter the storefront offers is derived from those rows at query time, so
the same code sells lamps, books or pet food depending only on what the database holds.

The stack is TypeScript end to end: a Fastify API on Node, Postgres behind Drizzle ORM, and
a React storefront built with Vite and served by Caddy, which also fronts the API so both
share one origin. Docker is the only thing a machine needs to run it.

## Running it

```sh
./start.sh
```

The script writes a `.env` from `.env.example` with a random JWT secret, builds the images,
migrates and seeds the database, and prints where everything is:

| What | Where |
| --- | --- |
| Storefront | <http://localhost:3000> |
| API | <http://localhost:3000/api/v1> |
| Inbox for password-reset mail (Mailpit) | <http://localhost:8025> |

The seed plants a demo shopper you can sign in as: `shopper@prism.test` with the password
`correct horse battery staple`. It also plants categories, each with its own property
vocabulary, plus brands, products, placeholder images and reviews, all drawn from a fixed
random seed, so every fresh database holds the same shop.

`./start.sh down` stops the stack. `./start.sh reset` also deletes the database and the
media volume, so the next start migrates and seeds from nothing.

Every value in `.env` has a working default. The stack runs with no external accounts:
registration uses Google's public always-pass reCAPTCHA test key, the OAuth buttons complete
against a built-in offline stand-in, and mail lands in Mailpit. Fill in the keys described in
`.env.example` and the same code paths talk to the real services.

### Working on it without the containers

Node is needed only for development. `npm ci`, then `npm run build` compiles the shared
package the two apps import. `npm run dev --workspace @prism/web` serves the storefront
from source with hot reloading and proxies `/api` and `/media` to the stack `./start.sh`
runs. `npm run typecheck` checks every workspace.

## Usage

### Shopping

The front page is the catalog. The category cards at the top pick one category; choosing it
again clears it. Type in the search box and product names that match appear as suggestions;
submit to search names and descriptions. The rail beside the results offers every other way
to narrow them: any number of brands, a price range on a two-thumb slider between the
cheapest and dearest match, a minimum rating in stars, and one group per property the
matching products carry, with the number of matches next to each value. A group with many
values folds behind "Show more". The search text and the category define the shelf; every
value on the shelf stays listed, and one the other filters leave nothing for is greyed out
rather than removed, so the rail never shifts under the pointer. Counts within a group ignore
that group's own choice, so picking one brand never greys the others. The sort menu orders
by relevance, price either way, or rating. The filters live in the URL, so a filtered view is a link. On a narrow screen
the rail is in the drawer behind the filter button.

A product's page shows its pictures, price, stock, brand, category, rating, description,
properties, and its weight and size in metric or imperial units.

### Accounts

- **Register** with an email address and a password of at least twelve characters, then pass
  the CAPTCHA. Both the browser and the server validate the form; a rejected field is named.
- **Sign in** with the password, or with a provider button. With no provider keys configured
  the button opens a consent page of the stand-in where you type any address.
- **Password reset**: "Forgot your password?" sends a link. Open the Mailpit inbox, follow
  the link, and choose a new password. Every session is signed out.
- **Two-factor authentication** is off by default. On the account page, set it up by scanning
  the QR code with an authenticator app and confirming a code; sign-in then asks for a code.
  Turning it off needs a current code.
- **Change password** on the account page. An account opened through a provider has no
  password and can set one.

Signing out revokes the session. The access token lives only in memory in the browser tab;
the refresh token is an httpOnly cookie scoped to the auth routes, rotates on every use, and
a second use of the same token revokes the whole session.

### The API

Every route is under `/api/v1` and answers JSON. A refusal has the shape
`{ "error": { "code", "message", "issues" } }`, where `issues` names rejected fields.

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
| `GET /media/:file` | A product image. |
| `GET /health` | Liveness. |

`GET /products` reads `q`, `category`, `brand` (repeatable), `priceMin` and `priceMax` in
cents, `rating` as a minimum, `sort` as `relevance`, `price_asc`, `price_desc` or `rating`,
`page`, `perPage`, and `p.<name>=<value>` (repeatable) for any property name the products
carry. Values repeated under one key are alternatives; different keys all have to hold. The
answer carries the page of items, the total, and the facets counted for the whole match.

Authenticated routes take `Authorization: Bearer <access token>`.

## Entity relationship diagram

`||` is exactly one and `o{` is zero or more, read along the line, so
`app_user ||--o{ session` means every session belongs to one user and a user may have any
number of sessions.

```mermaid
erDiagram
  app_user {
    uuid id PK
    text email UK "lowercase"
    text password_hash "null for a provider-only account"
    text totp_secret "null until 2FA setup starts"
    timestamptz totp_enabled_at "null until a code confirms the secret"
    timestamptz created_at
  }
  oauth_identity {
    uuid id PK
    uuid user_id FK
    text provider "unique with subject"
    text subject "the provider's own user id"
    timestamptz created_at
  }
  session {
    uuid id PK
    uuid user_id FK
    timestamptz created_at
    timestamptz expires_at
    timestamptz revoked_at "null while live"
    text revoked_reason "set exactly when revoked_at is"
    text user_agent
    text ip_address
  }
  refresh_token {
    uuid id PK
    uuid session_id FK
    text token_hash UK "SHA-256 of the token"
    timestamptz created_at
    timestamptz expires_at
    timestamptz used_at "set on rotation; a second use is a replay"
  }
  password_reset_token {
    uuid id PK
    uuid user_id FK
    text token_hash UK
    timestamptz created_at
    timestamptz expires_at
    timestamptz used_at
  }
  category {
    uuid id PK
    text slug UK
    text name
  }
  brand {
    uuid id PK
    text slug UK
    text name
  }
  product {
    uuid id PK
    text slug UK
    text name
    text description
    integer price_cents "not negative"
    integer stock "not negative"
    uuid category_id FK
    uuid brand_id FK
    integer weight_grams "positive"
    integer width_mm "positive"
    integer height_mm "positive"
    integer depth_mm "positive"
    timestamptz created_at
    tsvector search "generated from name and description"
  }
  product_property {
    uuid product_id PK, FK
    text name PK
    text value
  }
  product_image {
    uuid id PK
    uuid product_id FK
    text file "name under the media directory"
    text alt
    integer position "unique per product"
  }
  product_review {
    uuid id PK
    uuid product_id FK
    uuid user_id FK "unique with product_id"
    smallint rating "1 to 5"
    timestamptz created_at
  }

  app_user ||--o{ oauth_identity : "signs in through"
  app_user ||--o{ session : "opens"
  session ||--o{ refresh_token : "issues"
  app_user ||--o{ password_reset_token : "requests"
  app_user ||--o{ product_review : "writes"
  category ||--o{ product : "files"
  brand ||--o{ product : "makes"
  product ||--o{ product_property : "carries"
  product ||--o{ product_image : "shows"
  product ||--o{ product_review : "receives"
```

The schema is declared in `apps/api/src/db/schema.ts`; `drizzle-kit generate` turns it into
the SQL under `apps/api/drizzle/`, which the migrator applies at start. Deleting a user
cascades to their identities, sessions, tokens and reviews. Deleting a product cascades to
its properties, images and reviews. A category or brand with products refuses deletion.

### Where ACID matters

Postgres gives every statement a transaction; the API opens one explicitly where several
statements have to land together. Opening a session inserts the session row and its first
refresh token as one unit. A refresh marks the old token used, inserts the new one and, on a
replay, revokes the session, in one transaction, so two concurrent presentations of the same
token cannot both succeed. A password-reset link is consumed by a single conditional update
that returns the user only when the token is unused and unexpired, so it works exactly once
however many requests carry it. Consistency is in the constraints the diagram annotates:
unique emails and slugs, positive measures, ratings in range, and checks that keep
`revoked_at` and `revoked_reason` in step and a 2FA flag from being set without a secret.

### How search works

`product.search` is a generated `tsvector` that weights the name above the description, with
a GIN index over it. A text query matches it with `plainto_tsquery`, which stems words and
escapes operators itself, and also matches the name as a case-insensitive substring so a
typed fragment finds something. Relevance ordering is `ts_rank` over the same vector.
Suggestions are a substring match on the name, prefixes first.

A property filter is an `EXISTS` over `product_property` for the name with the value in the
chosen set. A facet lists every value found on the shelf, the products matching the text and
the category, and counts each value under the other filters with a `FILTER` clause, so a value
the rail excludes stays listed at zero and the counts say what choosing it would match. Each
facet leaves its own filter out of the count. The price bounds are those of the shelf. Every
value a shopper supplies is a bound parameter; the unit tests render the SQL and assert on
the bindings, and the security tests send injection payloads through every query key.

### Images

Product images are files in the media directory named by `MEDIA_DIR`, a Docker volume in
the stack, and `product_image.file` holds the name. The API serves them at `/media/` through
`@fastify/static`, which refuses paths outside the directory. The seed writes an SVG
placeholder per product.

## Testing

```sh
npm run test:unit                     # every workspace, no Docker needed
npm test --workspace @prism/api       # unit, API integration and security
```

The integration and security suites start a real Postgres through Testcontainers, apply the
real migrations, and drive the real application through Fastify's `inject`, with only the
clock, the mailer and the password hasher substituted. Docker has to be running.

- **Unit** (`apps/api/tests/unit`, `packages/shared/tests`, `apps/web/tests`): JWT
  creation, verification and expiry against a fake clock; every input schema with valid,
  malformed and hostile input; the product data model's conversions and query parsing; the
  search SQL and its bindings; the storefront's URL filter arithmetic.
- **API integration** (`apps/api/tests/integration`): every auth endpoint including
  registration, sign-in, refresh rotation and replay, logout, password reset through the
  captured mail, 2FA setup and challenged sign-in, and the provider flow against the stand-in;
  every catalog endpoint including facets, property filters, sorting, paging, suggestions and
  the product page.
- **Security** (`apps/api/tests/security`): injection payloads through every query key and
  every form field, forged and tampered tokens, mass assignment at registration, path
  traversal against the media route, rate limiting on the auth routes, and script payloads
  in product data served back as data.

Three things are checked by hand, because they involve a third party's widget or screen:
the CAPTCHA on the registration page, a provider sign-in against real Google or GitHub
credentials, and enrolling 2FA with a phone's authenticator app.

## Deployment

`.github/workflows/deploy.yml` typechecks, runs the unit tests, builds both images, pushes
them to the GitHub container registry, and restarts the stack on a server over SSH using
`docker-compose.prod.yml` over `docker-compose.yml`. The host, ports, public URL and
credentials are repository variables and secrets; `.env.example` lists them.
