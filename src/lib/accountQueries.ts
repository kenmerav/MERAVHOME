import type { QueryClient } from "@tanstack/react-query";

export async function resetAccountQueries(queryClient: QueryClient) {
  // Cancel first: an old account's in-flight response must not refill the cache.
  await queryClient.cancelQueries();
  queryClient.clear();
}
