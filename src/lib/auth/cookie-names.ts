// Separate from the shared role-password cookie in src/lib/access.ts.
export const ACCOUNT_ACCESS_COOKIE = "mentorflow-access";
export const ACCOUNT_REFRESH_COOKIE = "mentorflow-refresh";
export const ACCOUNT_REMEMBER_COOKIE = "mentorflow-remember";
export const ACCOUNT_COOKIES = [ACCOUNT_ACCESS_COOKIE, ACCOUNT_REFRESH_COOKIE, ACCOUNT_REMEMBER_COOKIE] as const;
