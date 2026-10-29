/**
 * REQUIREMENTS_3.md: "Admin page provides CRUD functionality for products,
 * order management, user management, review moderation, and bulk uploads."
 *
 * The admin signs in once for the whole file, since a TOTP code works once,
 * and does each job through the admin's pages; the API confirms the result.
 */

import { expect, request as requests, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test"
import { Checks } from "../../apps/e2e/support/checks.ts"
import { Stack } from "../../apps/e2e/support/stack.ts"
import { Storefront, type ListedProduct } from "./support/storefront.ts"

test.describe.configure({ mode: "serial" })

let admin: BrowserContext
let page: Page
let adminToken: string
let shopper: APIRequestContext

test.beforeAll(async ({ browser }, info) => {
  const { baseURL } = info.project.use
  admin = await browser.newContext({
    ...(baseURL === undefined ? {} : { baseURL }),
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 900 },
  })
  adminToken = await Stack.signInAdmin(admin.request)
  page = await admin.newPage()
  shopper = await requests.newContext({ ...(baseURL === undefined ? {} : { baseURL }), ignoreHTTPSErrors: true })
})

test.afterAll(async () => {
  await shopper.dispose()
  await admin.close()
})

/** Reads `path` of the admin API as the admin. */
const adminGet = async <T>(path: string): Promise<T> => {
  const answer = await admin.request.get(`/api/v1/admin${path}`, { headers: { authorization: `Bearer ${adminToken}` } })
  expect(answer.status(), path).toBe(200)

  return (await answer.json()) as T
}

/** Asks the admin API as the admin to move order `id` to `status`. */
const moveOrder = async (id: string, status: object): Promise<void> => {
  const answer = await admin.request.post(`/api/v1/admin/orders/${id}/status`, {
    headers: { authorization: `Bearer ${adminToken}` },
    data: status,
  })
  expect(answer.status(), await answer.text()).toBe(200)
}

/** Waits until the provider's payment for order `id` has settled. */
const waitUntilPaid = async (id: string): Promise<void> => {
  await expect.poll(async () => (await adminGet<{ status: string }>(`/orders/${id}`)).status).toBe("payment_successful")
}

/** Registers a customer through the API. Resolves to their email and access token. */
const registerCustomer = async (label: string): Promise<{ email: string; token: string }> => {
  const email = `${label}-${Date.now()}@example.com`
  const answer = await shopper.post("/api/v1/auth/register", { data: { email, password: Stack.PASSWORD, captchaToken: "e2e" } })
  expect(answer.status(), await answer.text()).toBe(201)

  return { email, token: ((await answer.json()) as { accessToken: string }).accessToken }
}

test("products: one is created, edited and deleted through the product pages", async () => {
  const name = `Requirement Lamp ${Date.now()}`
  const slug = Storefront.slugify(name)

  await Checks.open(page, "/admin/products")
  await expect(page.getByRole("table", { name: "Products" }).getByRole("row").nth(1)).toBeVisible()
  await page.getByRole("link", { name: "New product" }).click()
  await expect(page.getByRole("heading", { level: 1, name: "New product" })).toBeVisible()
  await page.locator("#product-name").fill(name)
  await expect(page.locator("#product-slug")).toHaveValue(slug)
  await page.getByLabel("Description").fill("A lamp made by the requirement checks, to be deleted again.")

  for (const [label, value] of [
    ["Price in euros", "12.50"],
    ["In stock", "7"],
    ["Weight in grams", "900"],
    ["Width in mm", "150"],
    ["Height in mm", "400"],
    ["Depth in mm", "150"],
  ] as const) {
    await page.getByLabel(label).fill(value)
  }
  await page.getByRole("button", { name: "Create product" }).click()

  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible()
  expect(await Storefront.fetchJson<ListedProduct>(admin.request, `/products/${slug}`)).toMatchObject({ name, priceCents: 1250, stock: 7 })

  await page.getByLabel("Price in euros").fill("15.00")
  await page.getByRole("button", { name: "Save product" }).click()
  await expect(page.getByText(`${name} is saved.`)).toBeVisible()
  expect((await Storefront.fetchJson<ListedProduct>(admin.request, `/products/${slug}`)).priceCents).toBe(1500)

  await page.getByRole("button", { name: "Delete product" }).click()
  await page
    .getByRole("dialog", { name: `Delete ${name}?` })
    .getByRole("button", { name: "Delete product" })
    .click()
  await expect(page).toHaveURL(/\/admin\/products$/)
  expect((await admin.request.get(`/api/v1/products/${slug}`)).status()).toBe(404)
})

