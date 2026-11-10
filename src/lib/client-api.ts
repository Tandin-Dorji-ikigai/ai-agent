import type { ApiError } from "./state-types";

export class ApiRequestError extends Error {
  constructor(public readonly detail: ApiError) {
    super(detail.message);
    this.name = "ApiRequestError";
  }
}

export function asApiError(error: unknown): ApiError {
  return error instanceof ApiRequestError ? error.detail : {
    ok: false, code: "NETWORK", message: "Cannot reach the app server. Please try again.",
  };
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: "no-store", ...init });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new ApiRequestError({ ok: false, code: "INVALID_RESPONSE", message: "The server returned an unexpected response. Please try again." });
  }
  if (!response.ok || data?.ok !== true) {
    throw new ApiRequestError({
      ok: false,
      code: typeof data?.code === "string" ? data.code : "REQUEST_FAILED",
      message: typeof data?.message === "string" ? data.message : "The request could not be completed.",
    });
  }
  if (data.outcome?.status === "failed") {
    throw new ApiRequestError({
      ok: false, code: "AGENT_FAILED",
      message: "Your changes were saved, but the mentoring assistant could not finish. Please try again.",
    });
  }
  return data as T;
}
