import { match, P } from "ts-pattern";
import { Skeleton } from "../../../shared/ui/index.ts";
import { ProductCard } from "../../catalog/components/ProductCard.tsx";
import { useRecommendations } from "../cart.ts";

/** "Recommended for you": products like the ones in the cart, or the best rated when it is empty. */
export const Recommendations = () => {
  const recommendations = useRecommendations();

  return (
    <section aria-labelledby="recommended" className="space-y-4">
      <h2 id="recommended" className="text-lg font-semibold text-ink">
        Recommended for you
      </h2>

      {match(recommendations)
        .with({ status: "error" }, () => (
          <p className="text-sm text-ink-faint">Recommendations are not available right now.</p>
        ))
        .with({ data: P.nullish }, () => (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="aspect-[3/4] w-full" />
            ))}
          </div>
        ))
        .with({ data: { items: [] } }, () => null)
        .otherwise(({ data }) => (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {data.items.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        ))}
    </section>
  );
};
