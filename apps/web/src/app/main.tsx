/**
 * Router and providers.
 *
 * React Router in data mode — `createBrowserRouter` over a plain array of
 * route objects. No file-system routing convention; the route table is this
 * list and nothing else.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { Layout } from "../shared/layout/Layout.tsx";
import { useSessionBootstrap } from "../features/auth/session.ts";
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
import { CatalogPage } from "../features/catalog/pages/CatalogPage.tsx";
import { ProductPage } from "../features/catalog/pages/ProductPage.tsx";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The catalog changes rarely and the server already caches facets;
      // refetching on every window focus would be noise.
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

      /*
       * Deliberately reachable while signed in. Holding a session and having
       * forgotten your password are not mutually exclusive, and the account
       * page cannot help there — changing a password in place needs the
       * current one, which is precisely what has been forgotten.
       */
      { path: "forgot-password", element: <ForgotPasswordPage /> },
      { path: "reset-password", element: <ResetPasswordPage /> },

      // Unguarded because it is the page that establishes the session; a guard
      // would race the very refresh it is waiting for.
      { path: "oauth/complete", element: <OAuthCompletePage /> },

      // The mirror image: AccountPage sends a signed-out visitor to /login.
      { path: "account", element: <AccountPage /> },
      {
        path: "*",
        element: (
          <div className="grid min-h-[60dvh] place-items-center px-4 text-center">
            <div>
              <p className="text-lg font-semibold text-ink">
                No such page
              </p>
              <p className="mt-1 text-sm text-ink-soft">
                That color, category, or corridor does not exist.
              </p>
            </div>
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
