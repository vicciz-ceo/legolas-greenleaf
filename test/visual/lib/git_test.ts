import { assertEquals, assertMatch } from "@std/assert";
import { currentSha, isDirty } from "./git.ts";

// Runs against the actual CI checkout — no mocking, since a git repo is
// already guaranteed to exist wherever this test runs (the checkout
// itself). Testing the contract (shape of the return value), not a fixed
// expected SHA, since that changes every commit.

Deno.test("currentSha returns a short hex SHA", async () => {
  const sha = await currentSha();
  assertMatch(sha, /^[0-9a-f]{7,40}$/);
});

Deno.test("isDirty reflects actual working-tree state", async () => {
  const before = await isDirty();
  assertEquals(before, false); // CI checkouts start clean

  const marker = ".git-dirty-test-marker";
  await Deno.writeTextFile(marker, "temp");
  try {
    assertEquals(await isDirty(), true);
  } finally {
    await Deno.remove(marker);
  }

  assertEquals(await isDirty(), false); // confirms cleanup actually worked
});
