/**
 * The title and description of every page whose words are written by hand
 * rather than built from data. Each description is 155 to 160 characters and
 * each title is unique, which `tests/page-text.test.ts` checks.
 */

/** A page's own part of the title, and its meta description. */
export type PageText = Readonly<{ title: string; description: string }>;

export const PageText = {
  home: {
    title: "Collectible pixel-art game items",
    description:
      "Prism sells collectible pixel-art items from the games you love: swords, jokers, trinkets and blocks, all rated by real players and delivered across Europe.",
  },
  shop: {
    title: "All products",
    description:
      "Browse every item in the Prism catalog. Filter by game, price, rating and properties, sort by price or rating, and switch between a grid view and a list view.",
  },
  search: {
    title: "Search",
    description:
      "Search results from the Prism catalog. Matching names come first, descriptions next, and a misspelled search still finds the items whose names look similar.",
  },
  about: {
    title: "About us",
    description:
      "Prism is a small online shop for collectible pixel-art game items, run by four people in Tallinn. Read who we are, what we care about and where to find us.",
  },
  contact: {
    title: "Contact us",
    description:
      "Write to the Prism support team about an order, a payment, the delivery, returns or your account. We answer every message by email within two business days.",
  },
  faq: {
    title: "Frequently asked questions",
    description:
      "Answers to common questions about Prism: shipping methods and their prices, delivery times, card payments, order tracking, returns within 14 days and refunds.",
  },
  terms: {
    title: "Terms of service",
    description:
      "The terms of service for shopping at Prism: orders and prices, card payment, delivery, returns within 14 days, refunds, reviews, accounts and our liability.",
  },
  privacy: {
    title: "Privacy policy",
    description:
      "How Prism handles your personal data: what we keep and why, how long we keep it, how it is encrypted and protected at rest, and the rights you have over it.",
  },
  cart: {
    title: "Your cart",
    description:
      "Your Prism shopping cart. Change the quantities, remove items, see how far the order is from free shipping, and go on to a secure checkout when you are ready.",
  },
  checkout: {
    title: "Checkout",
    description:
      "Check out at Prism: enter your contact details and address, choose a delivery option with its dates, and pay securely by card. Guests are welcome to buy too.",
  },
  orders: {
    title: "Your orders",
    description:
      "Your orders at Prism, newest first. Filter them by status, follow each order from payment to delivery, and open any one to see its items, address and tracking.",
  },
  order: {
    title: "Your order",
    description:
      "The details of your Prism order: its number and payment reference, the items you bought, the delivery address and estimated dates, and how far along it is now.",
  },
  account: {
    title: "Your account",
    description:
      "Your Prism account: update your full name and phone number, change your password, turn on two-factor sign-in, and see all the ways you can sign in to the shop.",
  },
  addresses: {
    title: "Your addresses",
    description:
      "Your saved addresses at Prism. Add up to ten places you often ship to, choose the one checkout starts with, and edit or remove any of them whenever you like.",
  },
  login: {
    title: "Sign in",
    description:
      "Sign in to your Prism account with your email and password, or with Google or GitHub, to check out faster, follow your orders and review the items you bought.",
  },
  twoFactor: {
    title: "Two-factor code",
    description:
      "Finish signing in to Prism with the six-digit code from your authenticator app. Two-factor sign-in keeps your account safe even if your password ever leaks.",
  },
  register: {
    title: "Create an account",
    description:
      "Create a Prism account with your email and a password, or with Google or GitHub. An account keeps your orders, saved addresses and your reviews in one place.",
  },
  forgotPassword: {
    title: "Reset your password",
    description:
      "Forgot your Prism password? Enter the email address of your account and we will send you a link to choose a new one. The link works only once and soon expires.",
  },
  resetPassword: {
    title: "Choose a new password",
    description:
      "Choose a new password for your Prism account with the link we emailed you. Once it is saved, you sign in with the new password from then on, on every device.",
  },
  oauth: {
    title: "Signing you in",
    description:
      "Signing you in to Prism through your Google or GitHub account. This page finishes the sign-in and then takes you straight back to where you were in the shop.",
  },
  notFound: {
    title: "Page not found",
    description:
      "This page does not exist at Prism. It may have moved, or the link may be mistyped. Search the catalog, browse the categories or go back to the shop's home page.",
  },
  adminDashboard: {
    title: "Dashboard - Admin",
    description:
      "The Prism admin at a glance: orders waiting to be fulfilled, reviews waiting for a moderator, products running low on stock, and the orders paid for today.",
  },
  adminOrders: {
    title: "Orders - Admin",
    description:
      "Every order placed at Prism, for the staff who handle them: filter by status, date, number or email, and open one to move it along, cancel it or refund it.",
  },
  adminOrder: {
    title: "Order - Admin",
    description:
      "One Prism order as staff see it: its lines, contact and addresses, its payment and refund, its history, and the next step of fulfillment it is ready for now.",
  },
  adminProducts: {
    title: "Products - Admin",
    description:
      "The Prism catalog for its content managers: find products by name or slug, filter by category, brand, featuring or low stock, and open any one to change it.",
  },
  adminProductEdit: {
    title: "Edit product - Admin",
    description:
      "Edit a Prism product: its name, slug, price, stock, category, brand, measurements, named properties and its pictures, and whether the home page features it.",
  },
  adminProductNew: {
    title: "New product - Admin",
    description:
      "Add a product to the Prism catalog: its name, slug, description, price, stock, category and brand, its measurements and named properties, and then its pictures.",
  },
  adminCategories: {
    title: "Categories - Admin",
    description:
      "The categories of the Prism catalog: add a new one, rename one, describe it for its own page, or delete one that no product is filed under any longer at all.",
  },
  adminBrands: {
    title: "Brands - Admin",
    description:
      "The brands of the Prism catalog: add one, rename it, change its slug, or delete one that no product carries any longer. Each product names its brand by it.",
  },
  adminImport: {
    title: "Import products - Admin",
    description:
      "Bulk import products into the Prism catalog from a CSV or JSON file: check the whole file first, see every problem by row and column, then write it all at once.",
  },
  adminReviews: {
    title: "Reviews - Admin",
    description:
      "The review moderation queue of the Prism shop: read what each customer wrote, approve it so it appears, reject it with a reason for its author, or delete it.",
  },
  adminShipping: {
    title: "Delivery options - Admin",
    description:
      "The delivery options Prism offers at checkout: their names, prices, free-shipping thresholds and delivery windows, their order, and which of them are offered.",
  },
  adminUsers: {
    title: "Accounts - Admin",
    description:
      "The accounts of the Prism shop: find a customer by email, list the staff by role, and open an account to see its orders or change what its holder may do there.",
  },
  adminUser: {
    title: "Account - Admin",
    description:
      "One Prism account as staff see it: its sign-in methods, second factor, sessions and recent orders, with its staff roles, and disabling it or signing it out.",
  },
  adminAudit: {
    title: "Audit log - Admin",
    description:
      "The Prism audit log: every change staff made, who made it and when, from where, and what each field was before and after, filtered by person, action or date.",
  },
  adminSetup: {
    title: "Set up two-factor authentication",
    description:
      "Staff accounts at Prism need two-factor authentication before the admin opens. Scan the code with an authenticator app and type the code it shows to finish.",
  },
  adminVerify: {
    title: "Confirm it is you",
    description:
      "The Prism admin asks staff for a current code from their authenticator app every few hours. Type the six digits the app shows now to open the admin once more.",
  },
  adminForbidden: {
    title: "Staff only",
    description:
      "The Prism admin is for the shop's staff: moderators, content and delivery managers, support and admins. Customers find their orders and their account elsewhere.",
  },
} as const satisfies Record<string, PageText>;
