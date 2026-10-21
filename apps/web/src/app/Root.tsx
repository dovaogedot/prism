import { useSessionBootstrap } from "../features/auth/session.ts";
import { Layout } from "../shared/layout/Layout.tsx";

/**
 * Holds the first paint until the refresh cookie has been exchanged, so the
 * header does not flash "Sign in" at somebody who is already signed in.
 */
export const Root = () => {
  const isReady = useSessionBootstrap();

  return isReady ? <Layout /> : <div className="min-h-dvh bg-canvas" />;
};