test("orders: a paid order is found in the list, opened, and moved to its next step", async () => {
  const [product] = await Storefront.pickProducts(shopper, 1)
  const placed = await Storefront.placeOrder(shopper, product?.id ?? "")
  await waitUntilPaid(placed.orderId)
  const { number } = await adminGet<{ number: number }>(`/orders/${placed.orderId}`)

  await Checks.open(page, "/admin/orders")
  await page
    .getByRole("table", { name: "Orders" })
    .getByRole("link", { name: `#${number}` })
    .click()

  await expect(page.getByRole("heading", { level: 1, name: `Order #${number}` })).toBeVisible()
  await expect(page.getByRole("button", { name: "Cancel order" })).toBeVisible()
  await page.getByRole("button", { name: "Start processing" }).click()
  await expect(page.getByText("The order is being processed.")).toBeVisible()
  expect((await adminGet<{ status: string }>(`/orders/${placed.orderId}`)).status).toBe("processing")
})

test("users: an account is found by its email, opened, and given a staff role", async () => {
  const { email } = await registerCustomer("roles")

  await Checks.open(page, "/admin/users")
  await expect(page.getByRole("table", { name: "Accounts" }).getByRole("row").nth(1)).toBeVisible()
  await page.getByLabel("Exact email").fill(email)
  await page.getByRole("button", { name: "Find" }).click()
  await page.getByRole("link", { name: email }).click()

  await expect(page.getByRole("heading", { level: 1, name: email })).toBeVisible()
  await page.getByRole("checkbox", { name: /^Support/ }).check()
  await page.getByRole("button", { name: "Save roles" }).click()
  await page.getByRole("dialog", { name: "Change the staff roles?" }).getByRole("button", { name: "Save roles" }).click()
  await expect(page.getByRole("dialog", { name: "Change the staff roles?" })).toBeHidden()

  await expect
    .poll(async () => (await adminGet<{ items: { roles: string[] }[] }>(`/users?email=${encodeURIComponent(email)}`)).items[0]?.roles)
    .toEqual(["support"])
})

test("reviews: a review waiting in the queue is approved and published", async () => {
  const { token } = await registerCustomer("reviewer")
  const [product] = await Storefront.pickProducts(shopper, 1)
  const slug = product?.slug ?? ""
  const placed = await Storefront.placeOrder(shopper, product?.id ?? "", token)
  await waitUntilPaid(placed.orderId)
  await moveOrder(placed.orderId, { status: "processing" })
  await moveOrder(placed.orderId, { status: "shipped", trackingNumber: "PR123456789EE" })
  await moveOrder(placed.orderId, { status: "delivered" })
  const title = `Checked by the requirements ${Date.now()}`
  const written = await shopper.put(`/api/v1/products/${slug}/reviews/mine`, {
    headers: { authorization: `Bearer ${token}` },
    data: { rating: 5, authorName: "Req", title, body: "Exactly as pictured, and it arrived on time." },
  })
  expect(written.status(), await written.text()).toBe(200)

  await Checks.open(page, "/admin/reviews?status=pending")
  const item = page.getByRole("listitem").filter({ hasText: title })
  await item.getByRole("button", { name: `Approve the review of ${product?.name ?? ""}` }).click()

  await expect(page.getByText("The review is published.")).toBeVisible()
  await expect
    .poll(
      async () =>
        (await Storefront.fetchJson<{ items: { title?: string }[] }>(shopper, `/products/${slug}/reviews?sort=newest`)).items[0]?.title,
    )
    .toBe(title)
})

test("bulk upload: a CSV file is checked, then imported", async () => {
  const [product] = await Storefront.pickProducts(shopper, 1)
  const stamp = Date.now()
  const csv = [
    "slug,name,description,price,stock,category,brand,weight_g,width_mm,height_mm,depth_mm",
    `bulk-a-${stamp},Bulk Lamp A ${stamp},The first lamp of a bulk upload.,19.90,5,${product?.category.slug ?? ""},${product?.brand.slug ?? ""},500,100,200,100`,
    `bulk-b-${stamp},Bulk Lamp B ${stamp},The second lamp of a bulk upload.,24.90,3,${product?.category.slug ?? ""},${product?.brand.slug ?? ""},600,100,250,100`,
  ].join("\n")

  await Checks.open(page, "/admin/import")
  await page.getByLabel("CSV or JSON file").setInputFiles({ name: "lamps.csv", mimeType: "text/csv", buffer: Buffer.from(csv) })
  await page.getByRole("button", { name: "Check the file" }).click()
  await expect(page.getByRole("alert").filter({ hasText: "The file is ready to import" })).toContainText(
    "It would create 2 and update 0 products.",
  )

  await page.getByRole("button", { name: "Import", exact: true }).click()
  await page.getByRole("dialog", { name: "Import the file?" }).getByRole("button", { name: "Import" }).click()

  await expect(page.getByRole("alert").filter({ hasText: "The file is imported" })).toContainText("It created 2 and updated 0 products.")
  expect(await Storefront.fetchJson<ListedProduct>(shopper, `/products/bulk-b-${stamp}`)).toMatchObject({
    name: `Bulk Lamp B ${stamp}`,
    priceCents: 2490,
  })
})
