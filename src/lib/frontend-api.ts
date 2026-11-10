import { apiRequest } from "./client-api";
import { readPreview, writePreview } from "./frontend-preview";

// Teammate integration switch. Leave unset for a self-contained frontend.
export const FRONTEND_PREVIEW = process.env.NEXT_PUBLIC_MENTORFLOW_API_MODE !== "server";

export async function frontendRequest<T>(path: string, init?: RequestInit): Promise<T> {
  if (!FRONTEND_PREVIEW) return apiRequest<T>(path, init);
  if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (path === "/api/state" && (!init?.method || init.method === "GET")) return readPreview() as T;
  return writePreview(path, typeof init?.body === "string" ? JSON.parse(init.body) : {}) as T;
}
