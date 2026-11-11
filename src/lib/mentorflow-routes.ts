export const pagePaths: Record<string, string> = {
  welcome: "/",
  "signup-choice": "/get-started",
  "register-entrepreneur": "/entrepreneur/sign-up/idea",
  "register-without-idea": "/entrepreneur/sign-up/exploring",
  login: "/login",
  "account-login": "/account/login",
  account: "/account",
  "video-call": "/entrepreneur/call",
  "mentor-call": "/mentor/call",
  connect: "/entrepreneur/connect",
  coach: "/entrepreneur/coach",
  assessment: "/entrepreneur/needs",
  bookings: "/entrepreneur/bookings",
  notifications: "/entrepreneur/notifications",
  "mentor-dashboard": "/mentor/dashboard",
  "mentor-requests": "/mentor/requests",
  mentees: "/mentor/mentees",
  availability: "/mentor/availability",
  workspace: "/mentor/session",
  "mentor-profile": "/mentor/profile",
  "mentor-notifications": "/mentor/notifications",
  "register-mentor": "/mentor/application",
  "mentor-submitted": "/mentor/application/submitted",
};

export function pageForPath(path: string): string | undefined {
  return Object.keys(pagePaths).find(page => pagePaths[page] === path);
}
