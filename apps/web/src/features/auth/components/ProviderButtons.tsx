import { OAuthProvider, type AvailableProviders } from "@prism/shared";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { match, P } from "ts-pattern";
import { Api } from "../../../shared/api/client.ts";
import { NextPath } from "../next-path.ts";

/** Each provider's mark, as its button shows it. */
const ProviderMark = {
  google: (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path fill="#4285F4" d="M23 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.2a5.3 5.3 0 0 1-2.3 3.5v2.9h3.7C21.7 18.9 23 15.9 23 12.3z" />
      <path fill="#34A853" d="M12 24c3.1 0 5.7-1 7.6-2.8l-3.7-2.9c-1 .7-2.3 1.1-3.9 1.1-3 0-5.5-2-6.4-4.7H1.8v3C3.7 21.4 7.6 24 12 24z" />
      <path fill="#FBBC05" d="M5.6 14.7a7.2 7.2 0 0 1 0-4.6v-3H1.8a12 12 0 0 0 0 10.6l3.8-3z" />
      <path fill="#EA4335" d="M12 4.8c1.7 0 3.2.6 4.4 1.7l3.3-3.3C17.7 1.2 15.1 0 12 0 7.6 0 3.7 2.6 1.8 6.1l3.8 3c.9-2.7 3.4-4.3 6.4-4.3z" />
    </svg>
  ),
  github: (
    <svg viewBox="0 0 16 16" className="size-4" fill="currentColor" aria-hidden="true">
      <path d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38l-.01-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.93-.89-1.18-.89-1.18-.73-.5.05-.49.05-.49.8.06 1.23.83 1.23.83.72 1.23 1.88.87 2.34.67.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.03 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48l-.01 2.2c0 .21.14.46.55.38A8 8 0 0 0 8 0z" />
    </svg>
  ),
} as const satisfies Record<OAuthProvider, ReactNode>;

/** Where the sign-in returns to once the provider sends the visitor back. */
export type ProviderButtonsProps = Readonly<{ next: string }>;

/**
 * The buttons come from `GET /auth/oauth/providers`, so an instance configured
 * with only GitHub credentials does not offer a Google button that cannot work.
 */
export const ProviderButtons = ({ next }: ProviderButtonsProps) => {
  const available = useQuery({
    queryKey: ["oauth-providers"],
    queryFn: ({ signal }) => Api.get<AvailableProviders>("/auth/oauth/providers", signal),
    staleTime: Number.POSITIVE_INFINITY,
  });

  return match(available.data)
    .with(P.nullish, () => null)
    .when(
      (data) => data.providers.length === 0,
      () => null,
    )
    .otherwise((data) => (
      <>
        <div className="space-y-2">
          {data.providers.map((provider) => (
            <a
              key={provider}
              href={`${Api.BASE}/auth/oauth/${provider}`}
              // The provider's sign-in leaves the site; the path waits for the return.
              onClick={() => NextPath.remember(next)}
              className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-line-strong hover:bg-sunken"
            >
              {ProviderMark[provider]}
              Continue with {OAuthProvider.label[provider]}
            </a>
          ))}
        </div>

        {match(data.mock)
          .with(true, () => (
            <p className="mt-2 text-center text-xs text-ink-faint">
              Running against the offline stand-in. No third-party account needed.
            </p>
          ))
          .with(false, () => null)
          .exhaustive()}

        <div className="my-5 flex items-center gap-3">
          <span className="h-px flex-1 bg-line" />
          <span className="text-xs uppercase tracking-wider text-ink-faint">or</span>
          <span className="h-px flex-1 bg-line" />
        </div>
      </>
    ));
};
