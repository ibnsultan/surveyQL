import { DslError } from "../lang/errors";
import type { IO } from "../interpreter/context";
import { Dataset } from "./dataset";

export function isUrl(src: string): boolean {
  return /^https?:\/\//i.test(src);
}

/** Load JSON from a local path or an http(s) URL through the host IO. */
export async function loadSource(io: IO, src: string): Promise<unknown> {
  try {
    return isUrl(src) ? await io.fetchJson(src) : await io.readJson(src);
  } catch (e) {
    if (e instanceof DslError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new DslError(`cannot load '${src}': ${msg}`);
  }
}

/** Load a survey definition and optional responses into a Dataset. */
export async function loadDataset(io: IO, surveySrc: string, dataSrc?: string): Promise<Dataset> {
  const [survey, data] = await Promise.all([loadSource(io, surveySrc), dataSrc ? loadSource(io, dataSrc) : Promise.resolve([])]);
  return Dataset.fromJson(survey, data, dataSrc ?? surveySrc);
}

/** Shared `fetch` wrapper for Node and browsers. */
export async function fetchJson(url: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const cors = typeof window !== "undefined" ? " (in a browser this is often a CORS restriction on the remote host)" : "";
    throw new DslError(`request to ${url} failed: ${msg}${cors}`);
  }
  if (!res.ok) throw new DslError(`request to ${url} failed with HTTP ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new DslError(`${url} did not return valid JSON`);
  }
}
