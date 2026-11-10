import type { DemoState } from "./state-types";

export type WorkspaceRole = "entrepreneur" | "mentor";
export interface MentorshipRequest {
  id: string;
  entrepreneur_id: string;
  mentor_id: string;
  status: "pending" | "accepted" | "declined" | "completed";
  booking_id: string | null;
}
export interface AvailabilitySlot {
  id: string;
  mentor_id: string;
  starts_at: string;
  ends_at: string;
  booking_id: string | null;
}
export interface FrontendState extends DemoState {
  workflow: {
    current_request: MentorshipRequest | null;
    availability: AvailabilitySlot[];
    call: {
      participants: Partial<Record<WorkspaceRole, number>>;
      messages: { id: string; role: WorkspaceRole; body: string }[];
    };
  };
}
