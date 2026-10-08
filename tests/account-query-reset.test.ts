import { QueryClient } from "@tanstack/react-query";
import { expect, it } from "vitest";
import { resetAccountQueries } from "@/lib/accountQueries";

it("discards cached and in-flight project data before the next account renders", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["projects"], [{ name: "Previous user's project" }]);
  client.setQueryData(["currentUserProfile"], { id: "old-admin" });
  let complete!: (data: unknown) => void;
  const pending = client
    .fetchQuery({
      queryKey: ["private-documents"],
      queryFn: () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    })
    .catch(() => undefined);
  await resetAccountQueries(client);
  complete(["Old private document"]);
  await pending;
  expect(client.getQueryCache().getAll()).toEqual([]);
  client.setQueryData(["projects"], [{ name: "New user's own project" }]);
  expect(client.getQueryData(["projects"])).toEqual([{ name: "New user's own project" }]);
});
