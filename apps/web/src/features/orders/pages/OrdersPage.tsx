import { Link, useSearchParams } from "react-router";
import { match, P } from "ts-pattern";
import { Alert, Button, Card, Skeleton } from "../../../shared/ui/index.ts";
import { Failure } from "../../auth/components/failure.tsx";
import { SignInFirst } from "../../auth/components/SignInFirst.tsx";
import { useSession } from "../../auth/session.ts";
import { CatalogParams } from "../../catalog/filters.ts";
import { OrderFilters, OrderRow } from "../components/index.ts";
import { OrderParams, useOrders } from "../orders.ts";
import { PageMeta } from "../../../shared/seo/PageMeta.tsx";
import { PageText } from "../../../shared/seo/page-text.ts";

/** The signed-in customer's orders, filtered by status and date and sorted as the URL says. */
export const OrdersPage = () => {
  const session = useSession();

  const [params, setParams] = useSearchParams();

  const query = params.toString();

  const orders = useOrders(query, session !== undefined);

  if (session === undefined) return <SignInFirst />;

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
      <PageMeta title={PageText.orders.title} description={PageText.orders.description} isIndexed={false} />
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Your orders</h1>

      <OrderFilters />

      {match(orders)
        .with({ status: "error" }, ({ error }) => <Alert>{Failure.describe(error)}</Alert>)
        .with({ data: P.nullish }, () => (
          <div className="space-y-3">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-20 w-full" />
            ))}
          </div>
        ))
        .with({ data: { items: [] } }, () => (
          <Card className="space-y-2 p-8 text-center">
            <p className="text-ink">
              {OrderParams.isFiltered(params) ? "No orders match these filters." : "You have not ordered anything yet."}
            </p>
            <Link to="/" className="text-sm font-medium text-accent hover:underline">
              Browse the shop
            </Link>
          </Card>
        ))
        .otherwise(({ data }) => (
          <div className="space-y-4">
            <ul className={`space-y-3 transition-opacity ${orders.isPlaceholderData ? "opacity-60" : ""}`}>
              {data.items.map((order) => (
                <OrderRow key={order.id} order={order} />
              ))}
            </ul>

            {data.totalPages <= 1 ? null : (
              <nav aria-label="Pages" className="flex items-center justify-between">
                <Button
                  type="button"
                  tone="quiet"
                  disabled={data.page <= 1}
                  onClick={() => setParams(CatalogParams.set(params, "page", String(data.page - 1)))}
                >
                  Previous
                </Button>
                <span className="text-sm text-ink-soft">
                  Page {data.page} of {data.totalPages}
                </span>
                <Button
                  type="button"
                  tone="quiet"
                  disabled={data.page >= data.totalPages}
                  onClick={() => setParams(CatalogParams.set(params, "page", String(data.page + 1)))}
                >
                  Next
                </Button>
              </nav>
            )}
          </div>
        ))}
    </div>
  );
};
