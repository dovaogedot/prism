/**
 * Router and providers. The route table is this list and nothing else.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { GuestOnly } from "../features/auth/components/GuestOnly.tsx";
import {
  AccountPage,
  ForgotPasswordPage,
  LoginPage,
  OAuthCompletePage,
  RegisterPage,
  ResetPasswordPage,
  TwoFactorPage,
} from "../features/auth/pages/index.ts";
import { useSessionBootstrap } from "../features/auth/session.ts";
import { CatalogPage } from "../features/catalog/pages/CatalogPage.tsx";
import { ProductPage } from "../features/catalog/pages/ProductPage.tsx";
import { Layout } from "../shared/layout/Layout.tsx";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

/**
 * Holds the first paint until the refresh cookie has been exchanged, so the
 * header does not flash "Sign in" at somebody who is already signed in.
 */
const Root = () => {
  const ready = useSessionBootstrap();

  return ready ? <Layout /> : <div className="min-h-dvh bg-canvas" />;
};

const router = createBrowserRouter([
  {
    path: "/",
    element: <Root />,
    children: [
      { index: true, element: <CatalogPage /> },
      { path: "item/:slug", element: <ProductPage /> },

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

      // AccountPage sends a signed-out visitor to /login itself.
      { path: "account", element: <AccountPage /> },
      {
        path: "*",
        element: (
          <div className="grid min-h-[60dvh] place-items-center px-4 text-center">
            <p className="text-lg font-semibold text-ink">No such page</p>
          </div>
        ),
      },
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
