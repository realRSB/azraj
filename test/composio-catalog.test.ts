import { describe, expect, it, vi } from "vitest";
import {
  collectToolkitCatalog,
  composioUserIdForConversation,
  composioUserIdForPhone,
} from "../server/composio.js";

describe("Composio toolkit catalog pagination", () => {
  it("collects every page and maps API metadata", async () => {
    const fetchPage = vi.fn(async (cursor?: string) => {
      if (!cursor) {
        return {
          items: [
            {
              slug: "alpha",
              name: "Alpha",
              meta: {
                logo: "https://example.test/alpha.png",
                description: "First toolkit",
                tools_count: 12,
              },
            },
          ],
          nextCursor: "page-2",
        };
      }
      return {
        items: [
          {
            slug: "beta",
            name: "Beta",
            meta: { tools_count: 7 },
          },
        ],
        nextCursor: null,
      };
    });

    const catalog = await collectToolkitCatalog(fetchPage);

    expect(fetchPage).toHaveBeenNthCalledWith(1, undefined);
    expect(fetchPage).toHaveBeenNthCalledWith(2, "page-2");
    expect([...catalog.keys()]).toEqual(["alpha", "beta"]);
    expect(catalog.get("alpha")).toMatchObject({
      description: "First toolkit",
      toolsCount: 12,
    });
    expect(catalog.get("beta")?.toolsCount).toBe(7);
  });

  it("rejects a repeated cursor instead of looping forever", async () => {
    const fetchPage = vi.fn(async () => ({ items: [], nextCursor: "same-page" }));

    await expect(collectToolkitCatalog(fetchPage)).rejects.toThrow("repeated cursor");
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });
});

describe("Composio public user scoping", () => {
  it("maps a phone number to a stable non-phone Composio user id", () => {
    vi.stubEnv("PUBLIC_AUTH_SECRET", "test-secret");

    const first = composioUserIdForPhone("+17862139361");
    const second = composioUserIdForPhone("+17862139361");

    expect(first).toBe(second);
    expect(first).toMatch(/^azraj-[a-f0-9]{32}$/);
    expect(first).not.toContain("17862139361");
  });

  it("derives user scope only for sms phone conversations", () => {
    vi.stubEnv("PUBLIC_AUTH_SECRET", "test-secret");

    expect(composioUserIdForConversation("sms:+17862139361")).toBe(
      composioUserIdForPhone("+17862139361"),
    );
    expect(composioUserIdForConversation("web:demo")).toBeUndefined();
    expect(composioUserIdForConversation(undefined)).toBeUndefined();
  });
});
