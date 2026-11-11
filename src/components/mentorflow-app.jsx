"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowRight, Bell, CalendarDays, Check, Compass, FileText, Home,
  Inbox, Leaf, Lightbulb, Plus, ShieldCheck, Sparkles, Trash2, Users, Video,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { assessmentFields, explorerSteps } from "@/lib/forms";
import { profile as ideaProfile, explorerProfile } from "@/lib/preview-content";
import { useDemo } from "@/components/demo-state";
import { pagePaths, pageForPath } from "@/lib/mentorflow-routes";
import { assessmentFromForm, isExploring, profileFromEntrepreneur } from "@/lib/mentorflow-assessment";
import { AssessmentInputSchema } from "@/lib/agent/schemas";
import { PEMA_ASSESSMENT_ANSWERS, DEMO_SESSION_NOTES, demoReplyFor } from "@/lib/demo/fixtures";
import { expertiseLabel, sectorLabel, stageLabel, LANGUAGE_LABEL, EXPERTISE, DECLINE_REASONS, DECLINE_REASON_LABEL, WEEKDAYS } from "@/lib/types";
import { formatNu, relativeDue } from "@/lib/format";
import { formatBhutanDay, formatSlot, upcomingSlots } from "@/lib/matching/slots";
import { requestSummary } from "@/lib/mentorflow-view";
import { CallRoom } from "@/components/call/call-room";
import { useAutoRequest } from "@/components/use-auto-request";
import { VoiceIntro } from "@/components/voice/voice-intro";
import { VoiceRecorder } from "@/components/voice/voice-recorder";
import { MatchList } from "@/components/match-list";
import { MentorProgress } from "@/components/mentor-progress";
import { SessionHistory } from "@/components/session-history";
import { SignInForm, SignOutButton } from "@/components/sign-in-form";
import { CallAlerts } from "@/components/push/call-alerts";
import { BeginnerCoach } from "@/components/coach/beginner-coach";

