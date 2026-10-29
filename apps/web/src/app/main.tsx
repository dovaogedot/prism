/**
 * Router and providers. The route table is this list and nothing else; the
 * web server's Caddyfile lists the same paths, so an address outside them is
 * answered with status 404.
 */

import type { UserId } from "@prism/shared";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { GuestOnly } from "../features/auth/components/GuestOnly.tsx";
import { SignedInOnly } from "../features/auth/components/SignedInOnly.tsx";
import { CartPage } from "../features/cart/pages/CartPage.tsx";
import { ItemRedirect } from "../features/catalog/components/ItemRedirect.tsx";
import { ListingPage } from "../features/catalog/pages/ListingPage.tsx";
import { ProductPage } from "../features/catalog/pages/ProductPage.tsx";
import { HomePage } from "../features/home/pages/HomePage.tsx";
import { OrdersRedirect } from "../features/orders/components/OrdersRedirect.tsx";
import { AboutPage } from "../features/pages/pages/AboutPage.tsx";
import { FaqPage } from "../features/pages/pages/FaqPage.tsx";
import { NotFoundPage } from "../features/pages/pages/NotFoundPage.tsx";
import { PrivacyPage } from "../features/pages/pages/PrivacyPage.tsx";
import { TermsPage } from "../features/pages/pages/TermsPage.tsx";
import { ContactPage } from "../features/support/pages/ContactPage.tsx";
import { AdminAccess } from "../features/admin/admin.ts";
import { ApiError, NetworkError } from "../shared/api/client.ts";
import { TokenStore } from "../features/auth/token-store.ts";
import { AdminRoutes } from "./admin-routes.ts";
import { Root } from "./Root.tsx";
import "./styles.css";

/** What a failed query or mutation does besides showing it: an API refusal or a lost connection is expected, anything else is logged. */
const Faults = {
  log: (reason: unknown): void => {
    if (!(reason instanceof ApiError) && !(reason instanceof NetworkError)) console.error(reason);
  },
} as const;

const queryClient: QueryClient = new QueryClient({
  // A second factor that expires while the admin is open sends staff back to its gate.
  queryCache: new QueryCache({
    onError: (reason, query) => {
      Faults.log(reason);
      AdminAccess.onFailure(queryClient, reason, query.queryKey);
    },
  }),
  mutationCache: new MutationCache({
    onError: (reason) => {
      Faults.log(reason);
      AdminAccess.onFailure(queryClient, reason);
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

/** The account the query cache holds answers for. */
const CachedFor: { userId: UserId | undefined } = { userId: TokenStore.user()?.id };

// Another account in the tab starts from an empty cache, so nothing cached for
// the last one reaches the next: on sign-in, sign-out and an ended session alike.
TokenStore.subscribe(() => {
  const userId = TokenStore.user()?.id;

  if (userId !== CachedFor.userId) {
    CachedFor.userId = userId;
    queryClient.clear();
  }
});

const router = createBrowserRouter([
  {
    path: "/",
    element: <Root />,
    // Shown while the first page's own code loads: checkout, the account, an
    // order, the sign-in pages and the admin each load when first opened, so
    // browsing the catalog never downloads them.
    hydrateFallbackElement: <div className="min-h-dvh bg-canvas" />,
    children: [
      { index: true, element: <HomePage /> },

      // One listing behind three addresses. Each keeps its own element, so
      // moving between them starts the page afresh.
      { path: "shop", element: <ListingPage key="shop" kind="shop" /> },
      { path: "categories/:slug", element: <ListingPage key="category" kind="category" /> },
      { path: "search", element: <ListingPage key="search" kind="search" /> },
      { path: "products/:slug", element: <ProductPage /> },
      { path: "item/:slug", element: <ItemRedirect /> },
      { path: "cart", element: <CartPage /> },
      { path: "checkout", lazy: async () => ({ Component: (await import("../features/checkout/pages/CheckoutPage.tsx")).CheckoutPage }) },

      // `/orders` forwards to `/account/orders`. An order opens for its owner,
      // or for a guest with the key from its confirmation link.
      { path: "orders", element: <OrdersRedirect /> },
      { path: "orders/:id", lazy: async () => ({ Component: (await import("../features/orders/pages/OrderPage.tsx")).OrderPage }) },

      { path: "about", element: <AboutPage /> },
      { path: "contact", element: <ContactPage /> },
      { path: "faq", element: <FaqPage /> },
      { path: "terms", element: <TermsPage /> },
      { path: "privacy", element: <PrivacyPage /> },

      // Signing in when already signed in is a no-op with a form attached.
      {
        element: <GuestOnly />,
        children: [
          { path: "login", lazy: async () => ({ Component: (await import("../features/auth/pages/LoginPage.tsx")).LoginPage }) },
          { path: "login/2fa", lazy: async () => ({ Component: (await import("../features/auth/pages/TwoFactorPage.tsx")).TwoFactorPage }) },
          { path: "register", lazy: async () => ({ Component: (await import("../features/auth/pages/RegisterPage.tsx")).RegisterPage }) },
        ],
      },

      // Reachable while signed in: holding a session and having forgotten
      // the password are not mutually exclusive.
      { path: "forgot-password", lazy: async () => ({ Component: (await import("../features/auth/pages/ForgotPasswordPage.tsx")).ForgotPasswordPage }) },
      { path: "reset-password", lazy: async () => ({ Component: (await import("../features/auth/pages/ResetPasswordPage.tsx")).ResetPasswordPage }) },

      // Unguarded because it is the page that establishes the session.
      { path: "oauth/complete", lazy: async () => ({ Component: (await import("../features/auth/pages/OAuthCompletePage.tsx")).OAuthCompletePage }) },

      // A signed-out visitor signs in first and comes back.
      {
        element: <SignedInOnly />,
        children: [
          { path: "account", lazy: async () => ({ Component: (await import("../features/account/pages/ProfilePage.tsx")).ProfilePage }) },
          { path: "account/addresses", lazy: async () => ({ Component: (await import("../features/account/pages/AddressesPage.tsx")).AddressesPage }) },
          { path: "account/orders", lazy: async () => ({ Component: (await import("../features/orders/pages/OrdersPage.tsx")).OrdersPage }) },
        ],
      },

      AdminRoutes.ROUTE,

      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);

const container = document.getElementById("root");

if (container === null) {
  throw new Error("index.html is missing #root");
}

// Each page renders its own description, so the one index.html carries for readers that run no script goes.
document.getElementById("static-description")?.remove();

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
