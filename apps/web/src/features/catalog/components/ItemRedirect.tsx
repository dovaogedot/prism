import { Navigate, useParams } from "react-router";

/** Sends the product address of earlier emails and links, `/item/:slug`, to `/products/:slug`. */
export const ItemRedirect = () => {
  const { slug = "" } = useParams();

  return <Navigate to={`/products/${slug}`} replace />;
};
