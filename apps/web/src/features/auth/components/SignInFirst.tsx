import { Navigate, useLocation } from "react-router";
import { NextPath } from "../next-path.ts";

/** Sends a signed-out visitor to sign in, and back to this page afterwards. */
export const SignInFirst = () => {
  const { pathname, search } = useLocation();

  return <Navigate to={`/login${NextPath.query(`${pathname}${search}`)}`} replace />;
};
