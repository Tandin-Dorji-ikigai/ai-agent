export const pagePaths: Record<string, string> = {
  welcome: "/",
  login: "/login",
  "video-call": "/entrepreneur/call",
  "mentor-call": "/mentor/call",
  connect: "/entrepreneur/connect",
  coach: "/entrepreneur/coach",
  assessment: "/entrepreneur/needs",
  bookings: "/entrepreneur/bookings",
  notifications: "/entrepreneur/notifications",
  "mentor-dashboard": "/mentor/dashboard",
  "mentor-requests": "/mentor/requests",
  availability: "/mentor/availability",
  workspace: "/mentor/session",
};

export function pageForPath(path: string): string | undefined {
  return Object.keys(pagePaths).find(page => pagePaths[page] === path);
}
