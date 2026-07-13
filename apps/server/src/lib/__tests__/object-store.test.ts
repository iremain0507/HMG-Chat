import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createInMemoryObjectStore,
  createLocalObjectStore,
} from "../object-store.js";

const impls = {
  "in-memory": () => createInMemoryObjectStore(),
  local: () => createLocalObjectStore(mkdtempSync(join(tmpdir(), "objstore-"))),
};

for (const [label, make] of Object.entries(impls)) {
  describe(`ObjectStore (${label})`, () => {
    it("put→get 라운드트립", async () => {
      const s = make();
      await s.put("uploads/a.bin", Buffer.from("hello"));
      expect((await s.get("uploads/a.bin")).toString()).toBe("hello");
    });

    it("exists / remove", async () => {
      const s = make();
      await s.put("k", Buffer.from("x"));
      expect(await s.exists("k")).toBe(true);
      await s.remove("k");
      expect(await s.exists("k")).toBe(false);
    });

    it("없는 key get → throw", async () => {
      const s = make();
      await expect(s.get("nope")).rejects.toThrow();
    });
  });
}

describe("createLocalObjectStore 경로 탈출 차단", () => {
  it("../ key 거부", async () => {
    const s = createLocalObjectStore(mkdtempSync(join(tmpdir(), "objstore-")));
    await expect(s.put("../escape", Buffer.from("x"))).rejects.toThrow();
  });
});
