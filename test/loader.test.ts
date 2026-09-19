import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJson, isUrl, loadDataset } from "../src/surveycore/loader";
import { fixture, interpreter, MemoryIO } from "./helpers";

describe("loader", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("detects URLs", () => {
    expect(isUrl("https://x.test/a.json")).toBe(true);
    expect(isUrl("HTTP://x")).toBe(true);
    expect(isUrl("./a.json")).toBe(false);
    expect(isUrl("C:/a.json")).toBe(false);
  });

  it("routes URLs to fetchJson and paths to readJson", async () => {
    const io = new MemoryIO({ "s.json": fixture("survey.json") }, { "https://api.test/results": { Data: fixture("responses.json") } });
    const ds = await loadDataset(io, "s.json", "https://api.test/results");
    expect(ds.rows.length).toBe(20);
  });

  it("works through the load command with URLs and reports failures", async () => {
    const io = new MemoryIO({}, { "https://api.test/survey": fixture("survey.json"), "https://api.test/data": fixture("responses.json") });
    const { interp } = interpreter({ preload: false, io });
    const [ok, bad] = await interp.run("load https://api.test/survey https://api.test/data\nload https://api.test/missing");
    expect(ok.value).toEqual({ kind: "message", text: "Loaded 20 responses, 8 questions" });
    expect(bad.error?.message).toMatch(/cannot load 'https:\/\/api.test\/missing': HTTP 404/);
  });

  it("fetchJson surfaces HTTP status and invalid JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/404")) return new Response("nope", { status: 404 });
        if (url.endsWith("/bad")) return new Response("not json", { status: 200 });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );
    await expect(fetchJson("https://x.test/404")).rejects.toThrow(/HTTP 404/);
    await expect(fetchJson("https://x.test/bad")).rejects.toThrow(/did not return valid JSON/);
    await expect(fetchJson("https://x.test/good")).resolves.toEqual({ ok: true });
  });
});
