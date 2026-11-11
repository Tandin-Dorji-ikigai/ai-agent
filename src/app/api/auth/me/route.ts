import type { NextRequest } from "next/server";
import { GET as accountGet } from "@/lib/auth/handlers";
export function GET(req: NextRequest) {
  return accountGet(req, { params: Promise.resolve({ action: "me" }) });
}
