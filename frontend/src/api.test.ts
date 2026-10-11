import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, eventsQuery, jobQuery, regionQuery } from "./api";
afterEach(() => vi.unstubAllGlobals());
describe("query and HTTP boundaries", () => {
  it("separates cached analyses and event pages", () => {
    expect(jobQuery("a").queryKey).not.toEqual(jobQuery("b").queryKey);
    expect(eventsQuery("a", 0).queryKey).not.toEqual(
      eventsQuery("a", 1).queryKey,
    );
  });
  it("does not search with too-short input", () => {
    expect(regionQuery("x").enabled).toBe(false);
    expect(regionQuery("Delhi").enabled).toBe(true);
  });
  it("passes cancellation to fetch", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    await api("/regions?q=Delhi", {}, controller.signal);
    expect(fetch.mock.calls[0][1].signal).toBe(controller.signal);
  });
  it("exposes safe server validation failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ detail: "Invalid range" }, { status: 422 }),
        ),
    );
    await expect(api("/analyses")).rejects.toEqual(
      new ApiError(422, "Invalid range"),
    );
  });
});
