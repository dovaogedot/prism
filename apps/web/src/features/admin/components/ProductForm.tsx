import { ProductFields, type AdminBrand, type AdminCategory, type ProductInput } from "@prism/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState, type ReactNode } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { Api } from "../../../shared/api/client.ts";
import { Alert, Button, Card, Field, IssueList, SelectField, TextAreaField } from "../../../shared/ui/index.ts";
import { Failure } from "../../auth/components/failure.tsx";
import { ProductForm as ProductFormSchema, ServerIssues, Slugs } from "../forms.ts";

/** What the form starts from, what it chooses among, and what saving does. */
export type ProductFormProps = Readonly<{
  /** Absent for a new product. */
  initial?: ProductFormSchema;
  categories: readonly AdminCategory[];
  brands: readonly AdminBrand[];
  submitLabel: string;
  onSave: (product: ProductInput) => Promise<unknown>;
}>;

/**
 * A product's fields: what it is called and where it lives, what it costs
 * and how many there are, its measurements, its named properties, and
 * whether the home page features it. A new product's slug follows its name
 * until the slug is typed into.
 */
export const ProductForm = ({ initial, categories, brands, submitLabel, onSave }: ProductFormProps) => {
  const [failure, setFailure] = useState<ReactNode | undefined>(undefined);

  const [isSlugTyped, setSlugTyped] = useState(initial !== undefined);

  const form = useForm({
    resolver: zodResolver(ProductFormSchema.schema),
    defaultValues: initial ?? {
      name: "",
      slug: "",
      description: "",
      price: "",
      categoryId: categories[0]?.id ?? "",
      brandId: brands[0]?.id ?? "",
      properties: [],
      isFeatured: false,
    },
  });

  const properties = useFieldArray({ control: form.control, name: "properties" });

  const errors = form.formState.errors;
  const number = { valueAsNumber: true } as const;

  const submit = form.handleSubmit(async ({ price, ...rest }) => {
    setFailure(undefined);

    await onSave({ ...rest, priceCents: price }).catch((reason: unknown) => {
      const found = Api.failureOf(reason);
      if (found === undefined || found.issues.length === 0) {
        setFailure(Failure.message(reason));
        return;
      }
      const fields = ["name", "slug", "description", "price", "stock", "categoryId", "brandId", "weightGrams", "widthMm", "heightMm", "depthMm", "properties"];
      const unplaced = ServerIssues.place(found.issues, fields, form.setError, { priceCents: "price" });
      if (unplaced.length > 0) {
        setFailure(<IssueList issues={unplaced} />);
      }
    });
  });

  return (
    <form className="space-y-6" onSubmit={(event) => void submit(event)} noValidate>
      {failure === undefined ? null : <Alert>{failure}</Alert>}

      <Card className="space-y-4 p-5">
        <h2 className="font-semibold text-ink">The product</h2>
        <Field
          label="Name"
          id="product-name"
          error={errors.name?.message}
          {...form.register("name", {
            onChange: (event: { target: { value: string } }) => {
              if (isSlugTyped) return;

              form.setValue("slug", Slugs.fromName(event.target.value));
            },
          })}
        />
        <Field
          label="Slug"
          id="product-slug"
          hint="The product's address: /products/ and this."
          error={errors.slug?.message}
          {...form.register("slug", { onChange: () => setSlugTyped(true) })}
        />
        <TextAreaField label="Description" id="product-description" rows={6} error={errors.description?.message} {...form.register("description")} />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Category" id="product-category-id" error={errors.categoryId?.message} {...form.register("categoryId")}>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </SelectField>
          <SelectField label="Brand" id="product-brand-id" error={errors.brandId?.message} {...form.register("brandId")}>
            {brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </SelectField>
        </div>
        <label className="flex items-center gap-2.5 text-sm text-ink">
          <input className="size-4 accent-[var(--color-accent)]" type="checkbox" {...form.register("isFeatured")} />
          Feature it on the home page
        </label>
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="font-semibold text-ink">Price and stock</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Price in euros" id="product-price" inputMode="decimal" placeholder="12.50" error={errors.price?.message} {...form.register("price")} />
          <Field label="In stock" id="product-stock" type="number" min={0} error={errors.stock?.message} {...form.register("stock", number)} />
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="font-semibold text-ink">Measurements</h2>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Weight in grams" id="product-weight" type="number" min={1} error={errors.weightGrams?.message} {...form.register("weightGrams", number)} />
          <Field label="Width in mm" id="product-width" type="number" min={1} error={errors.widthMm?.message} {...form.register("widthMm", number)} />
          <Field label="Height in mm" id="product-height" type="number" min={1} error={errors.heightMm?.message} {...form.register("heightMm", number)} />
          <Field label="Depth in mm" id="product-depth" type="number" min={1} error={errors.depthMm?.message} {...form.register("depthMm", number)} />
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold text-ink">Properties</h2>
          <Button
            tone="quiet"
            type="button"
            disabled={properties.fields.length >= ProductFields.MAX_PROPERTIES}
            onClick={() => properties.append({ name: "", value: "" })}
          >
            Add a property
          </Button>
        </div>
        {errors.properties?.root?.message === undefined && errors.properties?.message === undefined ? null : (
          <p className="text-sm text-danger" role="alert">
            {errors.properties.root?.message ?? errors.properties.message}
          </p>
        )}
        {properties.fields.length === 0 ? <p className="text-sm text-ink-soft">No properties yet, such as a color or a material. The shop's filters are made from them.</p> : null}
        <ul className="space-y-3">
          {properties.fields.map((property, index) => (
            <li className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" key={property.id}>
              <Field label="Name" id={`property-${property.id}-name`} error={errors.properties?.[index]?.name?.message} {...form.register(`properties.${index}.name`)} />
              <Field label="Value" id={`property-${property.id}-value`} error={errors.properties?.[index]?.value?.message} {...form.register(`properties.${index}.value`)} />
              <Button tone="ghost" type="button" onClick={() => properties.remove(index)} aria-label={`Remove property ${index + 1}`}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      </Card>

      <Button type="submit" busy={form.formState.isSubmitting}>
        {submitLabel}
      </Button>
    </form>
  );
};
