import { useIsMutating } from "@tanstack/react-query";
import { useEffect, useState } from "react";

/**
 * A page's message about its last failed action, and how to set it. It
 * clears as soon as another action starts, so a later success never shows
 * under an old failure.
 */
export const useActionFailure = () => {
  const [failure, setFailure] = useState<string | undefined>(undefined);

  const isActing = useIsMutating() > 0;

  useEffect(() => {
    if (isActing) {
      setFailure(undefined);
    }
  }, [isActing]);

  return [failure, setFailure] as const;
};
