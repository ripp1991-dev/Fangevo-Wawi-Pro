import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '../lib/api';

/** Kleiner Helfer: Formular abschicken, Feld- und Gesamtfehler aus der API anzeigen. */
export function useSubmit<TIn, TOut>(
  fn: (input: TIn) => Promise<TOut>,
  onSuccess?: (out: TOut) => void | Promise<void>,
) {
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: fn,
    onMutate: () => {
      setFieldErrors({});
      setError(null);
    },
    onSuccess: async (out) => {
      await onSuccess?.(out);
    },
    onError: (e) => {
      if (e instanceof ApiError) {
        setFieldErrors(e.fieldErrors);
        setError(e.message);
      } else setError('Ein unerwarteter Fehler ist aufgetreten.');
    },
  });
  return {
    submit: m.mutate,
    submitAsync: m.mutateAsync,
    pending: m.isPending,
    error,
    fieldErrors,
    reset: () => setError(null),
  };
}

export function formData(e: React.FormEvent<HTMLFormElement>): Record<string, string> {
  e.preventDefault();
  return Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
}
