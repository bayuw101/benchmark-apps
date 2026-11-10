import type { ParamValue, RunnerConfig } from "@btb/contracts";
import http, { type Params, type RefinedResponse, type RequestBody, type ResponseType } from "k6/http";

import { methodAllowed, pathAllowed } from "./guard";

/** HTTP for journeys: paths only, against the run's target, inside its allowlist. A blocked call throws (fails the iteration). */
export interface TargetClient {
  request(method: string, path: string, body?: RequestBody | null, params?: Params): RefinedResponse<ResponseType | undefined>;
  get(path: string, params?: Params): RefinedResponse<ResponseType | undefined>;
  postJson(path: string, payload: unknown, params?: Params): RefinedResponse<ResponseType | undefined>;
}

export function targetClient(c: RunnerConfig): TargetClient {
  const request: TargetClient["request"] = (method, path, body = null, params) => {
    if (!methodAllowed(method, c.allowedMethods)) throw new Error(`blocked by allowlist: method ${method}`);
    if (!pathAllowed(path, c.allowedPaths)) throw new Error(`blocked by allowlist: path ${path}`);
    return http.request(method.toUpperCase(), `${c.targetUrl}${path}`, body, params);
  };
  return {
    request,
    get: (path, params) => request("GET", path, null, params),
    postJson: (path, payload, params) =>
      request("POST", path, JSON.stringify(payload), { ...params, headers: { "Content-Type": "application/json", ...params?.headers } }),
  };
}

export interface JourneyContext {
  http: TargetClient;
  params: Record<string, ParamValue>;
  /** This runner's share of the target's test-data identities (E2.6); empty without a pool. Never log them. */
  identities: () => unknown[];
}
