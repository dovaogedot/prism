import { Navigate, useLocation } from "react-router";

/** Sends `/orders`, where bookmarks may still point, to `/account/orders`, keeping its filters. */
export const OrdersRedirect = () => {
  const { search } = useLocation();

  return <Navigate to={`/account/orders${search}`} replace />;
};
