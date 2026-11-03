/** A value that follows `get()` after it has been stable for `ms` (for search inputs). */
export function debounced<T>(get: () => T, ms = 300): { readonly value: T } {
  let value = $state.raw<T>(get());
  $effect(() => {
    const next = get();
    if (Object.is(next, value)) return;
    const t = setTimeout(() => (value = next), ms);
    return () => clearTimeout(t);
  });
  return {
    get value() {
      return value;
    },
  };
}
