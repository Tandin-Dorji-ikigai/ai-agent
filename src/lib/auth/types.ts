import type { EntrepreneurRecord } from "../types";

export interface EntrepreneurAccount {
  id: string;
  email: string;
  entrepreneur: EntrepreneurRecord;
  phone: string | null;
  path: "idea" | "exploring";
  details: Record<string, string>;
}
export interface AuthStatus {
  ok: true;
  account: EntrepreneurAccount | null;
}