const DAY_NAME = { sun: "Sunday", mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday" };
const firstName = name => (name ?? "").split(" ")[0];

// Retain the supplied prototype's screens and shadcn/ui controls. Supported
// actions use the replaceable frontend transport through TanStack Query.
const navigation = {
  entrepreneur: [
    ["connect", "Connect with mentor", Users],
    ["assessment", "Needs assessment", FileText],
    ["bookings", "My bookings", CalendarDays],
  ],
  mentor: [
    ["mentor-dashboard", "Dashboard", Home],
    ["mentor-requests", "Requests", Inbox],
    ["availability", "Availability", CalendarDays],
    ["workspace", "Session", FileText],
  ],
};

export default function App({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const page = pageForPath(pathname);
  const { state, error, busy, act, refresh, lastError, clearLastError } = useDemo();
  // "idea" | "exploring" once chosen on the needs assessment (or by the voice intro); null follows the saved profile.
  const [signupPath, setSignupPath] = useState(null);
  const [draft, setDraft] = useState({});
  const [supportDraft, setSupportDraft] = useState(null);
  const [formError, setFormError] = useState("");
  const [previewNotice, setPreviewNotice] = useState("");
  const [notes, setNotes] = useState(DEMO_SESSION_NOTES);
  const [notesSource, setNotesSource] = useState("typed");
  const [excludedActions, setExcludedActions] = useState([]);
  const [replies, setReplies] = useState({});
  const [weeklyDraft, setWeeklyDraft] = useState(null);
  const [acceptSlot, setAcceptSlot] = useState("");
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState("no_time");
  const [declineNote, setDeclineNote] = useState("");
  const booking = state?.booking;
  // Who this device signed in as. Without sign-in (local development) everyone is "team".
  const viewer = state?.viewer ?? { role: "team", signed_in: false };
  const canLoadDemo = viewer.role === "team" || viewer.role === "ydf";
  const loadDemoHint = "Ask the team to load the demo data.";
  // The agent's mentor request (asked automatically after matching; the mentor decides).
  const summary = requestSummary(state);
  const pendingRequest = state?.pending_request ?? null;
  const mentorRecord = booking?.mentor ?? state?.mentor_for_view;
  // For the mentor screens: the request and booking that belong to this mentor.
  const myRequest = pendingRequest && pendingRequest.mentor.id === mentorRecord?.id ? pendingRequest : null;
  const myBooking = booking && booking.mentor.id === mentorRecord?.id ? booking : null;
  const requestTimes = (myRequest?.offered_slots ?? []).filter(time => Date.parse(time) > Date.parse(state?.clock.now ?? "1970-01-01T00:00:00Z"));
  const chosenTime = acceptSlot && requestTimes.includes(acceptSlot) ? acceptSlot : requestTimes[0] ?? "";
  const mentor = {
    name: mentorRecord?.full_name ?? "Your mentor",
    title: mentorRecord?.headline ?? "Mentor profile",
    description: mentorRecord?.bio ?? "Complete your needs assessment to find a verified mentor.",
    skills: mentorRecord?.expertise.map(expertiseLabel) ?? [],
    sector: mentorRecord?.sectors.map(sectorLabel).join(", ") ?? "",
  };
  const entrepreneurInitials = (state?.entrepreneur?.full_name ?? "Entrepreneur").split(" ").map(part => part[0]).slice(0, 2).join("");
  const mentorInitials = (mentorRecord?.full_name ?? "Mentor").split(" ").map(part => part[0]).slice(0, 2).join("");
  const match = state?.matches.find(item => item.mentor.id === mentorRecord?.id);
  const exploring = signupPath ? signupPath === "exploring" : isExploring(state?.entrepreneur);
  // Saved needs once assessed; before that the demo defaults (an exploring founder starts with idea development).
  const supportNeeds = supportDraft ?? (state?.entrepreneur?.assessment_completed_at ? state.entrepreneur.expertise_needs : null) ?? (exploring ? ["idea_development"] : PEMA_ASSESSMENT_ANSWERS.expertise_needs);
  const drafts = state?.actions.filter(item => item.status === "draft") ?? [];
  // A follow-up can be asked for once the mentor has confirmed the next steps,
  // or straight away when the agent found none (a casual talk: nothing to confirm).
  const sessionActions = state?.session ? state.actions.filter(item => item.session_id === state.session.id) : [];
  const followUpOpen = Boolean(state?.session?.summary_confirmed || (state?.session?.agent_summary && sessionActions.length === 0));
  const role = pagePaths[page]?.startsWith("/mentor/") ? "mentor" : "entrepreneur";
  const isPublic = ["welcome", "login"].includes(page);
  const isLogin = page === "login";
  const isCall = page === "video-call" || page === "mentor-call";
  // The mentor's usual weekly times (requests offer the next of these).
  const savedWeekly = (mentorRecord?.weekly_slots ?? []).map((slot, index) => ({ id: `${slot.day}-${slot.time}-${index}`, day: slot.day, time: slot.time }));
  const weeklyRows = weeklyDraft && weeklyDraft.mentorId === mentorRecord?.id ? weeklyDraft.rows : savedWeekly.length ? savedWeekly : [{ id: "first-weekly", day: "", time: "" }];
  const setWeeklyRows = updater => setWeeklyDraft({ mentorId: mentorRecord?.id, rows: updater(weeklyRows) });
  // Saved answers once the assessment is done; before that, Pema's demo answers pre-fill the form
  // (the exploring path keeps its own sample prompts).
  const entrepreneur = state?.entrepreneur;
  const savedProfile = !entrepreneur ? {}
    : entrepreneur.assessment_completed_at ? profileFromEntrepreneur(entrepreneur)
    : exploring ? { fullName: entrepreneur.full_name, district: entrepreneur.location ?? "" }
    : profileFromEntrepreneur({ ...entrepreneur, ...PEMA_ASSESSMENT_ANSWERS });
  const profile = { ...(exploring ? explorerProfile : ideaProfile), ...savedProfile };

  useEffect(() => {
    function onLocationChange() {
      const legacyPath = window.location.hash.slice(1);
      if (pageForPath(legacyPath)) router.replace(legacyPath);
    }
    onLocationChange();
    window.addEventListener("hashchange", onLocationChange);
    return () => window.removeEventListener("hashchange", onLocationChange);
  }, [router]);

  useEffect(() => {
    if (!page) return;
    window.scrollTo({ top: 0, behavior: "instant" });
    document.title = page === "welcome" ? "MentorFlow · Your next step" : `${isCall ? "Video session" : isLogin ? "Sign in" : isPublic ? "Get started" : role === "mentor" ? "Mentor workspace" : "Entrepreneur app"} · MentorFlow`;
  }, [page, role, isPublic, isLogin, isCall]);

  // No button: when there are matches but nobody is being asked, the agent asks the best match.
  // Mentee type decides the menu: First steps (no idea yet) or Needs assessment (has an idea).
  // Until their data loads, the menu shows only what every mentee has, so it never flashes the wrong one.
  const savedExploring = isExploring(state?.entrepreneur);
  const coachFirst = savedExploring && !["ready", "skipped"].includes(state?.coach?.status ?? "");
  const autoKey = role === "entrepreneur" && !isPublic && !coachFirst && state?.entrepreneur?.assessment_completed_at && (state?.matches.length ?? 0) > 0 && !booking && (summary.phase === "none" || summary.phase === "stopped")
    ? `${state.entrepreneur.assessment_completed_at}:${state.request_round?.round_id ?? "none"}:${state.request_round?.requests.at(-1)?.id ?? ""}`
    : null;
  const { stalled: autoStalled } = useAutoRequest(autoKey, refresh);

  function go(nextPage, search = "") {
    setFormError("");
    setPreviewNotice("");
    setDeclineOpen(false);
    router.push(pagePaths[nextPage] + search);
  }

  async function saveAssessment() {
    setFormError("");
    try {
      const input = assessmentFromForm({ ...profile, ...draft }, supportNeeds, exploring);
      const parsed = AssessmentInputSchema.safeParse(input);
      if (!parsed.success) {
        setFormError(parsed.error.issues.map(issue => `${issue.path.join(" ").replaceAll("_", " ")}: ${issue.message}`).join(". "));
        return;
      }
      const saved = await act("assessment", "/api/assessment", parsed.data);
      if (!saved.ok) return;
      const matched = await act("matches", "/api/matches");
      if (matched.ok) {
        setDraft({});
        setSupportDraft(null);
        go(isExploring(parsed.data) ? "coach" : "connect");
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Please check your answers.");
    }
  }

  /** The voice intro's answers fill the full form below, so both show the same thing. */
  function applyVoiceAnswers(answers) {
    if (!state?.entrepreneur) return;
    setSignupPath(answers.business_stage === "idea" && !answers.business_name ? "exploring" : "idea");
    setDraft(profileFromEntrepreneur({
      ...state.entrepreneur, ...answers,
      business_stage: answers.business_stage || null, sector: answers.sector || null,
      preferred_language: answers.preferred_language || state.entrepreneur.preferred_language,
      budget: Number(answers.budget || 0),
    }));
    setSupportDraft(answers.expertise_needs.length ? answers.expertise_needs : null);
  }

  /** The voice intro's countdown: save, match (the agent then asks the mentor), go to Connect. */
  async function saveFromVoice(input) {
    const saved = await act("assessment", "/api/assessment", input);
    if (!saved.ok) return false;
    const matched = await act("matches", "/api/matches");
    if (!matched.ok) return false;
    setDraft({});
    setSupportDraft(null);
    go(isExploring(input) ? "coach" : "connect");
    return true;
  }

  async function saveAvailability() {
    const rows = weeklyRows.filter(row => row.day || row.time);
    if (rows.some(row => !row.day || !row.time)) {
      setFormError("Choose a day and a time for every row."); return;
    }
    setFormError("");
    const result = await act("availability", "/api/mentors/availability", {
      mentor_id: mentorRecord?.id,
      weekly_slots: rows.map(row => ({ day: row.day, time: row.time })),
    });
    if (result.ok) {
      setWeeklyDraft(null);
      setPreviewNotice("Weekly times saved. New requests will offer the next of these times.");
    }
  }

  function updateWeekly(id, field, value) {
    setWeeklyRows(rows => rows.map(row => row.id === id ? { ...row, [field]: value } : row));
  }

  function sessionTime(value) {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "short", day: "numeric", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", timeZone: "Asia/Thimphu",
    }).format(new Date(value));
  }

  const brand = (
    <span className="brand">
      <span className="brand-icon"><Leaf className="size-5" /></span>
      <span>mentorflow<span className="text-primary">.</span></span>
    </span>
  );
  // Calls are only for a confirmed booking; only its two participants can join.
  const callPage = role === "mentor" ? "mentor-call" : "video-call";
  const RECORDING_NOTICE = "The call is recorded and transcribed for your notes. Either of you can stop it.";
  const canJoin = Boolean(booking && booking.status === "confirmed" && (role === "entrepreneur" || myBooking));
  const joinButton = canJoin ? (
    <div className="join-cta">
      <Button className="join-cta-button" onClick={() => go(callPage, "?join=1")}>
        <Video className="size-4" /> Join session
      </Button>
      <p className="join-note"><ShieldCheck className="size-3.5" aria-hidden="true" /><span>{RECORDING_NOTICE}</span></p>
    </div>
  ) : null;
  // At the top of Connect and the Dashboard: who the session is with and when, then the Join button.
  const joinCard = canJoin ? (
    <Card className="join-card"><CardContent className="stack-tight">
      <div className="join-card-head">
        <span className="join-card-icon"><Video className="size-5" /></span>
        <div><p className="join-card-title">Session with {role === "mentor" ? profile.fullName : mentor.name}</p><p className="join-card-time">{sessionTime(booking.scheduled_at)}, Bhutan time</p></div>
      </div>
      {joinButton}
    </CardContent></Card>
  ) : null;
  const notificationButton = (
    <Button variant="ghost" size="icon" className="notification-button" aria-label="Notifications"
      aria-current={page === "notifications" ? "page" : undefined}
      onClick={() => go("notifications")}>
      <Bell className="size-[18px]" /><span className="notification-dot" aria-hidden="true" />
    </Button>
  );

  let content;

  if (page === "coach") {
    content = savedExploring || !state?.entrepreneur
      ? <BeginnerCoach onMentor={() => go("connect")} onUpdateNeeds={() => go("assessment")} />
      : <Card><CardContent className="empty-state"><Compass className="size-8 text-primary" /><h2>First steps are for mentees without an idea yet</h2><p className="muted">You told us about your business idea, so the agent goes straight to finding your mentor.</p><Button onClick={() => go("connect")}>Connect with mentor<ArrowRight className="size-4" /></Button></CardContent></Card>;
  } else if (page === "connect") {
    const statusBadge = summary.phase === "declined" ? "Request declined" : summary.phase === "waiting" ? "Awaiting mentor" : booking?.status === "confirmed" ? "Session booked" : booking?.status === "completed" ? "Session completed" : summary.phase === "escalated" ? "With YDF" : "Asking now";
    const badgeTone = summary.phase === "declined" || summary.phase === "waiting" || !booking ? "status-pending" : "status-success";
    content = <>
      <div className="page-header"><div><h1>Connect with mentor</h1></div></div>
      {joinCard}
      {coachFirst && state?.entrepreneur?.assessment_completed_at && <Alert className="mb-6"><Compass className="size-4" /><AlertTitle>{state?.coach ? `Your first steps: ${state.coach.steps.filter(x => x.status === "done").length} of 4 done` : "No idea yet? Start with your first steps"}</AlertTitle><AlertDescription>{state?.coach ? "Finish the four steps with your AI coach, then the agent introduces you to a mentor." : "Four small steps with an AI coach, then the agent asks a mentor to meet you."}<div className="row wrap mt-2"><Button size="sm" onClick={() => go("coach")}>{state?.coach ? "Continue my steps" : "Start my first steps"}<ArrowRight className="size-4" /></Button><Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={async () => { await act("coach-skip", "/api/coach/skip"); }}>Ask a human mentor now</Button></div></AlertDescription></Alert>}
      {!mentorRecord ? <Card><CardContent className="empty-state"><Users className="size-8 text-primary" /><h2>{state?.entrepreneur?.assessment_completed_at ? "Ready to find your mentor" : "Let’s find your mentor"}</h2><p className="muted">Share your needs, and the agent finds and asks the right verified mentor.</p><Button disabled={Boolean(busy)} onClick={() => state?.entrepreneur?.assessment_completed_at ? act("matches", "/api/matches") : go("assessment")}>{busy === "matches" ? "Finding your mentor…" : state?.entrepreneur?.assessment_completed_at ? "Find my mentor" : "Complete needs assessment"}<ArrowRight className="size-4" /></Button></CardContent></Card> :
      <Card className="connection-card"><CardHeader><div className="row between wrap"><Badge variant="secondary" className="status-primary"><Sparkles className="size-3" />{booking ? "Your mentor" : summary.current && summary.current.attempt > 1 ? "Your next best match" : "Your best match"}</Badge><Badge variant="secondary" className={badgeTone}>{statusBadge}</Badge></div></CardHeader>
        <CardContent className="stack"><div className="mentor-identity"><Avatar className="mentor-avatar"><AvatarFallback>{mentorInitials}</AvatarFallback></Avatar><div><h2>{mentor.name}</h2><p className="subtitle">{mentor.title}</p>{mentorRecord.verified && <Badge variant="outline" className="mt-2"><ShieldCheck className="size-3" />Verified mentor</Badge>}</div></div>
          {match?.explanation && <p className="muted leading-relaxed">{match.explanation}</p>}
          <Alert>{summary.phase === "declined" ? <Inbox className="size-4" /> : <Check className="size-4" />}<AlertTitle className="line-clamp-none">{summary.headline}</AlertTitle><AlertDescription>{autoStalled ? "I could not reach a mentor just now. I will try again when you next open this page." : summary.detail}</AlertDescription></Alert>
          <div className="row wrap"><Button onClick={() => go("bookings")}><CalendarDays className="size-4" />{booking ? "My bookings" : "Request status"}<ArrowRight className="size-4" /></Button>{summary.phase === "escalated" && <Button variant="outline" disabled={Boolean(busy)} onClick={() => act("matches", "/api/matches")}>{busy === "matches" ? "Asking again…" : "Ask my matches again"}</Button>}</div>
        </CardContent></Card>}
      {mentorRecord && <MatchList matches={state?.matches ?? []} round={state?.request_round ?? null} />}
    </>;
  } else if (page === "assessment") {
    const fields = exploring ? explorerSteps.slice(1).flatMap(item => item.fields) : assessmentFields;
    const values = { ...profile, ...draft };
    const updateValue = (name, value) => setDraft(current => ({ ...current, [name]: value }));
    content = <>
      <div className="page-header"><div><h1>Needs assessment</h1><p className="subtitle">{exploring ? "No business idea yet is fine. Share what you would like to explore." : "Tell us what you are building, so the agent can find the right mentor."}</p></div></div>
      <div className="path-choice" role="group" aria-label="Do you have a business idea?">
        <Button type="button" variant={exploring ? "outline" : "default"} aria-pressed={!exploring} onClick={() => setSignupPath("idea")}><Lightbulb className="size-4" />I have an idea</Button>
        <Button type="button" variant={exploring ? "default" : "outline"} aria-pressed={exploring} onClick={() => setSignupPath("exploring")}><Compass className="size-4" />No idea yet</Button>
      </div>
      <VoiceIntro live={state?.ai_mode === "live"} onAnswers={applyVoiceAnswers} onSave={saveFromVoice} />
      <Card className="form-card"><CardContent><form onSubmit={event => { event.preventDefault(); void saveAssessment(); }}>
        <div className="form-grid" key={exploring ? "exploring" : "idea"}>
          {fields.map(field => <div className={`field ${field.full ? "field-full" : ""}`} key={field.name}>
            <Label htmlFor={field.name}>{field.label}{field.required && " *"}</Label>
            {field.options ? (
              <Select value={String(values[field.name] ?? "")} onValueChange={value => updateValue(field.name, value)} required={field.required}>
                <SelectTrigger id={field.name} className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{field.options.map(option => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent>
              </Select>
            ) : field.type === "textarea" ? (
              <Textarea id={field.name} value={values[field.name] ?? ""} onChange={event => updateValue(field.name, event.target.value)} required={field.required} maxLength={1000} rows={3} />
            ) : <Input id={field.name} type={field.type || "text"} value={values[field.name] ?? ""} onChange={event => updateValue(field.name, event.target.value)} required={field.required} min={field.type === "number" ? 0 : undefined} max={field.name === "budget" ? 100000 : undefined} maxLength={field.name === "productName" ? 120 : 200} />}
          </div>)}
        </div>
        <fieldset className="mt-6"><legend className="text-sm font-semibold">Where would you like support? (choose 1–5)</legend><div className="form-grid mt-3">{EXPERTISE.map(key => <div className="checkbox-row" key={key}><Checkbox id={`support-${key}`} checked={supportNeeds.includes(key)} disabled={!supportNeeds.includes(key) && supportNeeds.length >= 5} onCheckedChange={checked => setSupportDraft(current => { const selected = current ?? supportNeeds; return checked ? [...selected, key] : selected.filter(item => item !== key); })} /><Label htmlFor={`support-${key}`}>{expertiseLabel(key)}</Label></div>)}</div></fieldset>
        <div className="form-nav">
          <Button type="submit" disabled={Boolean(busy)}>{busy === "assessment" ? "Saving…" : busy === "matches" ? "Finding a mentor…" : "Save needs & find mentor"}<ArrowRight className="size-4" /></Button>
        </div>
      </form></CardContent></Card>
    </>;
  } else if (page === "mentor-dashboard") {
    content = <>
      <div className="page-header"><div><h1>{mentorRecord ? `Welcome back, ${mentor.name.split(" ")[0]}` : "Your workspace"}</h1></div></div>
      {joinCard}
      <CallAlerts role="mentor" />
      <div className="split-main">
        <Card><CardHeader><CardTitle>Mentorship requests</CardTitle><CardDescription>The agent asks you when an entrepreneur’s needs fit your expertise.</CardDescription></CardHeader><CardContent>{myRequest || myBooking ? <div className="list-row"><Avatar><AvatarFallback>{entrepreneurInitials}</AvatarFallback></Avatar><div className="grow"><h3>{profile.fullName}</h3><p className="subtitle">{profile.productName || "Exploring business ideas"}</p></div><Badge variant="secondary" className={myBooking ? "status-success" : "status-pending"}>{myBooking ? "Booked" : "Waiting for your reply"}</Badge></div> : <p className="muted">No mentorship requests right now.</p>}<Button variant="outline" size="sm" className="mt-4" onClick={() => go("mentor-requests")}>Review requests<ArrowRight className="size-3.5" /></Button></CardContent></Card>
        <Card><CardHeader><CardTitle>Your next session</CardTitle><CardDescription>{myBooking ? `${sessionTime(myBooking.scheduled_at)}, Bhutan time` : "No session booked yet."}</CardDescription></CardHeader><CardContent><p className="muted">{myBooking ? `${profile.fullName} · ${myBooking.status === "completed" ? "Session completed" : "Booked"}` : "Accept a request with one of your times, and the session and a preparation brief appear here."}</p>{mentorRecord && <p className="muted text-sm mt-2">You have {mentorRecord.slots_remaining} open session{mentorRecord.slots_remaining === 1 ? "" : "s"}.</p>}<Button className="mt-4" variant="outline" size="sm" onClick={() => go(myBooking ? "workspace" : "availability")}>{myBooking ? "Open session workspace" : "Set my availability"}</Button></CardContent></Card>
      </div>
    </>;
  } else if (page === "mentor-requests") {
    const ms = myRequest?.mentee_summary;
    content = <><div className="page-header"><div><h1>Mentorship requests</h1></div></div>
      {myRequest ? <Card><CardHeader><div className="row between wrap"><div className="mentor-identity"><Avatar className="size-14"><AvatarFallback>{entrepreneurInitials}</AvatarFallback></Avatar><div><CardTitle>{ms.full_name}</CardTitle><CardDescription>{[ms.business_name, ms.sector ? sectorLabel(ms.sector) : ""].filter(Boolean).join(" · ") || "Exploring business ideas"}</CardDescription><div className="tag-list">{ms.business_stage && <Badge variant="secondary">{stageLabel(ms.business_stage)}</Badge>}{ms.location && <Badge variant="outline">{ms.location}</Badge>}<Badge variant="outline">Prefers {LANGUAGE_LABEL[ms.preferred_language]}</Badge></div></div></div><Badge variant="secondary" className="status-pending">{ms.follow_up ? "Follow-up request" : "New request"}</Badge></div><CardDescription>Sent by the mentoring agent. Please reply by {formatBhutanDay(myRequest.expires_at)}; after that the agent asks another mentor.</CardDescription></CardHeader><CardContent className="stack">
        <div className="cols-2"><div><h3>What your mentee needs</h3><div className="tag-list mt-2">{ms.needs.map(need => <Badge variant="secondary" key={need}>{need}</Badge>)}</div>{ms.challenge && <><h3 className="mt-6">In {firstName(ms.full_name)}’s words</h3><p className="muted leading-relaxed mt-2">{ms.challenge}</p></>}{state?.coach?.status === "ready" && state.coach.summary && <><h3 className="mt-6">Found with the AI coach</h3><div className="stack-tight mt-2"><div className="info-pair"><span>Problem</span><strong>{state.coach.summary.problem}</strong></div><div className="info-pair"><span>Idea</span><strong>{state.coach.summary.idea}</strong></div></div><ul className="mt-2 list-disc pl-5 space-y-1 muted">{state.coach.summary.evidence.map(item => <li key={item}>{item}</li>)}</ul></>}</div><div><h3>Why the agent asked you{myRequest.score !== null ? ` (${myRequest.score}/100)` : ""}</h3><ul className="mt-2 list-disc pl-5 space-y-1 muted">{ms.why.map(reason => <li key={reason}>{reason}</li>)}</ul>{[["Session fee", formatNu(myRequest.fee)], ["Paid with", myRequest.funding_type === "ydf_credit" ? "YDF credit, when you accept" : "Self-payment (simulated)"]].map(([label, value]) => <div className="info-pair" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div></div><Separator />
        {!declineOpen ? <div className="stack">
          <div className="field"><Label htmlFor="accept-time">Pick a time from your usual hours (Bhutan time)</Label><Select value={chosenTime} onValueChange={setAcceptSlot} disabled={Boolean(busy) || !requestTimes.length}><SelectTrigger id="accept-time" className="w-full"><SelectValue placeholder="Choose a time" /></SelectTrigger><SelectContent>{requestTimes.map(time => <SelectItem key={time} value={time}>{formatSlot(time)}</SelectItem>)}</SelectContent></Select>{!requestTimes.length && <p className="muted">All the offered times have passed. Decline, and the agent will ask another mentor.</p>}</div>
          <div className="row wrap"><Button disabled={Boolean(busy) || !chosenTime} onClick={() => act("accept", "/api/requests/accept", { request_id: myRequest.id, scheduled_at: chosenTime })}><Check className="size-4" />{busy === "accept" ? "Accepting…" : chosenTime ? `Accept for ${formatSlot(chosenTime)}` : "Accept"}</Button><Button variant="outline" disabled={Boolean(busy)} onClick={() => setDeclineOpen(true)}>Decline</Button></div>
        </div> : <form className="stack" onSubmit={async event => { event.preventDefault(); const result = await act("decline", "/api/requests/decline", { request_id: myRequest.id, reason: declineReason, note: declineNote.trim() || undefined }); if (result.ok) { setDeclineOpen(false); setDeclineNote(""); } }}>
          <div className="field"><Label htmlFor="decline-reason">Why can you not take this on?</Label><Select value={declineReason} onValueChange={setDeclineReason}><SelectTrigger id="decline-reason" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{DECLINE_REASONS.map(reason => <SelectItem key={reason} value={reason}>{DECLINE_REASON_LABEL[reason]}</SelectItem>)}</SelectContent></Select></div>
          <div className="field"><Label htmlFor="decline-note">Note for the agent and YDF (optional)</Label><Textarea id="decline-note" value={declineNote} onChange={event => setDeclineNote(event.target.value)} maxLength={300} rows={2} /></div>
          <p className="muted">{firstName(ms.full_name)} is told the reason you pick, not your note, and the agent asks the next best mentor.</p>
          <div className="row wrap"><Button type="submit" variant="destructive" disabled={Boolean(busy)}>{busy === "decline" ? "Sending…" : "Send decline"}</Button><Button type="button" variant="ghost" onClick={() => setDeclineOpen(false)}>Back</Button></div>
        </form>}
      </CardContent></Card>
      : myBooking ? <Card><CardHeader><CardTitle>Session booked with {profile.fullName}</CardTitle><CardDescription>{sessionTime(myBooking.scheduled_at)} · Bhutan time (UTC+6)</CardDescription></CardHeader><CardContent className="row wrap"><Button onClick={() => go("workspace")}>Open session workspace<ArrowRight className="size-4" /></Button>{joinButton}</CardContent></Card>
      : <Card><CardContent className="empty-state"><Inbox className="size-8 text-primary" /><h2>No requests right now</h2><p className="muted">When the agent matches an entrepreneur to you, their request appears here. You decide: accept with one of your usual times, or decline.</p><Button variant="outline" onClick={() => go("availability")}>Check my weekly times</Button></CardContent></Card>}</>;
  } else if (page === "bookings") {
    content = <><div className="page-header"><div><h1>My bookings</h1></div></div>
      <CallAlerts role="entrepreneur" />
      {booking ? <div className="stack">{summary.phase === "waiting" && <Alert><AlertTitle>{summary.headline}</AlertTitle><AlertDescription>{summary.detail}</AlertDescription></Alert>}{summary.phase === "declined" && <Alert><Inbox className="size-4" /><AlertTitle className="line-clamp-none">{summary.headline}</AlertTitle><AlertDescription>{summary.detail}{summary.alternative && <Button size="sm" variant="outline" className="self-start mt-2" disabled={Boolean(busy)} onClick={() => act("ask-other", "/api/requests/ask", { mentor_id: summary.alternative.id })}>{busy === "ask-other" ? "Asking…" : `Ask ${summary.alternative.full_name} instead`}<ArrowRight className="size-4" /></Button>}</AlertDescription></Alert>}<Card className="form-card"><CardHeader><div className="row between wrap"><CardTitle>Your session details</CardTitle><Badge variant="secondary" className="status-success">{booking.status === "completed" ? "Completed" : "Confirmed"}</Badge></div></CardHeader><CardContent className="stack"><div className="mentor-identity"><Avatar className="size-12"><AvatarFallback>{mentorInitials}</AvatarFallback></Avatar><div><h2>{mentor.name}</h2><p className="subtitle">{mentor.title}</p></div></div>{[["Date & time", `${sessionTime(booking.scheduled_at)}, Bhutan time`], ["Session fee", `${formatNu(booking.fee)}${booking.funding_type === "ydf_credit" ? " (YDF credit)" : ""}`]].map(([label, value]) => <div className="info-pair" key={label}><span>{label}</span><strong>{value}</strong></div>)}{booking.status === "confirmed" ? joinButton : <div className="stack-tight"><p className="muted">This session is complete.</p>{summary.phase !== "waiting" && (followUpOpen ? <><Button className="self-start" disabled={Boolean(busy) || booking.mentor.slots_remaining < 1} onClick={() => act("follow-up", "/api/requests/ask", { mentor_id: booking.mentor.id })}>{busy === "follow-up" ? "Asking…" : summary.phase === "declined" && summary.current?.mentor.id === booking.mentor.id ? `Ask ${firstName(booking.mentor.full_name)} again` : `Ask ${firstName(booking.mentor.full_name)} for a follow-up session`}<ArrowRight className="size-4" /></Button>{booking.mentor.slots_remaining < 1 && <p className="muted">{firstName(booking.mentor.full_name)} has no open sessions right now.</p>}</> : <p className="muted">{state?.session?.agent_summary ? `You can ask ${firstName(booking.mentor.full_name)} for a follow-up session once they confirm the next steps.` : "The agent is still reading your session. Your follow-up button appears here when it is done."}</p>)}</div>}</CardContent></Card>
        {booking.status === "confirmed" && <Card className="form-card"><CardHeader><CardTitle>Prepare for your session</CardTitle><CardDescription>{booking.entrepreneur_brief?.headline ?? "Your preparation brief is being prepared."}</CardDescription></CardHeader><CardContent className="stack">{booking.entrepreneur_brief && <><div><h3>Before you meet</h3><ul className="mt-2 list-disc pl-5 space-y-2">{booking.entrepreneur_brief.prepare.map(item => <li key={item}>{item}</li>)}</ul></div><div><h3>Questions to ask</h3><ul className="mt-2 list-disc pl-5 space-y-2">{booking.entrepreneur_brief.questions_to_ask.map(item => <li key={item}>{item}</li>)}</ul></div></>}</CardContent></Card>}
        <SessionHistory sessions={state.sessions_history} actions={state.actions} role="entrepreneur" menteeName={profile.fullName} now={state.clock.now} /></div> : !state?.entrepreneur?.assessment_completed_at ? <Card><CardContent className="empty-state"><CalendarDays className="size-8 text-primary" /><h2>Find your mentor first</h2><p className="muted">Complete your needs assessment. I will then ask the best-matched mentor for you.</p><Button variant="outline" onClick={() => go("assessment")}>Needs assessment<ArrowRight className="size-4" /></Button></CardContent></Card> :
      <Card className="form-card"><CardHeader><div className="row between wrap"><CardTitle>Your mentor request</CardTitle><Badge variant="secondary" className="status-pending">{summary.phase === "waiting" ? "Waiting for a reply" : summary.phase === "escalated" ? "With YDF" : summary.phase === "declined" ? "Declined" : "Asking now"}</Badge></div><CardDescription>I ask for you, and each mentor decides. Nothing is booked or paid until a mentor says yes.</CardDescription></CardHeader><CardContent className="stack">
        <Alert><AlertTitle>{summary.headline}</AlertTitle><AlertDescription>{autoStalled ? "I could not reach a mentor just now. I will try again when you next open this page." : summary.detail}</AlertDescription></Alert>
        {summary.timeline.length > 0 && <div className="stack-tight" role="list" aria-label="Mentors asked">{summary.timeline.map(item => <div role="listitem" className="info-pair" key={item.id}><span>{item.name}</span><strong>{item.outcome}</strong></div>)}</div>}
      </CardContent></Card>}</>;
  } else if (page === "workspace") {
    content = <><div className="page-header"><div><h1>Session workspace</h1></div></div>{!booking ? <Card><CardContent className="empty-state"><ShieldCheck className="size-8 text-primary" /><h2>Session access is waiting</h2><p className="muted">Your session workspace becomes available after booking.</p><Button variant="outline" onClick={() => go("mentor-requests")}>Review requests<ArrowRight className="size-4" /></Button></CardContent></Card> : <div className="stack">
      <Card><CardHeader><CardTitle>Session with {profile.fullName}</CardTitle><CardDescription>{sessionTime(booking.scheduled_at)} · Bhutan time (UTC+6)</CardDescription></CardHeader><CardContent className="stack">{booking.mentor_brief ? <><p className="muted">{booking.mentor_brief.about}</p><div><h3>Suggested focus</h3><ul className="list-disc pl-5 mt-2 space-y-2">{booking.mentor_brief.focus.map(item => <li key={item}>{item}</li>)}</ul></div></> : <p className="muted">Your preparation brief is being prepared.</p>}{joinButton}</CardContent></Card>
      {!state?.session?.completed_at && <Card><CardHeader><CardTitle>After the session</CardTitle><CardDescription>Write quick notes, or end a recorded call: the agent drafts the agreed actions for you to check.</CardDescription></CardHeader><CardContent><form className="stack" onSubmit={async event => { event.preventDefault(); await act("notes", "/api/session/complete", { booking_id: booking.id, notes, source: notesSource }); }}><div className="field"><Label htmlFor="session-notes">Session notes</Label><Textarea id="session-notes" value={notes} onChange={event => setNotes(event.target.value)} required maxLength={4000} rows={8} /></div><VoiceRecorder available={state?.ai_mode === "live"} onText={text => { setNotes(current => current === DEMO_SESSION_NOTES || !current.trim() ? text : `${current.trim()}\n${text}`); setNotesSource("voice_note"); }} title="Or record a voice note" recordLabel="Record voice note" hint="Whisper turns it into text in the box above. Check it before you complete the session." language="en" maxSeconds={600} unavailableText="Voice notes are available when live AI is switched on." /><Button type="submit" className="self-start" disabled={Boolean(busy) || !notes.trim()}>{busy === "notes" ? "Extracting draft actions…" : "Complete session & save notes"}</Button></form></CardContent></Card>}
      {state?.session?.completed_at && !state.session.agent_summary && drafts.length === 0 && !state.actions.some(item => item.session_id === state.session.id) && <Card><CardHeader><CardTitle>The agent is reading the session</CardTitle><CardDescription>{state.session.notes_source === "call_recording" ? "Your call is being turned into draft actions. Long calls are read in parts, so this can take a minute or two." : "Draft actions will appear here shortly."}</CardDescription></CardHeader></Card>}
      {drafts.length > 0 && <Card><CardHeader><CardTitle>Review draft actions</CardTitle><CardDescription>{state.session?.agent_summary}</CardDescription></CardHeader><CardContent className="stack"><Alert><AlertTitle>Human confirmation required</AlertTitle><AlertDescription>Only the actions you confirm will be tracked. Untick anything that is incorrect.</AlertDescription></Alert>{drafts.map(item => <div className="checkbox-row" key={item.id}><Checkbox id={`action-${item.id}`} checked={!excludedActions.includes(item.id)} onCheckedChange={checked => setExcludedActions(items => checked ? items.filter(id => id !== item.id) : [...items, item.id])} /><Label htmlFor={`action-${item.id}`} className="stack-tight"><strong>{item.title}</strong><span>{item.description}</span><span>Owner: {item.owner} · Due {item.due_in_days} days after confirmation</span></Label></div>)}<Button className="self-start" disabled={Boolean(busy)} onClick={() => act("confirm", "/api/actions/confirm", { session_id: state.session.id, action_ids: drafts.filter(item => !excludedActions.includes(item.id)).map(item => item.id) })}>{busy === "confirm" ? "Confirming…" : drafts.every(item => excludedActions.includes(item.id)) ? "Confirm without actions" : "Confirm selected actions"}</Button></CardContent></Card>}
      <SessionHistory sessions={state?.sessions_history ?? []} actions={state?.actions ?? []} role="mentor" menteeName={profile.fullName} now={state?.clock.now ?? new Date().toISOString()} />
      {state?.session?.summary_confirmed && <MentorProgress progress={state.progress} agenda={state.agenda} menteeFirstName={firstName(state.entrepreneur?.full_name)} />}
    </div>}</>;
  } else if (page === "availability") {
    const nextTimes = upcomingSlots(weeklyRows.filter(row => row.day && row.time).map(row => ({ day: row.day, time: row.time })), new Date(state?.clock.now ?? "1970-01-01T00:00:00Z"));
    content = <>
      <div className="page-header"><div><h1>Availability</h1><p className="subtitle">When the agent asks you to mentor someone, the request offers the next of these times.</p></div></div>
      <div className="split-main">
        <Card><CardHeader><CardTitle>When are you usually free?</CardTitle><CardDescription>Bhutan time.</CardDescription></CardHeader><CardContent className="stack">
          <div className="stack-tight">{weeklyRows.map((row, index) => <div className="availability-entry" key={row.id}>
            <div className="row between"><h3>Weekly time {index + 1}</h3><Button variant="ghost" size="icon" aria-label={`Remove weekly time ${index + 1}`} disabled={Boolean(busy)} onClick={() => setWeeklyRows(rows => rows.filter(item => item.id !== row.id))}><Trash2 className="size-3.5" /></Button></div>
            <div className="availability-fields">
              <div className="field"><Label htmlFor={`day-${row.id}`}>Day</Label><Select value={row.day} onValueChange={value => updateWeekly(row.id, "day", value)}><SelectTrigger id={`day-${row.id}`} className="w-full"><SelectValue placeholder="Choose a day" /></SelectTrigger><SelectContent>{WEEKDAYS.map(day => <SelectItem key={day} value={day}>{DAY_NAME[day]}</SelectItem>)}</SelectContent></Select></div>
              <div className="field"><Label htmlFor={`time-${row.id}`}>Time</Label><Input id={`time-${row.id}`} type="time" value={row.time} onChange={event => updateWeekly(row.id, "time", event.target.value)} /></div>
            </div>
          </div>)}</div>
          <Button variant="outline" className="self-start" onClick={() => setWeeklyRows(rows => [...rows, { id: crypto.randomUUID(), day: "", time: "" }])}><Plus className="size-4" />Add a weekly time</Button>
          <Separator />
          <div className="row"><Button disabled={Boolean(busy) || !mentorRecord} onClick={saveAvailability}>{busy === "availability" ? "Saving…" : "Save weekly times"}</Button></div>
        </CardContent></Card>
        <Card><CardHeader><CardTitle>What a new request would offer</CardTitle><CardDescription>The next of your usual times.</CardDescription></CardHeader><CardContent>{nextTimes.length ? nextTimes.map(time => <div className="info-pair" key={time}><span>{formatSlot(time)}</span></div>) : <p className="muted">Add at least one weekly time so the agent can ask you.</p>}</CardContent></Card>
      </div>
    </>;
  } else if (page === "notifications") {
    // Newest first (the state lists them oldest first; equal times keep their real order).
    const messages = (state?.messages ?? []).map((message, index) => ({ message, index })).sort((a, b) => b.message.created_at.localeCompare(a.message.created_at) || b.index - a.index).map(item => item.message);
    // Demo: replies start pre-filled for the scripted actions (the person can change them).
    const replyText = message => replies[message.id] ?? demoReplyFor(state?.actions.find(item => item.id === message.related_action_id)?.title, message.kind);
    const actions = state?.actions.filter(item => item.status !== "draft") ?? [];
    const count = messages.length;
    content = <><div className="page-header"><div><h1>Notifications</h1></div><Badge variant="secondary">{count} update{count === 1 ? "" : "s"}</Badge></div><div className="stack">
      {count === 0 && <Card><CardContent className="empty-state"><Bell className="size-8 text-primary" /><h2>You’re all caught up</h2><p className="muted">Updates appear here as your mentorship progresses.</p></CardContent></Card>}
      <>
        {messages.map(message => <Card key={message.id}><CardHeader><div className="row between wrap"><CardTitle>{message.sender === "agent" ? "Mentorship update" : message.sender === "entrepreneur" ? "Your reply" : "Programme update"}</CardTitle><Badge variant="outline">{message.kind.replaceAll("_", " ")}</Badge></div><CardDescription className="whitespace-pre-wrap">{profile.language === "Dzongkha" && message.dz_verified && message.body_dz ? message.body_dz : message.body}</CardDescription>{profile.language === "Dzongkha" && message.dz_verified && message.body_dz && <p className="muted">English: {message.body}</p>}</CardHeader>{message.kind === "recommendation" && typeof message.metadata?.mentor_id === "string" && !state?.request_round?.requests.some(r => r.mentor.id === message.metadata.mentor_id && r.created_at >= message.created_at) && <CardContent><Button variant="outline" size="sm" disabled={Boolean(busy) || summary.phase === "waiting"} onClick={() => act("ask", "/api/requests/ask", { mentor_id: message.metadata.mentor_id })}>Yes, ask for a session</Button>{summary.phase === "waiting" && <p className="muted text-xs mt-2">You can ask once your open mentor request has an answer.</p>}</CardContent>}{message.awaiting_reply && <CardContent><form className="stack" onSubmit={async event => { event.preventDefault(); const result = await act("reply", "/api/inbox/reply", { message_id: message.id, body: replyText(message) }); if (result.ok) setReplies(items => ({ ...items, [message.id]: "" })); }}><div className="field"><Label htmlFor={`reply-${message.id}`}>Your reply</Label><Textarea id={`reply-${message.id}`} value={replyText(message)} onChange={event => setReplies(items => ({ ...items, [message.id]: event.target.value }))} required maxLength={1000} rows={3} /></div><Button className="self-start" type="submit" disabled={Boolean(busy) || !replyText(message).trim()}>{busy === "reply" ? "Sending…" : "Send reply"}<ArrowRight className="size-4" /></Button></form></CardContent>}</Card>)}
        {actions.length > 0 && <Card><CardHeader><CardTitle>Your agreed next steps</CardTitle><CardDescription>Actions confirmed after your mentoring session.</CardDescription></CardHeader><CardContent className="stack">{actions.map(item => <div className="row between wrap" key={item.id}><div className="grow"><h3>{item.title}</h3><p className="subtitle">{relativeDue(item.due_at, state.clock.now)}{item.blocker ? ` · ${item.blocker}` : ""}</p></div><Badge variant="secondary">{item.status}</Badge>{item.owner === "entrepreneur" && ["pending", "overdue"].includes(item.status) && <Button variant="outline" size="sm" disabled={Boolean(busy)} onClick={() => act("action", "/api/actions/status", { action_id: item.id, status: "completed" })}>Mark complete</Button>}</div>)}</CardContent></Card>}
      </>
    </div></>;
  } else if (isLogin) {
    content = <div className="login-screen">
      <div className="page-header"><div><h1>Sign in</h1><p className="subtitle">Your password opens your workspace.</p></div></div>
      <Card><CardHeader><CardTitle>Sign in</CardTitle><CardDescription>Enter the password the team gave you. It takes you to your workspace: entrepreneur, mentor or YDF staff. This test version has no personal accounts, so please don’t enter real personal details anywhere in it.</CardDescription></CardHeader><CardContent>
        <SignInForm />
      </CardContent></Card>
    </div>;
  } else if (isCall) {
    const otherName = role === "mentor" ? (state?.entrepreneur?.full_name ?? "Your mentee") : mentor.name;
    content = <CallRoom
      key={booking?.id ?? "no-booking"}
      bookingId={booking?.id ?? null}
      role={role}
      open={Boolean(booking && booking.status === "confirmed" && (role === "entrepreneur" || myBooking))}
      call={state?.call ?? null}
      otherName={otherName}
      otherInitials={role === "mentor" ? entrepreneurInitials : mentorInitials}
      selfInitials={role === "mentor" ? mentorInitials : entrepreneurInitials}
      onLeft={() => go(role === "mentor" ? "workspace" : "bookings")}
      onRefresh={refresh}
    />;
  } else if (page === "welcome") {
    content = <div className="login-screen">
      <div className="page-header"><div><h1>Choose a workspace</h1><p className="subtitle">Open the entrepreneur or mentor side, or the YDF staff page.</p></div></div>
      <Card><CardContent className="stack-tight">
        <Button variant="outline" className="justify-between" onClick={() => go("connect")}>Entrepreneur workspace<ArrowRight className="size-4" /></Button>
        <Button variant="outline" className="justify-between" onClick={() => go("mentor-dashboard")}>Mentor workspace<ArrowRight className="size-4" /></Button>
        <Button variant="outline" className="justify-between" asChild><Link href="/ydf">YDF staff<ArrowRight className="size-4" /></Link></Button>
      </CardContent></Card>
    </div>;
  }

  if (!page) {
    return pathname === "/ydf" ? <main className="legacy-demo mx-auto w-full max-w-6xl px-4 py-6"><div className="row wrap mb-6"><Button variant="outline" asChild><Link href="/">MentorFlow home</Link></Button><Button variant="outline" asChild><Link href="/entrepreneur/connect">Entrepreneur</Link></Button><Button variant="outline" asChild><Link href="/mentor/dashboard">Mentor workspace</Link></Button></div>{children}</main> : children;
  }

  if (isCall) return <>{children}{content}</>;

  if (!isPublic && (!state || !state.seeded)) {
    content = <Card><CardContent className="empty-state"><Users className="size-8 text-primary" /><h1>{error ? "Mentorship data is unavailable" : state ? "Start the mentoring demo" : "Loading your workspace…"}</h1><p className="muted">{error ? error.message : state ? "Load the fictional entrepreneur, mentor profiles and sponsorship credit to explore the connected flow." : "Getting your latest mentorship information."}</p>{error ? <Button variant="outline" onClick={() => refresh()}>Try again</Button> : state && (canLoadDemo ? <Button disabled={Boolean(busy)} onClick={() => act("reset", "/api/demo/reset")}>{busy === "reset" ? "Loading…" : "Load demo data"}</Button> : <p className="muted">{loadDemoHint}</p>)}</CardContent></Card>;
  }

  // The other person is already in the session room and this one is not (only while the call is open).
  const otherWaiting = !isCall && !isPublic && booking?.status === "confirmed" && (role === "entrepreneur" || myBooking) && state?.call?.status === "open"
    && (role === "mentor" ? state.call.joined.entrepreneur && !state.call.joined.mentor : state.call.joined.mentor && !state.call.joined.entrepreneur);
  const notices = <>
    {otherWaiting && <Alert className="mb-6"><Video className="size-4" /><AlertTitle>{role === "mentor" ? firstName(state?.entrepreneur?.full_name) || "Your mentee" : firstName(mentor.name) || "Your mentor"} is in the session room</AlertTitle><AlertDescription>Join now to start your mentoring call. {RECORDING_NOTICE}<Button size="sm" className="self-start mt-2" onClick={() => go(callPage, "?join=1")}>Join now<ArrowRight className="size-4" /></Button></AlertDescription></Alert>}
    {lastError && <Alert variant="destructive" className="mb-6"><AlertTitle>That didn’t work</AlertTitle><AlertDescription>{lastError.message}<Button type="button" variant="link" className="self-start px-0" onClick={clearLastError}>Dismiss</Button></AlertDescription></Alert>}
    {formError && <Alert variant="destructive" className="mb-6"><AlertTitle>Please check your answers</AlertTitle><AlertDescription>{formError}</AlertDescription></Alert>}
    {previewNotice && <Alert className="mb-6"><AlertTitle>Saved</AlertTitle><AlertDescription>{previewNotice}</AlertDescription></Alert>}
    {!isPublic && state?.seeded && error && <Alert variant="destructive" className="mb-6"><AlertTitle>Updates are unavailable</AlertTitle><AlertDescription>You’re viewing the last loaded information.<Button variant="link" onClick={() => refresh()}>Try again</Button></AlertDescription></Alert>}
  </>;

  return isPublic ? (
    <div className="public">
      <header className="public-top">{brand}{!isLogin && viewer.signed_in && <nav aria-label="Account"><SignOutButton /></nav>}</header>
      <main className="public-main">{children}{notices}{content}</main>
    </div>
  ) : role === "entrepreneur" ? (
    <div className="phone-app">
      <header className="phone-topbar">
        <span className="app-area-label">Entrepreneur</span>
        <div className="row">{notificationButton}<Avatar className="size-8"><AvatarFallback>{entrepreneurInitials}</AvatarFallback></Avatar>{viewer.signed_in && <SignOutButton iconOnly />}</div>
      </header>
      <main className="phone-content">{children}{notices}{content}</main>
      <nav className="phone-navbar" aria-label="Entrepreneur navigation">
        {(!state?.entrepreneur ? navigation.entrepreneur.filter(([id]) => id !== "assessment") : savedExploring ? [["coach", "First steps", Compass], ...navigation.entrepreneur.filter(([id]) => id !== "assessment")] : navigation.entrepreneur).map(([id, label, Icon]) => <Button key={id} variant="ghost" className={`app-nav-item ${page === id ? "active" : ""}`} aria-current={page === id ? "page" : undefined} onClick={() => go(id)}><Icon className="size-5" strokeWidth={1.7} /><span>{label}</span></Button>)}
      </nav>
    </div>
  ) : (
    <div className="phone-app">
      <header className="phone-topbar">
        <span className="app-area-label">Mentor</span>
        <div className="row"><Avatar className="size-8"><AvatarFallback>{mentorInitials}</AvatarFallback></Avatar>{viewer.signed_in && <SignOutButton iconOnly />}</div>
      </header>
      <main className="phone-content">{children}{notices}{content}</main>
      <nav className="phone-navbar" aria-label="Mentor navigation">
        {navigation.mentor.map(([id, label, Icon]) => <Button key={id} variant="ghost" className={`app-nav-item ${page === id ? "active" : ""}`} aria-current={page === id ? "page" : undefined} onClick={() => go(id)}><Icon className="size-5" strokeWidth={1.7} /><span>{label}</span></Button>)}
      </nav>
    </div>
  );
}
