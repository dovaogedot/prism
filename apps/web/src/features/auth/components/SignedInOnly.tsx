import { Outlet } from "react-router";
import { useSession } from "../session.ts";
import { SignInFirst } from "./SignInFirst.tsx";

/**
 * A pathless layout route for pages that need a signed-in visitor. A guest,
 * or a visitor whose session ends while one of them is open, is sent to sign
 * in first and comes back afterwards.
 */
export const SignedInOnly = () => {
  const session = useSession();

  return session === undefined ? <SignInFirst /> : <Outlet />;
};
