import { SupportMessageInput, SupportTopic } from "@prism/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router";
import { Api } from "../../../shared/api/client.ts";
import { PageMeta } from "../../../shared/seo/PageMeta.tsx";
import { PageText } from "../../../shared/seo/page-text.ts";
import { useTheme } from "../../../shared/theme/use-theme.ts";
import { Alert, Button, Field, SelectField, TextAreaField } from "../../../shared/ui/index.ts";
import { Captcha } from "../../auth/components/Captcha.tsx";
import { Failure } from "../../auth/components/failure.tsx";
import { useSession } from "../../auth/session.ts";

/**
 * The contact form: a name, an email to answer, a topic, the order it is
 * about if any, the message and the CAPTCHA. The message reaches support as
 * an email, and the sender gets a copy; nothing is stored in the shop.
 */
export const ContactPage = () => {
  const session = useSession();

  const { theme } = useTheme();

  const [failure, setFailure] = useState<ReactNode | undefined>(undefined);

  const [sentTo, setSentTo] = useState<string | undefined>(undefined);

  const form = useForm({
    resolver: zodResolver(SupportMessageInput.schema),
    defaultValues: { name: "", email: session?.email ?? "", topic: "order", orderNumber: "", message: "", captchaToken: "" },
  });

  const submit = form.handleSubmit(async (values) => {
    setFailure(undefined);

    await Api.postEmptyWithoutRetry("/support/messages", values)
      .then(() => setSentTo(values.email))
      .catch((reason: unknown) => setFailure(Failure.describe(reason)));
  });

  const errors = form.formState.errors;

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-14">
      <PageMeta title={PageText.contact.title} description={PageText.contact.description} />
      <header className="mb-8 space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">Contact us</h1>
        <p className="text-ink-soft">
          Questions about an order, a payment or your account? Write to us and we answer by email within two business days. Many
          answers are in the{" "}
          <Link className="text-accent underline underline-offset-2" to="/faq">
            FAQ
          </Link>{" "}
          already.
        </p>
      </header>

      {sentTo === undefined ? (
        <form className="space-y-5 rounded-lg border border-line bg-surface p-6" onSubmit={(event) => void submit(event)} noValidate>
          {failure === undefined ? null : <Alert>{failure}</Alert>}

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Your name" autoComplete="name" error={errors.name?.message} {...form.register("name")} />
            <Field label="Email address" type="email" autoComplete="email" error={errors.email?.message} {...form.register("email")} />
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <SelectField label="Topic" error={errors.topic?.message} {...form.register("topic")}>
              {SupportTopic.NAMES.map((topic) => (
                <option key={topic} value={topic}>
                  {SupportTopic.label[topic]}
                </option>
              ))}
            </SelectField>
            <Field
              label="Order number (optional)"
              inputMode="numeric"
              placeholder="100123"
              error={errors.orderNumber?.message}
              {...form.register("orderNumber")}
            />
          </div>

          <TextAreaField label="Message" rows={6} error={errors.message?.message} {...form.register("message")} />

          <div className="space-y-1.5">
            <Captcha dark={theme === "dark"} onToken={(token) => form.setValue("captchaToken", token, { shouldValidate: form.formState.isSubmitted })} />
            {errors.captchaToken?.message === undefined ? null : (
              <p className="text-sm text-danger" role="alert">
                {errors.captchaToken.message}
              </p>
            )}
          </div>

          <Button type="submit" busy={form.formState.isSubmitting}>
            Send message
          </Button>
        </form>
      ) : (
        <Alert tone="accent" title="Thank you, your message is on its way">
          We sent a copy to {sentTo}. We answer within two business days.
        </Alert>
      )}
    </div>
  );
};
