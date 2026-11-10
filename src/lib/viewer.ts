import "server-only";
import { cookies } from "next/headers";
import { ACCESS_COOKIE, ROLE_LABEL, gateOn, roleFromCookie, rolePasswords, type ViewerRole } from "./access";
import { fail } from "./http";

export interface Viewer {
  role: ViewerRole;
  /** false = sign-in is off (local development), where everyone may do everything. */
  signed_in: boolean;
}

/** Who is using this device, from the sign-in cookie. null = not signed in. */
export async function currentViewer(): Promise<Viewer | null> {
  const passwords = rolePasswords();
  if (!gateOn(passwords)) return { role: "team", signed_in: false };
  const role = await roleFromCookie((await cookies()).get(ACCESS_COOKIE)?.value, passwords);
  return role ? { role, signed_in: true } : null;
}

/**
 * The call endpoints take a side ("entrepreneur" | "mentor") in the request.
 * It must be the side this device signed in as, so a mentee cannot join,
 * agree to recording or upload audio as the mentor. Returns the error to send, or null.
 */
export async function wrongSide(side: "entrepreneur" | "mentor"): Promise<Response | null> {
  const viewer = await currentViewer();
  if (!viewer) return fail(401, "ACCESS_REQUIRED", "Sign in first.");
  if (viewer.role === "team" || viewer.role === side) return null;
  return fail(403, "WRONG_ROLE", `You are signed in as ${ROLE_LABEL[viewer.role]}, so you cannot take ${ROLE_LABEL[side]}'s side of the call.`);
}
