import { Navigate, useParams } from "react-router"

/** Sends `/item/:slug` to `/products/:slug`. */
export const ItemRedirect = () => {
  const { slug = "" } = useParams()

  return <Navigate to={`/products/${slug}`} replace />
}
