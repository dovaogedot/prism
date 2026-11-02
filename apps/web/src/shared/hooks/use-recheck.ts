import { useEffect } from "react"
import { useWatch, type FieldValues, type Path, type UseFormReturn } from "react-hook-form"

/**
 * Checks `dependent` again whenever `source` changes, once the customer has
 * left `dependent` or sent the form: its message follows the field it depends
 * on, and never shows on a field the customer has not reached yet.
 */
export const useRecheck = <Values extends FieldValues, Context, Output>(
  form: UseFormReturn<Values, Context, Output>,
  source: Path<Values>,
  dependent: Path<Values>,
): void => {
  const value = useWatch({ control: form.control, name: source })

  useEffect(() => {
    if (form.getFieldState(dependent, form.formState).isTouched || form.formState.isSubmitted) void form.trigger(dependent)
    // Only a change of `source` asks for the check; the form itself is the same object on every render.
  }, [value])
}
