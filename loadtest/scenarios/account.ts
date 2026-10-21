/** A new customer: registers, signs in, reads their account, and refreshes the session. */

import { Shop } from "../lib/shop.ts";

export const Account = {
  run: (): void => {
    Shop.forget();
    const email = `account-${__VU}-${__ITER}-${Date.now()}@example.com`;
    const password = "correct horse battery staple";

    Shop.step("register", () => Shop.isOk(Shop.call("POST", "/auth/register", "register", { body: { email, password, captchaToken: "load" } }), "register"));
    Shop.think();

    Shop.forget();
    const session: { token?: string } = {};
    Shop.step("sign in", () => {
      const answer = Shop.call("POST", "/auth/login", "sign in", { body: { email, password } });
      if (!Shop.isOk(answer, "sign in")) return false;

      session.token = (JSON.parse(answer.body as string) as Readonly<{ grant: Readonly<{ accessToken: string }> }>).grant.accessToken;
      return true;
    });
    Shop.think();

    const token = session.token;
    if (token === undefined) return;

    Shop.step("read account", () => Shop.isOk(Shop.call("GET", "/auth/me", "me", { token }), "me"));
    Shop.think();
    Shop.step("refresh session", () => Shop.isOk(Shop.call("POST", "/auth/refresh", "refresh"), "refresh"));
    Shop.think();
  },
} as const;
