"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import {
  ArrowLeft, ArrowRight, Bell, CalendarDays, Check, Compass, Eye, EyeOff, FileText, Home,
  Inbox, Leaf, Lightbulb, MessageCircle, Mic, MicOff, PhoneOff, Plus, ShieldCheck, Sparkles,
  Trash2, UserRound, Users, Video, VideoOff, X,
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
import { assessmentFields, entrepreneurSteps, explorerSteps, mentorSteps } from "@/lib/forms";
import { profile as ideaProfile, explorerProfile, mentorApplication } from "@/lib/preview-content";
import { useDemo } from "@/components/demo-state";
import { pagePaths, pageForPath } from "@/lib/mentorflow-routes";
import { assessmentFromForm, profileFromEntrepreneur } from "@/lib/mentorflow-assessment";
import { AssessmentInputSchema } from "@/lib/agent/schemas";
import { PEMA_ASSESSMENT_ANSWERS, DEMO_SESSION_NOTES } from "@/lib/demo/fixtures";
import { expertiseLabel, sectorLabel, LANGUAGE_LABEL, EXPERTISE } from "@/lib/types";
import { formatNu, relativeDue } from "@/lib/format";
import { frontendRequest, FRONTEND_PREVIEW } from "@/lib/frontend-api";
import { isPreviewParticipantPresent } from "@/lib/frontend-preview";

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
    ["mentor-requests", "Mentor requests", Inbox],
    ["mentees", "My mentees", Users],
    ["availability", "My availability", CalendarDays],
    ["workspace", "Session workspace", FileText],
    ["mentor-profile", "My mentor profile", UserRound],
  ],
};

