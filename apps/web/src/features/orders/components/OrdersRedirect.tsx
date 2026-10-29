import { Navigate, useLocation } from "react-router";

/** Sends `/orders` to `/account/orders`, keeping its filters. */
export const OrdersRedirect = () => {
  const { search } = useLocation();

  return <Navigate to={`/account/orders${search}`} replace />;
};
