import { apiRequest } from "./client-api";

// Every screen talks to the real API. (PR #2's browser-only preview mode was
// retired once the screens were connected to the backend; to work without the
// shared database, run a local one: `npm run db:local:start`.)
export const frontendRequest = apiRequest;