export default function App({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const page = pageForPath(pathname);
  const { state, error, busy, act, refresh, lastError, clearLastError } = useDemo();
  const [wizard, setWizard] = useState({ page: null, step: 0 });
  const step = wizard.page === page ? wizard.step : 0;
  const setStep = value => setWizard({ page, step: value });
  const [signupPath, setSignupPath] = useState("idea");
  const [draft, setDraft] = useState({});
  const [mentorDraft, setMentorDraft] = useState({});
  const [supportDraft, setSupportDraft] = useState(null);
  const [formError, setFormError] = useState("");
  const [previewNotice, setPreviewNotice] = useState("");
  const [fundingType, setFundingType] = useState("ydf_credit");
  const [notes, setNotes] = useState(DEMO_SESSION_NOTES);
  const [excludedActions, setExcludedActions] = useState([]);
  const [replies, setReplies] = useState({});
  const bookingKey = useRef(null);
  const [availabilityDraft, setAvailabilityDraft] = useState(null);
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [micMuted, setMicMuted] = useState(true);
  const [cameraOff, setCameraOff] = useState(true);
  const [callChatOpen, setCallChatOpen] = useState(false);
  const [chatMessage, setChatMessage] = useState("");
  const booking = state?.booking;
  const request = state?.workflow?.current_request;
  const mentorRecord = booking?.mentor ?? state?.mentor_for_view;
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
  const supportNeeds = supportDraft ?? state?.entrepreneur?.expertise_needs ?? PEMA_ASSESSMENT_ANSWERS.expertise_needs;
  const drafts = state?.actions.filter(item => item.status === "draft") ?? [];
  const role = pagePaths[page]?.startsWith("/mentor/") ? "mentor" : "entrepreneur";
  const isPublic = ["welcome", "signup-choice", "register-entrepreneur", "register-without-idea", "register-mentor", "mentor-submitted", "login", "mentor-login"].includes(page);
  const isLogin = page === "login" || page === "mentor-login";
  const isCall = page === "video-call" || page === "mentor-call";
  const snapshotNow = Date.parse(state?.clock.now ?? "1970-01-01T00:00:00Z");
  const availableSlots = (state?.workflow?.availability ?? []).filter(slot => slot.mentor_id === mentorRecord?.id && !slot.booking_id && new Date(slot.starts_at).getTime() > snapshotNow);
  const selectedSlot = availableSlots.find(slot => slot.id === selectedSlotId);
  const savedAvailability = availableSlots.map(slot => {
    const local = new Date(Date.parse(slot.starts_at) + 6 * 3600000).toISOString();
    const end = new Date(Date.parse(slot.ends_at) + 6 * 3600000).toISOString();
    return { id: slot.id, date: local.slice(0, 10), start: local.slice(11, 16), end: end.slice(11, 16) };
  });
  const availabilityRows = availabilityDraft && availabilityDraft.mentorId === mentorRecord?.id ? availabilityDraft.rows : savedAvailability.length ? savedAvailability : [{ id: "first-availability", date: "", start: "", end: "" }];
  const setAvailabilityRows = updater => setAvailabilityDraft({ mentorId: mentorRecord?.id, rows: updater(availabilityRows) });
  const callReady = Boolean(booking && booking.status !== "completed");
  const { mutate: updateCallPresence } = useMutation({
    mutationFn: body => frontendRequest("/api/preview/call", { method: "POST", body: JSON.stringify(body) }),
    networkMode: "always",
    onSuccess: refresh,
  });
  const exploring = page === "register-without-idea" || (page !== "register-entrepreneur" && (signupPath === "exploring" || state?.entrepreneur?.business_name === "Exploring my first business idea"));
  const profile = {
    ...(exploring ? explorerProfile : ideaProfile),
    ...(state?.entrepreneur ? profileFromEntrepreneur(state.entrepreneur) : {}),
  };

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

  useEffect(() => {
    if (!FRONTEND_PREVIEW || !isCall || !callReady) return;
    const payload = { booking_id: booking.id, role };
    const join = () => updateCallPresence({ ...payload, action: "join" });
    join();
    const timer = window.setInterval(join, 10000);
    return () => {
      window.clearInterval(timer);
      updateCallPresence({ ...payload, action: "leave" });
    };
  }, [isCall, callReady, booking?.id, role, updateCallPresence]);

  function go(nextPage) {
    setStep(0);
    setFormError("");
    setPreviewNotice("");
    setPasswordVisible(false);
    setMicMuted(true);
    setCameraOff(true);
    setCallChatOpen(false);
    if (nextPage === "register-without-idea") setSignupPath("exploring");
    if (nextPage === "register-entrepreneur") setSignupPath("idea");
    router.push(pagePaths[nextPage]);
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
        go("connect");
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Please check your answers.");
    }
  }

  async function confirmBooking() {
    if (!mentorRecord || busy || booking || !selectedSlot || request?.status !== "accepted") return;
    const signature = `${request.id}:${selectedSlot.id}:${fundingType}`;
    if (bookingKey.current?.signature !== signature) {
      bookingKey.current = { signature, key: `mentorflow-${crypto.randomUUID()}` };
    }
    await act("booking", "/api/booking", {
      mentor_id: mentorRecord.id, funding_type: fundingType, idempotency_key: bookingKey.current.key,
      request_id: request.id, slot_id: selectedSlot.id,
    });
  }

  async function saveAvailability() {
    const rows = availabilityRows.filter(row => row.date || row.start || row.end);
    if (rows.some(row => !row.date || !row.start || !row.end || row.end <= row.start)) {
      setFormError("Enter a date and an end time later than the start time for every row."); return;
    }
    setFormError("");
    const result = await act("availability", "/api/workflow/availability", {
      mentor_id: mentorRecord?.id,
      slots: rows.map(row => ({ starts_at: new Date(`${row.date}T${row.start}:00+06:00`).toISOString(), ends_at: new Date(`${row.date}T${row.end}:00+06:00`).toISOString() })),
    });
    if (result.ok) {
      setAvailabilityDraft(null);
      setPreviewNotice("Availability saved. These session times are now visible in the entrepreneur’s bookings.");
    }
  }

  function updateAvailability(id, field, value) {
    setAvailabilityRows(rows => rows.map(row => row.id === id ? { ...row, [field]: value } : row));
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
  const videoButton = (
    <Button variant="outline" size="sm" title="Open video session preview" onClick={() => go(role === "mentor" ? "mentor-call" : "video-call")}>
      <Video className="size-3.5" /> Video session
    </Button>
  );
  const notificationButton = (
    <Button variant="ghost" size="icon" className="notification-button" aria-label="Notifications"
      aria-current={page === "notifications" || page === "mentor-notifications" ? "page" : undefined}
      onClick={() => go(role === "mentor" ? "mentor-notifications" : "notifications")}>
      <Bell className="size-[18px]" /><span className="notification-dot" aria-hidden="true" />
    </Button>
  );

  let content;

  if (page === "connect") {
    content = <>
      <div className="page-header"><div><p className="kicker">YOUR MENTORSHIP STARTS HERE</p><h1>Connect with mentor</h1><p className="subtitle">The right guidance, matched to what you’re building.</p></div>{videoButton}</div>
      {!mentorRecord ? <Card><CardContent className="empty-state"><Users className="size-8 text-primary" /><h2>{state?.entrepreneur?.assessment_completed_at ? "Ready to find your mentor" : "Let’s find your next step"}</h2><p className="muted">Share your needs so we can match you with a verified mentor.</p><Button disabled={Boolean(busy)} onClick={() => state?.entrepreneur?.assessment_completed_at ? act("matches", "/api/matches") : go("assessment")}>{busy === "matches" ? "Finding your mentor…" : state?.entrepreneur?.assessment_completed_at ? "Find my mentor" : "Complete needs assessment"}<ArrowRight className="size-4" /></Button></CardContent></Card> :
      <Card className="connection-card"><CardHeader><div className="row between wrap"><Badge variant="secondary" className="status-primary"><Sparkles className="size-3" />{booking ? "Your mentor" : "Your strongest match"}</Badge><Badge variant="secondary" className={booking ? "status-success" : "status-pending"}>{booking ? "Session booked" : request?.status === "pending" ? "Awaiting mentor" : request?.status === "accepted" ? "Request accepted" : request?.status === "declined" ? "Request declined" : "Ready to connect"}</Badge></div><CardTitle className="connection-title">Guidance for your next step.</CardTitle><CardDescription className="connection-description">{match?.explanation ?? mentor.description}</CardDescription></CardHeader>
        <CardContent className="stack"><div className="mentor-identity"><Avatar className="mentor-avatar"><AvatarFallback>{mentorInitials}</AvatarFallback></Avatar><div><h2>{mentor.name}</h2><p className="subtitle">{mentor.title}</p><div className="tag-list">{mentorRecord.verified && <Badge variant="outline"><ShieldCheck className="size-3" />Verified mentor</Badge>}<Badge variant="outline">{mentorRecord.sessions_delivered} sessions delivered</Badge></div></div></div><p className="muted leading-relaxed">{mentor.description}</p><div className="tag-list">{mentor.skills.map(skill => <Badge variant="secondary" key={skill}>{skill}</Badge>)}</div><Separator />
          <div className="details-grid">{[["Industry", mentor.sector], ["Languages", mentorRecord.languages.map(language => LANGUAGE_LABEL[language]).join(", ")], ["Session fee", formatNu(mentorRecord.fee)], ["Your compatibility", match ? `${match.score} / 100` : "Booked mentor"]].map(([label, value]) => <div key={label}><p className="detail-label">{label}</p><p className="detail-value">{value}</p></div>)}</div>
          <Alert><Check className="size-4" /><AlertTitle>{booking ? "Your session is booked" : "A mentor matched to your needs"}</AlertTitle><AlertDescription>{booking ? `${sessionTime(booking.scheduled_at)} · Bhutan time (UTC+6)` : request?.status === "pending" ? "Your mentor will review your request. Open the mentor workspace to try the response." : request?.status === "accepted" ? "Your mentor accepted. Choose one of their published session times." : request?.status === "declined" ? "This request was declined. Refresh your match to try again." : "Send a mentorship request, then choose a session time after your mentor accepts."}</AlertDescription></Alert>
          <div className="row wrap"><Button disabled={Boolean(busy)} onClick={async () => { if (booking || request) go("bookings"); else { const result = await act("request", "/api/workflow/request", { mentor_id: mentorRecord.id }); if (result.ok) go("bookings"); } }}><CalendarDays className="size-4" />{booking ? "View session details" : request ? "View request" : "Request this mentor"}<ArrowRight className="size-4" /></Button>{!booking && !["pending", "accepted"].includes(request?.status) && <Button variant="outline" disabled={Boolean(busy)} onClick={() => act("matches", "/api/matches")}>{busy === "matches" ? "Refreshing…" : "Refresh match"}</Button>}</div>
        </CardContent></Card>}
    </>;
  } else if (["assessment", "register-entrepreneur", "register-without-idea", "register-mentor"].includes(page)) {
    const registering = page !== "assessment";
    const isMentor = page === "register-mentor";
    const steps = isMentor ? mentorSteps : exploring ? explorerSteps : entrepreneurSteps;
    const activeStep = Math.min(step, steps.length - 1);
    const fields = registering ? steps[activeStep].fields : exploring ? explorerSteps.slice(1).flatMap(item => item.fields) : assessmentFields;
    const values = isMentor ? { ...mentorApplication, ...mentorDraft } : { ...profile, ...draft };
    const updateValue = (name, value) => isMentor ? setMentorDraft(current => ({ ...current, [name]: value })) : setDraft(current => ({ ...current, [name]: value }));

    content = <>
      <div className="page-header"><div>
        <p className="kicker">{registering ? "GET STARTED" : "ENTREPRENEUR PROFILE"}</p>
        <h1>{isMentor ? "Apply to become a mentor" : registering ? exploring ? "Start with your curiosity" : "Tell us about your idea" : "Needs assessment"}</h1>
        <p className="subtitle">{isMentor ? "Share your experience and availability." : exploring ? "You don’t need a business idea yet. Share your interests and what you’d like to explore." : "Tell us what you’re building so we can assign the right mentor."}</p>
      </div></div>
      <Card className="form-card"><CardContent><form onSubmit={event => {
        event.preventDefault();
        if (registering && activeStep < steps.length - 1) setStep(activeStep + 1);
        else if (isMentor) go("mentor-submitted");
        else void saveAssessment();
      }}>
        {registering && <Alert className="mb-6"><AlertTitle>{isMentor ? "Mentor application preview" : "Demo onboarding"}</AlertTitle><AlertDescription>{isMentor ? "This form is a design preview. No application is sent for review." : "No new account is created. Business answers update the local frontend preview; contact details and additional preferences stay in this tab."}</AlertDescription></Alert>}
        {!isMentor && registering && state && !state.seeded && <Alert className="mb-6"><AlertTitle>Load the demo before saving</AlertTitle><AlertDescription>The connected assessment needs the fictional demo profile.<Button type="button" variant="outline" disabled={Boolean(busy)} onClick={() => act("reset", "/api/demo/reset")}>{busy === "reset" ? "Loading…" : "Load demo data"}</Button></AlertDescription></Alert>}
        {registering && <><div className="signup-step-summary"><span>Step {activeStep + 1} of {steps.length}</span><strong>{steps[activeStep].title}</strong></div><div className="stepper" aria-label="Registration progress">
          {steps.map((item, index) => <div key={item.title} className={`registration-step ${index === step ? "current" : index < step ? "done" : ""}`} aria-current={index === step ? "step" : undefined}>
            <span className="step-bubble">{index < step ? <Check className="size-3.5" /> : index + 1}</span><span>{item.title}</span>
          </div>)}
        </div></>}
        <div className="form-grid" key={`${page}-${step}`}>
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
        {!isMentor && (!registering || activeStep === steps.length - 1) && <fieldset className="mt-6"><legend className="text-sm font-semibold">Where would you like support? (choose 1–5)</legend><div className="form-grid mt-3">{EXPERTISE.map(key => <div className="checkbox-row" key={key}><Checkbox id={`support-${key}`} checked={supportNeeds.includes(key)} disabled={!supportNeeds.includes(key) && supportNeeds.length >= 5} onCheckedChange={checked => setSupportDraft(current => { const selected = current ?? supportNeeds; return checked ? [...selected, key] : selected.filter(item => item !== key); })} /><Label htmlFor={`support-${key}`}>{expertiseLabel(key)}</Label></div>)}</div></fieldset>}
        {isMentor && step === 2 && <div className="checkbox-row"><Checkbox id="sponsored" defaultChecked /><Label htmlFor="sponsored">I accept eligible sponsored sessions</Label></div>}
        {isMentor && step === 3 && <>
          <Alert className="mt-6"><ShieldCheck className="size-4" /><AlertDescription>Mentor applications require human review before activation.</AlertDescription></Alert>
          <div className="checkbox-row"><Checkbox id="consent" /><Label htmlFor="consent">I confirm this information is accurate and consent to a human review.</Label></div>
        </>}
        <div className="form-nav">
          <Button type="button" variant="outline" disabled={Boolean(busy)} onClick={() => registering && activeStep > 0 ? setStep(activeStep - 1) : go(registering ? isMentor ? "welcome" : "signup-choice" : "connect")}><ArrowLeft className="size-4" />{registering && activeStep > 0 ? "Previous" : "Back"}</Button>
          <Button type="submit" disabled={Boolean(busy)}>
            {busy === "assessment" ? "Saving…" : busy === "matches" ? "Finding a mentor…" : registering && activeStep < steps.length - 1 ? "Continue" : isMentor ? "Preview application" : registering ? "Save assessment" : "Save needs & find mentor"}<ArrowRight className="size-4" />
          </Button>
        </div>
      </form></CardContent></Card>
    </>;
  } else if (page === "mentor-dashboard") {
    content = <>
      <div className="page-header"><div><p className="kicker">MENTOR WORKSPACE</p><h1>{mentorRecord ? `Welcome back, ${mentor.name.split(" ")[0]}` : "Welcome to your workspace"}</h1><p className="subtitle">Your experience can move a business forward.</p></div>{videoButton}</div>
      <div className="stack"><div className="hero"><div><p className="kicker">YOUR MENTORING IMPACT</p><h2>Practical guidance.<br />Meaningful connections.</h2><p>Review matched entrepreneurs and prepare for your next conversation.</p><Button size="sm" onClick={() => go("mentor-requests")}>Review requests<ArrowRight className="size-4" /></Button></div><Avatar className="hero-avatar"><AvatarFallback>{mentorInitials}</AvatarFallback></Avatar></div>
        <div className="stats-grid">{[["Pending requests", request?.status === "pending" ? 1 : 0, Inbox], ["Active mentees", booking ? 1 : 0, Users], ["Upcoming sessions", booking && booking.status !== "completed" ? 1 : 0, CalendarDays]].map(([label, value, Icon]) => <Card key={label}><CardContent className="stat-card"><div className="row between"><span className="muted">{label}</span><Icon className="size-4 text-primary" /></div><p className="stat-value">{value}</p></CardContent></Card>)}</div>
        <div className="split-main"><div className="stack"><Card><CardHeader><CardTitle>Mentorship requests</CardTitle><CardDescription>Entrepreneurs matched to your expertise.</CardDescription></CardHeader><CardContent>{request || booking ? <div className="list-row"><Avatar><AvatarFallback>{entrepreneurInitials}</AvatarFallback></Avatar><div className="grow"><h3>{profile.fullName}</h3><p className="subtitle">{profile.productName}</p></div><Badge variant="secondary" className={booking ? "status-success" : "status-pending"}>{booking ? "Booked" : request?.status ?? "No request"}</Badge></div> : <p className="muted">No mentorship requests yet.</p>}<Button variant="outline" size="sm" className="mt-4" onClick={() => go("mentor-requests")}>Review requests<ArrowRight className="size-3.5" /></Button></CardContent></Card>
        <Card><CardHeader><CardTitle>Your next session</CardTitle><CardDescription>{booking ? `${sessionTime(booking.scheduled_at)} · Bhutan time (UTC+6)` : "No session booked yet."}</CardDescription></CardHeader><CardContent><p className="muted">{booking ? `${profile.fullName} · ${booking.status === "completed" ? "Session completed" : mentor.title}` : "Session details and a preparation brief appear after booking."}</p><Button className="mt-4" variant="outline" size="sm" onClick={() => go(booking ? "workspace" : "availability")}>{booking ? "Open session workspace" : "Manage availability"}</Button></CardContent></Card></div>
        <Card><CardHeader><CardTitle>Your capacity</CardTitle><CardDescription>Availability for meaningful mentorship.</CardDescription></CardHeader><CardContent>{[["Available capacity", mentorRecord ? `${mentorRecord.slots_remaining} sessions` : "Not matched yet"], ["Languages", mentorRecord?.languages.map(language => LANGUAGE_LABEL[language]).join(", ") ?? "—"], ["Session fee", mentorRecord ? formatNu(mentorRecord.fee) : "—"]].map(([label, value]) => <div className="info-pair" key={label}><span>{label}</span><strong>{value}</strong></div>)}<Button className="mt-5 w-full" variant="outline" onClick={() => go("availability")}>Manage availability</Button></CardContent></Card></div>
      </div>
    </>;
  } else if (page === "mentor-requests") {
    content = <><div className="page-header"><div><p className="kicker">MENTOR REQUESTS</p><h1>Mentorship requests</h1><p className="subtitle">Understand the entrepreneur’s goals before your conversation.</p></div></div>
      {!request ? <Card><CardContent className="empty-state"><Inbox className="size-8 text-primary" /><h2>No requests yet</h2><p className="muted">A request appears when the entrepreneur chooses “Request this mentor” on their connection page.</p></CardContent></Card> :
      <Card><CardHeader><div className="row between wrap"><div className="mentor-identity"><Avatar className="size-14"><AvatarFallback>{entrepreneurInitials}</AvatarFallback></Avatar><div><CardTitle>{profile.fullName}</CardTitle><CardDescription>{profile.productName} · {profile.industry}</CardDescription><div className="tag-list"><Badge variant="secondary">{profile.stage}</Badge><Badge variant="outline">{profile.district}</Badge></div></div></div><Badge variant="secondary" className={request.status === "pending" ? "status-pending" : "status-success"}>{booking ? "Session booked" : request.status}</Badge></div></CardHeader><CardContent className="stack">
        <div className="cols-2"><div><h3>What your mentee needs</h3><p className="muted leading-relaxed mt-2">{profile.challenge}</p><h3 className="mt-6">Mentorship goal</h3><p className="muted leading-relaxed mt-2">{profile.goal}</p></div><div><h3>Why you were matched</h3><p className="muted leading-relaxed mt-2">{match?.explanation ?? mentor.description}</p>{[["Mentor", mentor.name], ["Compatibility", match ? `${match.score} / 100` : "Booked mentor"], ["Language", profile.language], ["Budget", formatNu(Number(profile.budget))]].map(([label, value]) => <div className="info-pair" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div></div><Separator />
        {booking ? <Button className="self-start" onClick={() => go("workspace")}>Open session workspace<ArrowRight className="size-4" /></Button> : request.status === "pending" ? <div className="row wrap"><Button disabled={Boolean(busy)} onClick={() => act("respond", "/api/workflow/respond", { request_id: request.id, decision: "accepted" })}><Check className="size-4" />Accept request</Button><Button variant="outline" disabled={Boolean(busy)} onClick={() => act("respond", "/api/workflow/respond", { request_id: request.id, decision: "declined" })}>Decline request</Button></div> : <Alert><AlertTitle>{request.status === "accepted" ? "Request accepted" : "Request declined"}</AlertTitle><AlertDescription>{request.status === "accepted" ? "Publish your session times so the entrepreneur can book." : "The entrepreneur has been notified of your response."}{request.status === "accepted" && <Button variant="outline" className="self-start" onClick={() => go("availability")}>Set availability</Button>}</AlertDescription></Alert>}
      </CardContent></Card>}</>;
  } else if (page === "bookings") {
    const insufficientCredit = fundingType === "ydf_credit" && (!state?.credit || state.credit.status !== "active" || state.credit.amount_remaining < (mentorRecord?.fee ?? 0));
    content = <><div className="page-header"><div><p className="kicker">YOUR MENTORSHIP SESSIONS</p><h1>My bookings</h1><p className="subtitle">Make space for a useful conversation.</p></div></div>
      {booking ? <div className="stack"><Card className="form-card"><CardHeader><div className="row between wrap"><CardTitle>Your session details</CardTitle><Badge variant="secondary" className="status-success">{booking.status === "completed" ? "Completed" : "Confirmed"}</Badge></div><CardDescription>Your session with {mentor.name}.</CardDescription></CardHeader><CardContent className="stack"><div className="mentor-identity"><Avatar className="size-12"><AvatarFallback>{mentorInitials}</AvatarFallback></Avatar><div><h2>{mentor.name}</h2><p className="subtitle">{mentor.title}</p></div></div>{[["Date & time", sessionTime(booking.scheduled_at)], ["Timezone", "Bhutan time (UTC+6)"], ["Session fee", formatNu(booking.fee)], ["Funding", booking.funding_type === "ydf_credit" ? "Simulated YDF credit" : "Simulated self-payment"]].map(([label, value]) => <div className="info-pair" key={label}><span>{label}</span><strong>{value}</strong></div>)}<Button variant="outline" className="self-start" disabled={booking.status === "completed"} onClick={() => go("video-call")}><Video className="size-4" />Preview session room</Button></CardContent></Card>
        <Card className="form-card"><CardHeader><CardTitle>Prepare for your session</CardTitle><CardDescription>{booking.entrepreneur_brief?.headline ?? "Your preparation brief is being prepared."}</CardDescription></CardHeader><CardContent className="stack">{booking.entrepreneur_brief && <><div><h3>Before you meet</h3><ul className="mt-2 list-disc pl-5 space-y-2">{booking.entrepreneur_brief.prepare.map(item => <li key={item}>{item}</li>)}</ul></div><div><h3>Questions to ask</h3><ul className="mt-2 list-disc pl-5 space-y-2">{booking.entrepreneur_brief.questions_to_ask.map(item => <li key={item}>{item}</li>)}</ul></div></>}</CardContent></Card></div> : !mentorRecord ? <Card><CardContent className="empty-state"><CalendarDays className="size-8 text-primary" /><h2>Find your mentor first</h2><p className="muted">Complete your needs assessment and matching before booking.</p><Button variant="outline" onClick={() => go("connect")}>View connection<ArrowRight className="size-4" /></Button></CardContent></Card> :
      <div className="split-main"><Card><CardHeader><CardTitle>Confirm your session</CardTitle><CardDescription>Choose a published session time after your mentor accepts. Payments are simulated.</CardDescription></CardHeader><CardContent className="stack">{request?.status !== "accepted" && <Alert><AlertTitle>{request?.status === "pending" ? "Waiting for your mentor" : request?.status === "declined" ? "Request declined" : "Request a mentor first"}</AlertTitle><AlertDescription>{request?.status === "pending" ? "Your request is waiting for a response from your mentor." : "Return to your connection page to send a mentorship request."}</AlertDescription></Alert>}<div className="field"><Label htmlFor="booking-slot">Session date & time · Bhutan (UTC+6)</Label><Select value={selectedSlot?.id ?? ""} onValueChange={setSelectedSlotId} disabled={Boolean(busy) || request?.status !== "accepted" || !availableSlots.length}><SelectTrigger id="booking-slot" className="w-full"><SelectValue placeholder="Choose a session time" /></SelectTrigger><SelectContent>{availableSlots.map(slot => <SelectItem key={slot.id} value={slot.id}>{sessionTime(slot.starts_at)}</SelectItem>)}</SelectContent></Select>{request?.status === "accepted" && availableSlots.length === 0 && <p className="muted">Your mentor has not published any upcoming times yet.</p>}</div><div className="field"><Label htmlFor="booking-funding">Funding option</Label><Select value={fundingType} onValueChange={setFundingType} disabled={Boolean(busy)}><SelectTrigger id="booking-funding" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ydf_credit">YDF sponsorship credit</SelectItem><SelectItem value="self_paid">Self-payment (simulated)</SelectItem></SelectContent></Select></div><p className="muted">YDF credit available: {formatNu(state?.credit?.amount_remaining ?? 0)}</p>{insufficientCredit && <Alert><AlertTitle>YDF credit unavailable</AlertTitle><AlertDescription>Choose simulated self-payment or arrange sufficient active sponsorship credit.</AlertDescription></Alert>}<Alert><CalendarDays className="size-4" /><AlertTitle>Session availability</AlertTitle><AlertDescription>{availableSlots.length ? `${availableSlots.length} published session time(s). Choose a time above.` : "Ask your mentor to publish available session times."}</AlertDescription></Alert><div className="form-nav"><Button variant="outline" onClick={() => go("connect")}><ArrowLeft className="size-4" />Back</Button><Button disabled={Boolean(busy) || insufficientCredit || !selectedSlot || request?.status !== "accepted"} onClick={confirmBooking}>{busy === "booking" ? "Confirming…" : "Confirm booking"}<ArrowRight className="size-4" /></Button></div></CardContent></Card>
        <Card><CardHeader><CardTitle>Session overview</CardTitle><CardDescription>Plan your conversation with {mentor.name.split(" ")[0]}.</CardDescription></CardHeader><CardContent>{[["Mentor", mentor.name], ["Availability", availableSlots.length ? `${availableSlots.length} published session time(s)` : "Waiting for published times"], ["Timezone", "Bhutan (UTC+6)"], ["Session fee", formatNu(mentorRecord.fee)]].map(([label, value]) => <div className="info-pair" key={label}><span>{label}</span><strong>{value}</strong></div>)}</CardContent></Card></div>}</>;
  } else if (page === "mentees") {
    content = <><div className="page-header"><div><p className="kicker">MENTOR RELATIONSHIPS</p><h1>My mentees</h1></div></div>{booking ? <Card><CardContent><div className="list-row wrap"><Avatar className="size-12"><AvatarFallback>{entrepreneurInitials}</AvatarFallback></Avatar><div className="grow"><h2>{profile.fullName}</h2><p className="subtitle">{profile.productName}</p></div><Badge variant="secondary" className="status-success">Connected</Badge><Button variant="outline" onClick={() => go("workspace")}>Session workspace<ArrowRight className="size-4" /></Button></div></CardContent></Card> : <Card><CardContent className="empty-state"><Users className="size-8 text-primary" /><h2>No active mentees yet</h2><p className="muted">Booked connections will appear here.</p><Button variant="outline" onClick={() => go("mentor-requests")}>Review requests</Button></CardContent></Card>}</>;
  } else if (page === "workspace") {
    content = <><div className="page-header"><div><p className="kicker">MENTOR SESSION PREPARATION</p><h1>Session workspace</h1></div></div>{!booking ? <Card><CardContent className="empty-state"><ShieldCheck className="size-8 text-primary" /><h2>Session access is waiting</h2><p className="muted">Your session workspace becomes available after booking.</p><Button variant="outline" onClick={() => go("mentor-requests")}>Review requests<ArrowRight className="size-4" /></Button></CardContent></Card> : <div className="stack">
      <Card><CardHeader><CardTitle>Session with {profile.fullName}</CardTitle><CardDescription>{sessionTime(booking.scheduled_at)} · Bhutan time (UTC+6)</CardDescription></CardHeader><CardContent className="stack">{booking.mentor_brief ? <><h3>{booking.mentor_brief.headline}</h3><p className="muted">{booking.mentor_brief.about}</p><div><h3>Suggested focus</h3><ul className="list-disc pl-5 mt-2 space-y-2">{booking.mentor_brief.focus.map(item => <li key={item}>{item}</li>)}</ul></div></> : <p className="muted">Your preparation brief is being prepared.</p>}</CardContent></Card>
      {!state?.session?.completed_at && <Card><CardHeader><CardTitle>After the session</CardTitle><CardDescription>Save your notes and review sample actions. AI extraction will be connected by the backend team.</CardDescription></CardHeader><CardContent><form className="stack" onSubmit={async event => { event.preventDefault(); await act("notes", "/api/session/complete", { booking_id: booking.id, notes }); }}><div className="field"><Label htmlFor="session-notes">Session notes</Label><Textarea id="session-notes" value={notes} onChange={event => setNotes(event.target.value)} required maxLength={4000} rows={8} /></div><Button type="submit" className="self-start" disabled={Boolean(busy) || !notes.trim()}>{busy === "notes" ? "Extracting draft actions…" : "Complete session & save notes"}</Button></form></CardContent></Card>}
      {drafts.length > 0 && <Card><CardHeader><CardTitle>Review draft actions</CardTitle><CardDescription>{state.session?.agent_summary}</CardDescription></CardHeader><CardContent className="stack"><Alert><AlertTitle>Human confirmation required</AlertTitle><AlertDescription>Only the actions you confirm will be tracked. Untick anything that is incorrect.</AlertDescription></Alert>{drafts.map(item => <div className="checkbox-row" key={item.id}><Checkbox id={`action-${item.id}`} checked={!excludedActions.includes(item.id)} onCheckedChange={checked => setExcludedActions(items => checked ? items.filter(id => id !== item.id) : [...items, item.id])} /><Label htmlFor={`action-${item.id}`} className="stack-tight"><strong>{item.title}</strong><span>{item.description}</span><span>Owner: {item.owner} · Due {item.due_in_days} days after confirmation</span></Label></div>)}<Button className="self-start" disabled={Boolean(busy) || drafts.every(item => excludedActions.includes(item.id))} onClick={() => act("confirm", "/api/actions/confirm", { session_id: state.session.id, action_ids: drafts.filter(item => !excludedActions.includes(item.id)).map(item => item.id) })}>{busy === "confirm" ? "Confirming…" : "Confirm selected actions"}</Button></CardContent></Card>}
      {state?.session?.completed_at && <Card><CardHeader><CardTitle>Session notes & agreed actions</CardTitle><CardDescription>{state.session.agent_summary}</CardDescription></CardHeader><CardContent className="stack"><p className="muted whitespace-pre-wrap">{state.session.mentor_notes}</p>{state.actions.filter(item => item.status !== "draft").map(item => <div className="info-pair" key={item.id}><span>{item.title}</span><strong>{item.status} · {relativeDue(item.due_at, state.clock.now)}</strong></div>)}</CardContent></Card>}
    </div>}</>;
  } else if (page === "availability") {
    content = <>
      <div className="page-header"><div><p className="kicker">MENTOR SCHEDULE</p><h1>Availability & preferences</h1><p className="subtitle">Make time for focused conversations.</p></div></div>
      <Alert className="mb-6"><AlertTitle>Shared availability</AlertTitle><AlertDescription>Save session times here to make them available in the entrepreneur’s booking screen. Each row represents one session. Booked times are preserved.</AlertDescription></Alert>
      <div className="split-main">
        <Card><CardHeader><CardTitle>Set your available dates & times</CardTitle><CardDescription>Add a date and a start and end time for each session you can offer. All times are in Bhutan time (UTC+6).</CardDescription></CardHeader><CardContent className="stack">
          <div className="stack-tight">{availabilityRows.map((row, index) => <div className="availability-entry" key={row.id}>
            <div className="row between"><h3>Availability {index + 1}</h3><Button variant="ghost" size="icon" aria-label={`Remove availability ${index + 1}`} disabled={Boolean(busy)} onClick={() => setAvailabilityRows(rows => rows.filter(item => item.id !== row.id))}><Trash2 className="size-3.5" /></Button></div>
            <div className="availability-fields">
              <div className="field availability-date"><Label htmlFor={`date-${row.id}`}>Date</Label><Input id={`date-${row.id}`} type="date" value={row.date} onChange={event => updateAvailability(row.id, "date", event.target.value)} /></div>
              <div className="field"><Label htmlFor={`start-${row.id}`}>Start time</Label><Input id={`start-${row.id}`} type="time" value={row.start} onChange={event => updateAvailability(row.id, "start", event.target.value)} /></div>
              <div className="field"><Label htmlFor={`end-${row.id}`}>End time</Label><Input id={`end-${row.id}`} type="time" value={row.end} onChange={event => updateAvailability(row.id, "end", event.target.value)} /></div>
            </div>
          </div>)}</div>
          <Button variant="outline" className="self-start" onClick={() => setAvailabilityRows(rows => [...rows, { id: crypto.randomUUID(), date: "", start: "", end: "" }])}><Plus className="size-4" />Add another date & time</Button>
          <Separator />
          <div className="row between wrap"><p className="subtitle">Session times in Bhutan time (UTC+6).</p><Button disabled={Boolean(busy) || !mentorRecord} onClick={saveAvailability}>{busy === "availability" ? "Saving…" : "Save availability"}</Button></div>
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Current availability</CardTitle></CardHeader><CardContent>{[["Availability", mentorRecord?.availability_summary ?? "Not matched yet"], ["Languages", mentorRecord?.languages.map(language => LANGUAGE_LABEL[language]).join(", ") ?? "—"], ["Published open slots", availableSlots.length], ["Timezone", "Bhutan (UTC+6)"]].map(([label, value]) => <div className="info-pair" key={label}><span>{label}</span><strong>{value}</strong></div>)}</CardContent></Card>
      </div>
    </>;
  } else if (page === "mentor-profile") {
    content = <><div className="page-header"><div><p className="kicker">PROFESSIONAL PROFILE</p><h1>My mentor profile</h1></div><Button variant="outline" onClick={() => go("availability")}>Manage availability</Button></div><div className="split-main"><div className="stack"><Card><CardHeader><div className="mentor-identity"><Avatar className="mentor-avatar"><AvatarFallback>{mentorInitials}</AvatarFallback></Avatar><div><CardTitle>{mentor.name}</CardTitle><CardDescription>{mentor.title}</CardDescription>{mentorRecord?.verified && <Badge className="mt-3" variant="secondary"><ShieldCheck className="size-3" />Verified mentor</Badge>}</div></div></CardHeader><CardContent><h3>About</h3><p className="muted leading-relaxed mt-3">{mentor.description}</p></CardContent></Card><Card><CardHeader><CardTitle>My expertise</CardTitle></CardHeader><CardContent><div className="tag-list mb-4">{mentor.skills.map(skill => <Badge variant="secondary" key={skill}>{skill}</Badge>)}</div>{[["Sessions delivered", mentorRecord?.sessions_delivered ?? "—"], ["Industry", mentor.sector], ["Languages", mentorRecord?.languages.map(language => LANGUAGE_LABEL[language]).join(", ") ?? "—"]].map(([label, value]) => <div className="info-pair" key={label}><span>{label}</span><strong>{value}</strong></div>)}</CardContent></Card></div><Card><CardHeader><CardTitle>Mentoring capacity</CardTitle></CardHeader><CardContent>{[["Available capacity", mentorRecord ? `${mentorRecord.slots_remaining} sessions` : "—"], ["Session fee", mentorRecord ? formatNu(mentorRecord.fee) : "—"], ["Verification", mentorRecord?.verified ? "Approved" : "Not matched yet"]].map(([label, value]) => <div className="info-pair" key={label}><span>{label}</span><strong>{value}</strong></div>)}</CardContent></Card></div></>;
  } else if (page === "notifications" || page === "mentor-notifications") {
    const messages = state?.messages ?? [];
    const actions = state?.actions.filter(item => item.status !== "draft") ?? [];
    const mentorNotices = [
      ...(request && !booking ? [["Mentorship request: " + request.status, `${profile.fullName} sent a mentorship request.`, "mentor-requests", "Review match"]] : []),
      ...(booking ? [[booking.status === "completed" ? "Session completed" : "Your session is booked", `${profile.fullName} · ${sessionTime(booking.scheduled_at)} · Bhutan time`, "workspace", "Open session workspace"]] : []),
    ];
    const count = role === "mentor" ? mentorNotices.length : messages.length;
    content = <><div className="page-header"><div><p className="kicker">YOUR UPDATES</p><h1>Notifications</h1><p className="subtitle">A few things to keep you in the loop.</p></div><Badge variant="secondary">{count} update{count === 1 ? "" : "s"}</Badge></div><div className="stack">
      {count === 0 && <Card><CardContent className="empty-state"><Bell className="size-8 text-primary" /><h2>You’re all caught up</h2><p className="muted">Updates appear here as your mentorship progresses.</p></CardContent></Card>}
      {role === "mentor" ? mentorNotices.map(([title, body, nextPage, action]) => <Card key={title}><CardHeader><CardTitle>{title}</CardTitle><CardDescription>{body}</CardDescription></CardHeader><CardContent><Button variant="outline" size="sm" onClick={() => go(nextPage)}>{action}<ArrowRight className="size-3.5" /></Button></CardContent></Card>) : <>
        {messages.map(message => <Card key={message.id}><CardHeader><div className="row between wrap"><CardTitle>{message.sender === "agent" ? "Mentorship update" : message.sender === "entrepreneur" ? "Your reply" : "Programme update"}</CardTitle><Badge variant="outline">{message.kind.replaceAll("_", " ")}</Badge></div><CardDescription className="whitespace-pre-wrap">{profile.language === "Dzongkha" && message.dz_verified && message.body_dz ? message.body_dz : message.body}</CardDescription>{profile.language === "Dzongkha" && message.dz_verified && message.body_dz && <p className="muted">English: {message.body}</p>}</CardHeader>{message.awaiting_reply && <CardContent><form className="stack" onSubmit={async event => { event.preventDefault(); const result = await act("reply", "/api/inbox/reply", { message_id: message.id, body: replies[message.id] ?? "" }); if (result.ok) setReplies(items => ({ ...items, [message.id]: "" })); }}><div className="field"><Label htmlFor={`reply-${message.id}`}>Your reply</Label><Textarea id={`reply-${message.id}`} value={replies[message.id] ?? ""} onChange={event => setReplies(items => ({ ...items, [message.id]: event.target.value }))} required maxLength={1000} rows={3} /></div><Button className="self-start" type="submit" disabled={Boolean(busy) || !replies[message.id]?.trim()}>{busy === "reply" ? "Sending…" : "Send reply"}<ArrowRight className="size-4" /></Button></form></CardContent>}</Card>)}
        {actions.length > 0 && <Card><CardHeader><CardTitle>Your agreed next steps</CardTitle><CardDescription>Actions confirmed after your mentoring session.</CardDescription></CardHeader><CardContent className="stack">{actions.map(item => <div className="row between wrap" key={item.id}><div className="grow"><h3>{item.title}</h3><p className="subtitle">{relativeDue(item.due_at, state.clock.now)}{item.blocker ? ` · ${item.blocker}` : ""}</p></div><Badge variant="secondary">{item.status}</Badge>{item.owner === "entrepreneur" && ["pending", "overdue"].includes(item.status) && <Button variant="outline" size="sm" disabled={Boolean(busy)} onClick={() => act("action", "/api/actions/status", { action_id: item.id, status: "completed" })}>Mark complete</Button>}</div>)}</CardContent></Card>}
      </>}
    </div></>;
  } else if (isLogin) {
    content = <div className="login-screen">
      <Button variant="ghost" className="self-start mb-5" onClick={() => go("welcome")}><ArrowLeft className="size-4" />Back</Button>
      <div className="page-header"><div><p className="kicker">{role === "mentor" ? "MENTOR SIGN IN" : "YOUR NEXT STEP IS WAITING"}</p><h1>Welcome back.</h1><p className="subtitle">{role === "mentor" ? "A little of your experience can make a big difference." : "Pick up your journey, one conversation at a time."}</p></div></div>
      <Alert className="mb-6"><AlertTitle>Sign-in preview</AlertTitle><AlertDescription>Authentication is not connected. Continue to the shared demo workspace; these credentials are not sent or saved.</AlertDescription></Alert>
      <Card><CardHeader><CardTitle>Sign in to your {role === "mentor" ? "mentor" : "entrepreneur"} account</CardTitle><CardDescription>Good to have you here again.</CardDescription></CardHeader><CardContent>
        <form className="stack" onSubmit={event => { event.preventDefault(); go(role === "mentor" ? "mentor-dashboard" : "connect"); }}>
          <div className="field"><Label htmlFor="login-email">Email address</Label><Input id="login-email" type="email" autoComplete="username" placeholder="you@example.com" /></div>
          <div className="field"><Label htmlFor="login-password">Password</Label><div className="password-field"><Input id="login-password" type={passwordVisible ? "text" : "password"} autoComplete="current-password" placeholder="Enter your password" /><Button type="button" variant="ghost" size="icon" className="password-toggle" aria-label={passwordVisible ? "Hide password" : "Show password"} onClick={() => setPasswordVisible(visible => !visible)}>{passwordVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</Button></div></div>
          <div className="checkbox-row login-remember"><Checkbox id="remember-login" /><Label htmlFor="remember-login">Remember me</Label></div>
          <Button type="submit" className="w-full login-submit">Open demo workspace<ArrowRight className="size-4" /></Button>
        </form>
      </CardContent></Card>
      {role === "entrepreneur" ? <div className="login-footer"><p className="subtitle">New here? There’s a place for you.</p><Button variant="link" onClick={() => go("signup-choice")}>Start your journey<ArrowRight className="size-3.5" /></Button></div> : <p className="subtitle text-center mt-6">Your mentor account is provided by the programme.</p>}
    </div>;
  } else if (isCall) {
    const otherName = role === "mentor" ? profile.fullName : mentor.name;
    const otherInitials = role === "mentor" ? entrepreneurInitials : mentorInitials;
    const selfInitials = role === "mentor" ? mentorInitials : entrepreneurInitials;
    const returnPage = role === "mentor" ? "mentor-dashboard" : "bookings";
    content = <main className="call-room" aria-label="Video session preview">
      <header className="call-header"><div className="row"><Button variant="ghost" size="icon" className="call-back" aria-label="Back to sessions" onClick={() => go(returnPage)}><ArrowLeft className="size-5" /></Button><div><p className="call-kicker">MENTORING SESSION</p><h1>Session room</h1></div></div><Badge variant="outline" className="call-preview-badge">Frontend preview</Badge></header>
      <Card className="call-stage">
        <Badge variant="outline" className="participant-role">{role === "mentor" ? "Your mentee" : "Your mentor"}</Badge>
        <div className="call-participant"><Avatar className="call-participant-avatar"><AvatarFallback>{otherInitials}</AvatarFallback></Avatar><h2>{otherName}</h2><p role="status">{!callReady ? "Book an upcoming session to open the room." : isPreviewParticipantPresent(state, role === "mentor" ? "entrepreneur" : "mentor", snapshotNow) ? `${otherName.split(" ")[0]} joined this preview` : `Waiting for ${otherName.split(" ")[0]} to join…`}</p>{booking && <p className="text-xs">Room {booking.id.slice(0, 8)}</p>}<span className="call-waiting-mark"><span /><span /><span /></span></div>
        <Card className="call-self-view"><Avatar className="call-self-avatar"><AvatarFallback>{selfInitials}</AvatarFallback></Avatar><span className="self-camera-label">{cameraOff ? "Camera off" : "Camera preview"}</span><div className="self-view-caption"><span>You</span>{micMuted ? <MicOff className="size-3" /> : <Mic className="size-3" />}</div></Card>
        <div className="call-stage-caption"><ShieldCheck className="size-3.5" /><span>A space for your next step</span></div>
        {callChatOpen && <Card className="call-chat"><CardHeader><div className="row between"><CardTitle>Session chat</CardTitle><Button variant="ghost" size="icon" aria-label="Close chat" onClick={() => setCallChatOpen(false)}><X className="size-4" /></Button></div><CardDescription>Preview messages sync between tabs in this browser.</CardDescription></CardHeader><CardContent className="stack">{lastError && <p role="alert">{lastError.message}</p>}<div className="max-h-48 overflow-y-auto space-y-3" role="log" aria-label="Session messages">{(state?.workflow?.call.messages ?? []).map(message => <p key={message.id} className="break-words"><strong>{message.role === role ? "You" : otherName}: </strong>{message.body}</p>)}</div><form className="row" onSubmit={async event => { event.preventDefault(); const result = await act("chat", "/api/preview/call", { booking_id: booking.id, role, action: "message", body: chatMessage }); if (result.ok) setChatMessage(""); }}><Input value={chatMessage} onChange={event => setChatMessage(event.target.value)} maxLength={1000} placeholder="Write a message…" aria-label="Chat message" disabled={!callReady} /><Button type="submit" size="icon" disabled={!callReady || Boolean(busy) || !chatMessage.trim()} aria-label="Send message"><ArrowRight className="size-4" /></Button></form></CardContent></Card>}
      </Card>
      <footer className="call-footer"><div className="call-controls">
        <div className="call-action"><Button variant="secondary" size="icon" disabled={!callReady} className={`call-control ${micMuted ? "control-muted" : ""}`} aria-label={micMuted ? "Unmute microphone" : "Mute microphone"} aria-pressed={!micMuted} onClick={() => setMicMuted(muted => !muted)}>{micMuted ? <MicOff className="size-5" /> : <Mic className="size-5" />}</Button><span>{micMuted ? "Unmute" : "Mute"}</span></div>
        <div className="call-action"><Button variant="secondary" size="icon" disabled={!callReady} className={`call-control ${cameraOff ? "control-muted" : ""}`} aria-label={cameraOff ? "Turn camera on" : "Turn camera off"} aria-pressed={!cameraOff} onClick={() => setCameraOff(off => !off)}>{cameraOff ? <VideoOff className="size-5" /> : <Video className="size-5" />}</Button><span>Camera</span></div>
        <div className="call-action"><Button variant="secondary" size="icon" className={`call-control ${callChatOpen ? "control-selected" : ""}`} aria-label="Session chat" aria-expanded={callChatOpen} onClick={() => setCallChatOpen(open => !open)}><MessageCircle className="size-5" /></Button><span>Chat</span></div>
        <div className="call-action"><Button variant="destructive" size="icon" className="call-control call-leave" aria-label="Leave video session" onClick={() => go(returnPage)}><PhoneOff className="size-5" /></Button><span>Leave</span></div>
      </div><p className="call-preview-note">UI preview · No audio or video is shared</p></footer>
    </main>;
  } else if (page === "signup-choice") {
    content = <div className="signup-choice">
      <Button variant="ghost" className="self-start mb-5" onClick={() => go("welcome")}><ArrowLeft className="size-4" />Back</Button>
      <div className="page-header"><div><p className="kicker">START WHERE YOU ARE</p><h1>Where are you in your journey?</h1><p className="subtitle">An idea is a starting point. Curiosity is one, too.</p></div></div>
      <div className="signup-options">
        <Button variant="outline" className="signup-choice-tile" onClick={() => go("register-entrepreneur")}><span className="choice-icon"><Lightbulb className="size-6" /></span><span>I have an idea</span></Button>
        <Button variant="outline" className="signup-choice-tile" onClick={() => go("register-without-idea")}><span className="choice-icon"><Compass className="size-6" /></span><span>I don’t have an idea yet</span></Button>
      </div>
      <p className="subtitle text-center mt-6">Both paths connect you with human guidance. Start with what you know today.</p>
    </div>;
  } else if (page === "mentor-submitted") {
    content = <Card className="form-card"><CardHeader><ShieldCheck className="size-8 text-primary" /><CardTitle>Application preview complete</CardTitle><CardDescription>Your draft remains in this tab. No application has been submitted and no mentor approval has been requested.</CardDescription></CardHeader><CardContent><Badge variant="secondary" className="status-pending">Preview only</Badge><div className="mt-6"><Button variant="outline" onClick={() => go("register-mentor")}>Review draft</Button><Button variant="ghost" onClick={() => go("welcome")}>Back to welcome</Button></div></CardContent></Card>;
  } else if (page === "welcome") {
    content = <div className="welcome-grid"><div>
      <p className="kicker">BUILT FOR ENTREPRENEURS IN BHUTAN</p><h1>Meaningful guidance.<br /><span className="text-primary">Your next step.</span></h1>
      <p className="welcome-lead">Have an idea, or just the curiosity to start? Find a mentor who can help you discover your direction and take your next step.</p>
      <div className="row wrap mt-7"><Button onClick={() => go("signup-choice")}>Start your journey <ArrowRight className="size-4" /></Button></div>
      <p className="subtitle mt-4">With an idea or without one, you’re welcome here.</p>
      <div className="feature-points"><span><Check className="size-3.5" /> Needs-based matching</span><span><Check className="size-3.5" /> Human-led mentoring</span></div>
    </div></div>;
  }

  if (!page) {
    return pathname === "/ydf" ? <main className="legacy-demo mx-auto w-full max-w-6xl px-4 py-6"><div className="row wrap mb-6"><Button variant="outline" asChild><Link href="/">MentorFlow home</Link></Button><Button variant="outline" asChild><Link href="/entrepreneur/connect">Entrepreneur</Link></Button><Button variant="outline" asChild><Link href="/mentor/dashboard">Mentor workspace</Link></Button></div>{children}</main> : children;
  }

  if (isCall) return <>{children}{content}</>;

  if (!isPublic && (!state || !state.seeded)) {
    content = <Card><CardContent className="empty-state"><Users className="size-8 text-primary" /><h1>{error ? "Mentorship data is unavailable" : state ? "Start the mentoring demo" : "Loading your workspace…"}</h1><p className="muted">{error ? "We couldn’t load your mentorship information. Please check the server connection and try again." : state ? "Load the fictional entrepreneur, mentor profiles and sponsorship credit to explore the connected flow." : "Getting your latest mentorship information."}</p>{error ? <Button variant="outline" onClick={() => refresh()}>Try again</Button> : state && <Button disabled={Boolean(busy)} onClick={() => act("reset", "/api/demo/reset")}>{busy === "reset" ? "Loading…" : "Load demo data"}</Button>}</CardContent></Card>;
  }

  const notices = <>
    {FRONTEND_PREVIEW && !isPublic && <Alert className="mb-6"><AlertTitle>Frontend preview · Sample data</AlertTitle><AlertDescription>Both roles share this browser’s preview. Open the other workspace in a second tab to test the flow.<div className="row wrap"><Button variant="link" className="px-0" asChild><Link href={role === "mentor" ? "/entrepreneur/connect" : "/mentor/dashboard"} target="_blank" rel="noopener">Open {role === "mentor" ? "entrepreneur" : "mentor"} workspace</Link></Button><Button variant="link" disabled={Boolean(busy)} onClick={() => act("reset", "/api/demo/reset")}>Reset preview</Button></div></AlertDescription></Alert>}
    {lastError && <Alert variant="destructive" className="mb-6"><AlertTitle>That didn’t work</AlertTitle><AlertDescription>{lastError.message}<Button type="button" variant="link" className="self-start px-0" onClick={clearLastError}>Dismiss</Button></AlertDescription></Alert>}
    {formError && <Alert variant="destructive" className="mb-6"><AlertTitle>Please check your answers</AlertTitle><AlertDescription>{formError}</AlertDescription></Alert>}
    {previewNotice && <Alert className="mb-6"><AlertTitle>Preview updated</AlertTitle><AlertDescription>{previewNotice}</AlertDescription></Alert>}
    {!isPublic && state?.seeded && error && <Alert variant="destructive" className="mb-6"><AlertTitle>Updates are unavailable</AlertTitle><AlertDescription>You’re viewing the last loaded information.<Button variant="link" onClick={() => refresh()}>Try again</Button></AlertDescription></Alert>}
  </>;

  return isPublic ? (
    <div className="public">
      <header className="public-top">{page !== "welcome" && <Button variant="ghost" className="brand-button" onClick={() => go("welcome")} aria-label="MentorFlow home">{brand}</Button>}{!isLogin && <nav aria-label="Public navigation"><Button variant="ghost" size="sm" onClick={() => go(role === "mentor" ? "mentor-login" : "login")}>Sign in<ArrowRight className="size-3.5" /></Button></nav>}</header>
      <main className="public-main">{children}{notices}{content}</main>
    </div>
  ) : role === "entrepreneur" ? (
    <div className="entrepreneur-app">
      <header className="entrepreneur-topbar">
        <span className="app-area-label">Entrepreneur{FRONTEND_PREVIEW && " · Preview"}</span>
        <div className="row">{notificationButton}<Avatar className="size-8"><AvatarFallback>{entrepreneurInitials}</AvatarFallback></Avatar></div>
      </header>
      <main className="entrepreneur-content">{children}{notices}{content}</main>
      <nav className="entrepreneur-navbar" aria-label="Entrepreneur navigation">
        {navigation.entrepreneur.map(([id, label, Icon]) => <Button key={id} variant="ghost" className={`app-nav-item ${page === id ? "active" : ""}`} aria-current={page === id ? "page" : undefined} onClick={() => go(id)}><Icon className="size-5" strokeWidth={1.7} /><span>{label}</span></Button>)}
      </nav>
    </div>
  ) : (
    <div className="app-shell mentor-app">
      <aside className="sidebar">
        <p className="side-group">MENTOR WORKSPACE</p>
        <nav className="nav-items" aria-label="Mentor navigation">
          {navigation.mentor.map(([id, label, Icon]) => <Button key={id} variant="ghost" className={`nav-item ${page === id ? "active" : ""}`} aria-current={page === id ? "page" : undefined} onClick={() => go(id)}><Icon className="size-[18px]" /><span>{label}</span></Button>)}
        </nav>
        <div className="side-bottom">
          <Button variant="ghost" className="nav-item" onClick={() => go("welcome")}><ArrowLeft className="size-[18px]" /><span>Back to welcome</span></Button>
          <Separator className="my-3" />
          <div className="user-chip"><Avatar className="size-8"><AvatarFallback>{mentorInitials}</AvatarFallback></Avatar><div><strong>{mentor.name}</strong><p>Mentor</p></div></div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="crumb">Workspace <span>/</span> <strong>Mentor workspace</strong></div>
          <div className="top-actions">
            <Badge variant="outline" className="demo-badge">{FRONTEND_PREVIEW ? "Frontend preview" : "MentorFlow"}</Badge>
            {notificationButton}
            <Avatar className="size-8 top-avatar"><AvatarFallback>{mentorInitials}</AvatarFallback></Avatar>
          </div>
        </header>
        <div className="content">{children}{notices}{content}</div>
      </main>
    </div>
  );
}
