/**
 * Router and providers. The route table is this list and nothing else; the
 * web server's Caddyfile lists the same paths, so an address outside them is
 * answered with status 404.
 */

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { GuestOnly } from "../features/auth/components/GuestOnly.tsx";
import { AddressesPage } from "../features/account/pages/AddressesPage.tsx";
import { ProfilePage } from "../features/account/pages/ProfilePage.tsx";
import {
  ForgotPasswordPage,
  LoginPage,
  OAuthCompletePage,
  RegisterPage,
  ResetPasswordPage,
  TwoFactorPage,
} from "../features/auth/pages/index.ts";
import { CartPage } from "../features/cart/pages/CartPage.tsx";
import { ItemRedirect } from "../features/catalog/components/ItemRedirect.tsx";
import { ListingPage } from "../features/catalog/pages/ListingPage.tsx";
import { ProductPage } from "../features/catalog/pages/ProductPage.tsx";
import { CheckoutPage } from "../features/checkout/pages/CheckoutPage.tsx";
import { HomePage } from "../features/home/pages/HomePage.tsx";
import { OrderPage } from "../features/orders/pages/OrderPage.tsx";
import { OrdersPage } from "../features/orders/pages/OrdersPage.tsx";
import { AboutPage } from "../features/pages/pages/AboutPage.tsx";
import { FaqPage } from "../features/pages/pages/FaqPage.tsx";
import { NotFoundPage } from "../features/pages/pages/NotFoundPage.tsx";
import { PrivacyPage } from "../features/pages/pages/PrivacyPage.tsx";
import { TermsPage } from "../features/pages/pages/TermsPage.tsx";
import { ContactPage } from "../features/support/pages/ContactPage.tsx";
import { AdminAccess } from "../features/admin/admin.ts";
import { AdminRoutes } from "./admin-routes.ts";
import { Root } from "./Root.tsx";
import "./styles.css";

const queryClient: QueryClient = new QueryClient({
  // A second factor that expires while the admin is open sends staff back to its gate.
  queryCache: new QueryCache({ onError: (reason) => AdminAccess.onFailure(queryClient, reason) }),
  mutationCache: new MutationCache({ onError: (reason) => AdminAccess.onFailure(queryClient, reason) }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const router = createBrowserRouter([
  {
    path: "/",
    element: <Root />,
    // Shown while the first page's own code loads, which only the admin's pages need.
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
      { path: "checkout", element: <CheckoutPage /> },

      // OrdersPage sends a signed-out visitor to sign in itself. An order opens
      // for its owner, or for a guest with the key from its confirmation link.
      { path: "orders", element: <OrdersPage /> },
      { path: "orders/:id", element: <OrderPage /> },

      { path: "about", element: <AboutPage /> },
      { path: "contact", element: <ContactPage /> },
      { path: "faq", element: <FaqPage /> },
      { path: "terms", element: <TermsPage /> },
      { path: "privacy", element: <PrivacyPage /> },

      // Signing in when already signed in is a no-op with a form attached.
      {
        element: <GuestOnly />,
        children: [
          { path: "login", element: <LoginPage /> },
          { path: "login/2fa", element: <TwoFactorPage /> },
          { path: "register", element: <RegisterPage /> },
        ],
      },

      // Reachable while signed in: holding a session and having forgotten
      // the password are not mutually exclusive.
      { path: "forgot-password", element: <ForgotPasswordPage /> },
      { path: "reset-password", element: <ResetPasswordPage /> },

      // Unguarded because it is the page that establishes the session.
      { path: "oauth/complete", element: <OAuthCompletePage /> },

      // Both send a signed-out visitor to sign in themselves.
      { path: "account", element: <ProfilePage /> },
      { path: "account/addresses", element: <AddressesPage /> },

      AdminRoutes.ROUTE,

      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);

const container = document.getElementById("root");

if (container === null) {
  throw new Error("index.html is missing #root");
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
