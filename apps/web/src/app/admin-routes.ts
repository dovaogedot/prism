/**
 * The admin's route table. Each page is its own chunk, loaded when it is
 * first opened, so a shopper's browser never downloads the admin. The paths
 * are those of the admin's sections in `features/admin/admin.ts`.
 */

import type { RouteObject } from "react-router";

export const AdminRoutes = {
  ROUTE: {
    path: "admin",
    lazy: async () => ({ Component: (await import("../features/admin/components/AdminLayout.tsx")).AdminLayout }),
    children: [
      { index: true, lazy: async () => ({ Component: (await import("../features/admin/pages/DashboardPage.tsx")).DashboardPage }) },
      { path: "orders", lazy: async () => ({ Component: (await import("../features/admin/pages/OrdersPage.tsx")).OrdersPage }) },
      { path: "orders/:id", lazy: async () => ({ Component: (await import("../features/admin/pages/OrderPage.tsx")).OrderPage }) },
      { path: "products", lazy: async () => ({ Component: (await import("../features/admin/pages/ProductsPage.tsx")).ProductsPage }) },
      { path: "products/:id", lazy: async () => ({ Component: (await import("../features/admin/pages/ProductEditPage.tsx")).ProductEditPage }) },
      { path: "categories", lazy: async () => ({ Component: (await import("../features/admin/pages/CategoriesPage.tsx")).CategoriesPage }) },
      { path: "brands", lazy: async () => ({ Component: (await import("../features/admin/pages/BrandsPage.tsx")).BrandsPage }) },
      { path: "import", lazy: async () => ({ Component: (await import("../features/admin/pages/ImportPage.tsx")).ImportPage }) },
      { path: "reviews", lazy: async () => ({ Component: (await import("../features/admin/pages/ReviewsPage.tsx")).ReviewsPage }) },
      { path: "shipping", lazy: async () => ({ Component: (await import("../features/admin/pages/ShippingMethodsPage.tsx")).ShippingMethodsPage }) },
      { path: "users", lazy: async () => ({ Component: (await import("../features/admin/pages/UsersPage.tsx")).UsersPage }) },
      { path: "users/:id", lazy: async () => ({ Component: (await import("../features/admin/pages/UserPage.tsx")).UserPage }) },
      { path: "audit", lazy: async () => ({ Component: (await import("../features/admin/pages/AuditPage.tsx")).AuditPage }) },
      { path: "*", lazy: async () => ({ Component: (await import("../features/pages/pages/NotFoundPage.tsx")).NotFoundPage }) },
    ],
  } satisfies RouteObject,
} as const;
