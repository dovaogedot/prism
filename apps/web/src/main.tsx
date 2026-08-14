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
import { Layout } from "./components/Layout.tsx";
import { useSessionBootstrap } from "./lib/session.ts";
import { AccountPage } from "./routes/account.tsx";
import {
  ForgotPasswordPage,
  LoginPage,
  OAuthCompletePage,
  RegisterPage,
  ResetPasswordPage,
  TwoFactorPage,
} from "./routes/auth.tsx";
import { CataloguePage } from "./routes/catalogue.tsx";
import { ProductPage } from "./routes/product.tsx";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The catalogue changes rarely and the server already caches facets;
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
      { index: true, element: <CataloguePage /> },
      { path: "colour/:slug", element: <ProductPage /> },
      { path: "login", element: <LoginPage /> },
      { path: "login/2fa", element: <TwoFactorPage /> },
      { path: "register", element: <RegisterPage /> },
      { path: "forgot-password", element: <ForgotPasswordPage /> },
      { path: "reset-password", element: <ResetPasswordPage /> },
      { path: "oauth/complete", element: <OAuthCompletePage /> },
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
                That colour, category, or corridor does not exist.
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
