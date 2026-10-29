import type { ShippingOption } from "@prism/shared";
import { useQuery } from "@tanstack/react-query";
import { Api } from "./client.ts";

export const ShippingOptionKeys = {
  /** The query key of the delivery options checkout offers. */
  all: ["shipping-methods"] as const,
} as const;

/** The delivery options checkout offers, in their order. */
export const useShippingOptions = () =>
  useQuery({
    queryKey: ShippingOptionKeys.all,
    queryFn: async ({ signal }) => (await Api.getPublic<{ items: readonly ShippingOption[] }>("/shipping-methods", signal)).items,
    staleTime: 60_000,
  });
