import "server-only";
import { isEligible, type ScoredMentor } from "../matching/score-mentor";
import type { AgendaItem } from "../progress";
import {
  EXPERTISE,
  LANGUAGE_LABEL,
  expertiseLabel,
  sectorLabel,
  stageLabel,
  type EntrepreneurRecord,
  type MentorRecord,
} from "../types";
import { explainMatch } from "./fallbacks";
import { BACKGROUND_MAX_WAIT_MS, MODELS, chooseTool, structured, type ToolSpec } from "./llm";
import { SENSITIVE_TOPICS, type DecisionContext } from "./policy";
import { AGENT_BOUNDARIES, MATCH_EXPLANATION_RULE, NO_GENDER_RULE } from "./prompts";
import {
  AssessmentDraftSchema,
  AssessmentSummarySchema,
  BriefsSchema,
  ChunkNotesSchema,
  ExtractionSchema,
  FollowUpSchema,
  MatchExplanationsSchema,
  ReplyClassificationSchema,
} from "./schemas";

// Live implementations of each AI step (Milestone 2). Each returns the
// function aiStep() calls; aiStep validates the result and falls back to the
// saved response on any problem. Prompts stay short to fit the free tier.

type Live = (signal: AbortSignal) => Promise<unknown>;

const j = (v: unknown) => JSON.stringify(v);
const sys = (task: string) => `${AGENT_BOUNDARIES}\n\nTASK\n${task}\n\n${NO_GENDER_RULE}`;
const day = (d: Date | null) => (d ? d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : null);
const firstName = (fullName: string) => fullName.split(" ")[0];
const EXPERTISE_KEYS = EXPERTISE.map((k) => `${k} (${expertiseLabel(k)})`).join(", ");

function profileFacts(e: EntrepreneurRecord) {
  return {
    name: e.full_name,
    business: e.business_name,
    stage: stageLabel(e.business_stage),
    sector: sectorLabel(e.sector),
    description: e.business_description,
    main_challenge: e.primary_challenge,
    goals: e.goals,
    help_needed: e.expertise_needs.map(expertiseLabel),
    languages: e.languages.map((l) => LANGUAGE_LABEL[l]),
    preferred_language: LANGUAGE_LABEL[e.preferred_language],
    budget_per_session_nu: e.budget > 0 ? e.budget : "not decided yet (YDF credit can cover fees)",
    location: e.location,
  };
}

function mentorFacts(m: MentorRecord) {
  return {
    name: m.full_name,
    headline: m.headline,
    expertise: m.expertise.map(expertiseLabel),
    sectors: m.sectors.map(sectorLabel),
    languages: m.languages.map((l) => LANGUAGE_LABEL[l]),
  };
}

export const live = {
  assessmentSummary:
    (e: EntrepreneurRecord): Live =>
    (signal) =>
      structured({
        task: "assessment_summary",
        model: MODELS.light,
        maxTokens: 600,
        schema: AssessmentSummarySchema,
        signal,
        system: sys(
          "Summarise this entrepreneur's needs assessment for the agent's memory and for mentors. " +
            "2 to 3 plain sentences, under 450 characters, third person. Use only the facts given.",
        ),
        user: j(profileFacts(e)),
      }),

  assessmentDraft:
    (transcript: string): Live =>
    (signal) =>
      structured({
        task: "assessment_from_speech",
        model: MODELS.main,
        maxTokens: 900,
        schema: AssessmentDraftSchema,
        signal,
        system: sys(
          "Someone introduced themselves and their business (or business idea) by voice, in English; the text may contain " +
            "transcription errors. Fill a needs-assessment DRAFT that they will check. They may be an aspiring entrepreneur with no business yet. " +
            "HEARD: fill what they said outright. SUGGESTED: you may also fill business_stage, business_description, primary_challenge, " +
            "expertise_needs and sector when the meaning is clear (e.g. 'I don't have a business idea yet' means business_stage idea, " +
            "sector undecided and the need idea_development). List every suggested field in suggested_fields. " +
            "NEVER guess business_name or budget: leave them null unless said. Leave preferred_language null unless they state a preference. " +
            `sector: one of ${["tourism", "agriculture", "handicrafts", "retail", "fintech", "technology", "undecided"].join(", ")}, ` +
            "for what the business itself is (an app or website is technology, even if its users are farmers); undecided if they have no business or idea yet. " +
            "Speech-to-text may spell Dzongkha as Zonka and ngultrum as Gultrim. " +
            "business_stage: idea (no business yet, or only an idea), early (started, first customers), growth (growing or hiring), established (many years). " +
            `expertise_needs: up to 5 from this list that match the help they ask for or clearly need: ${EXPERTISE_KEYS}. ` +
            "languages: dz (Dzongkha) and/or en (English) that they say they speak; if they name none, en (they are speaking English), marked suggested. " +
            "budget: the amount per mentoring session in Ngultrum as a number, only if they said one. " +
            "business_description and primary_challenge: 1 to 2 sentences in the first person, close to their words, without greetings or their name. " +
            "Mentions of using this platform or app are about our mentoring service, not their business. " +
            "goals: only goals they stated.",
        ),
        user: transcript,
      }),

  matchExplanations:
    (e: EntrepreneurRecord, ranked: ScoredMentor[]): Live =>
    (signal) =>
      structured({
        task: "match_explanations",
        model: MODELS.main,
        maxTokens: 1400,
        schema: MatchExplanationsSchema,
        signal,
        system: sys(
          "Explain to the entrepreneur why each mentor was recommended. " +
            MATCH_EXPLANATION_RULE +
            " The ranking is already fixed by rules: do not re-rank or judge it. " +
            "Each mentor comes with verified_facts computed from the score breakdown. " +
            "Rewrite those facts as 2 short, friendly sentences (under 350 characters) to the entrepreneur. " +
            'Refer to the mentor by first name and to the entrepreneur as "you". ' +
            "Lead with the needs covered. Keep any limitation (fully booked, other sector, other language, above budget). " +
            "Use only verified_facts: add nothing, change no number, quote no point values. " +
            "Return exactly one explanation per mentor_id given.",
        ),
        user: j({
          entrepreneur: {
            sector: sectorLabel(e.sector),
            stage: stageLabel(e.business_stage),
            preferred_language: LANGUAGE_LABEL[e.preferred_language],
            help_needed: e.expertise_needs.map(expertiseLabel),
            budget_per_session_nu: e.budget > 0 ? e.budget : "not decided yet (YDF credit can cover fees)",
          },
          mentors: ranked.map((r) => ({
            mentor_id: r.mentor.id,
            name: r.mentor.full_name,
            headline: r.mentor.headline,
            verified_facts: explainMatch(e, r),
          })),
        }),
      }),

  briefs:
    (e: EntrepreneurRecord, m: MentorRecord, scheduledAt: Date, agenda: AgendaItem[]): Live =>
    (signal) =>
      structured({
        task: "session_briefs",
        model: MODELS.main,
        maxTokens: 1400,
        schema: BriefsSchema,
        signal,
        system: sys(
          "Prepare a brief for each side of a mentoring session. " +
            "entrepreneur: headline (under 120 characters), prepare (3 concrete things to do before the session), " +
            "questions_to_ask (3 questions to ask the mentor). " +
            "mentor: headline, about (what the mentor needs to know about the ENTREPRENEUR, not about the mentor; under 500 characters), " +
            "focus (2 to 4 points). " +
            "If progress_since_last_session is not empty this is a follow-up session: the mentor's about must summarise that progress, " +
            "and focus must start with the items that need the mentor (escalations, help requests, obstacles, overdue actions). " +
            "Use only the facts given. Every list item under 180 characters.",
        ),
        user: j({
          session_date: day(scheduledAt),
          entrepreneur: profileFacts(e),
          mentor: mentorFacts(m),
          progress_since_last_session: agenda.map((a) => a.text),
        }),
      }),

  extraction:
    (notes: string, source: "typed" | "voice_note" | "call_recording" = "typed", condensed = false): Live =>
    (signal) =>
      structured({
        task: "extract_action_items",
        model: MODELS.main,
        // The final step of a long transcript runs in the background and can wait for budget.
        maxWaitMs: condensed ? BACKGROUND_MAX_WAIT_MS : undefined,
        maxTokens: 1400,
        schema: ExtractionSchema,
        signal,
        system: sys(
          "Turn a mentor's quick session notes into a summary and SMART action items. " +
            "Only include actions the notes say were agreed. Never invent actions. " +
            "For each action: title starts with a verb and is specific (under 100 characters); description is one sentence; " +
            "success_measure says how we will know it is done, in measurable terms; " +
            "due_in_days uses the timeframe in the notes (a week = 7), or 7 if none is given; " +
            "Owner: in the mentor's own notes, I/I'll/I will means the mentor. In a call transcript, an offer like " +
            "\"I'll send you\" or \"I'll introduce you\" from the adviser is the mentor's; tasks for the business owner " +
            "(\"you will\", or the owner by name, e.g. \"Dorji will\") are the entrepreneur's. " +
            "Only explicit commitments become actions: never possibilities (\"might be worth\", \"maybe later\") " +
            "or decisions not to do something. summary: 1 to 2 sentences." +
            (condensed
              ? " The input is the list of actions agreed in a long call. Turn exactly these into SMART actions, one each, " +
                "keeping each one's owner. Merge duplicates. Add nothing else."
              : source === "call_recording"
              ? " The input includes a transcript of the mentoring call. Speakers may be labelled as [Mentor] and " +
                "[Entrepreneur]; if labels are missing, infer from the words. With labels, a speaker's own \"I'll ...\" " +
                "is that speaker's task and \"you ...\" is the other person's. It may contain transcription errors. " +
                "Only extract actions both people clearly agreed on."
              : source === "voice_note"
                ? " The notes were dictated and transcribed, so expect spoken language."
                : ""),
        ),
        user: notes,
      }),

  condenseChunk:
    (chunk: string, part: number, parts: number, model: string): Live =>
    (signal) =>
      structured({
        task: "condense_transcript_part",
        model,
        maxWaitMs: BACKGROUND_MAX_WAIT_MS,
        maxTokens: 900,
        schema: ChunkNotesSchema,
        signal,
        system: sys(
          `This is part ${part} of ${parts} of a mentoring call transcript (speakers may be labelled [Mentor]/[Entrepreneur]; it may contain transcription errors). ` +
            "agreements: only explicit commitments that someone will do something. what: the commitment in the speaker's own words, " +
            "keeping \"you\" or \"I'll\" (e.g. \"you call the three guides for referrals\", \"I'll send you the kit\"); who; and the timeframe in their words. " +
            "Not possibilities (\"might be worth\", \"maybe later\") and not decisions to NOT do something. " +
            "who: an offer like \"I'll send you\" or \"I'll introduce you\" from the adviser is the mentor; tasks for the business owner are the entrepreneur. " +
            "If lines are labelled, a speaker's own \"I'll ...\" is that speaker's task and \"you ...\" is the other person's. " +
            "If someone corrects a timeframe, keep the corrected one. Keep each item under 200 characters. " +
            "context: up to 5 key facts or decisions, including ideas they decided NOT to pursue. Never invent anything.",
        ),
        user: chunk,
      }),

  checkIn:
    (e: EntrepreneurRecord, actionTitle: string, dueAt: Date | null, measure: string | null): Live =>
    (signal) =>
      structured({
        task: "progress_check_in",
        model: MODELS.light,
        maxTokens: 500,
        schema: FollowUpSchema,
        signal,
        system: sys(
          "Write a short, warm progress check-in (under 280 characters) about one action that is not yet due. " +
            `Start with "Kuzu zangpo la, ${firstName(e.full_name)}." Name the action and its due date. ` +
            "Ask for a quick update: on track, done, or stuck. Do not give advice.",
        ),
        user: j({ action: actionTitle, due_date: day(dueAt), done_when: measure }),
      }),

  overdue:
    (e: EntrepreneurRecord, actionTitle: string, daysOverdue: number): Live =>
    (signal) =>
      structured({
        task: "overdue_follow_up",
        model: MODELS.light,
        maxTokens: 500,
        schema: FollowUpSchema,
        signal,
        system: sys(
          "Write a short, kind follow-up (under 280 characters) about an action that is now overdue. " +
            `Start with "Kuzu zangpo la, ${firstName(e.full_name)}." Do not blame. ` +
            "Ask what is getting in the way and offer to find the right help. Do not give advice yet.",
        ),
        user: j({ action: actionTitle, days_overdue: daysOverdue }),
      }),

  classifyReply:
    (actionTitle: string, reply: string, name: string): Live =>
    (signal) =>
      structured({
        task: "classify_reply",
        model: MODELS.light,
        maxTokens: 500,
        schema: ReplyClassificationSchema,
        signal,
        system: sys(
          "Read an entrepreneur's reply to a progress check-in about one action. " +
            'status: "done" if it is finished; "stuck" if it is delayed, behind, blocked or not progressing, ' +
            'even if they expect to catch up; "on_track" only if it is progressing as planned with no delay or problem. ' +
            "needs_help: true only if they are stuck and need information, a decision or expertise they do not have " +
            "(they do not know how, they ask a question, or they need permits, legal or tax advice); " +
            "false if they only need time (illness, travel, busy, family). " +
            `summary: one sentence in the third person for their mentor, under 250 characters, starting with "${name}".`,
        ),
        user: j({ action: actionTitle, reply }),
      }),

  decision:
    (ctx: DecisionContext): Live =>
    async (signal) => {
      const current = ctx.mentors.find((m) => m.id === ctx.currentMentorId) ?? null;
      const approved = ctx.resources.filter((r) => r.approved);
      const others = ctx.mentors.filter((m) => m.id !== ctx.currentMentorId && isEligible(m) && m.slots_remaining > 0);
      const factors = {
        type: "array",
        items: { type: "string" },
        description: "2 to 4 short factual reasons (each under 150 characters) based only on the data given.",
      };

      const tools: ToolSpec[] = [];
      if (approved.length > 0) {
        tools.push({
          name: "recommend_approved_resource",
          description: "Send one approved resource that clearly covers the problem. Never for permits, legal, registration or tax.",
          parameters: {
            type: "object",
            properties: { resource_id: { type: "string", enum: approved.map((r) => r.id) }, factors },
            required: ["resource_id", "factors"],
          },
        });
      }
      if (current && isEligible(current)) {
        tools.push({
          name: "request_own_mentor_help",
          description: `Ask the entrepreneur's own mentor (${current.full_name}) and add it to their next session's agenda.`,
          parameters: { type: "object", properties: { factors }, required: ["factors"] },
        });
      }
      if (others.length > 0) {
        tools.push({
          name: "suggest_other_mentor",
          description: "Suggest a session with another verified mentor whose expertise covers the problem. Nothing is booked.",
          parameters: {
            type: "object",
            properties: { mentor_id: { type: "string", enum: others.map((m) => m.id) }, factors },
            required: ["mentor_id", "factors"],
          },
        });
      }
      tools.push({
        name: "escalate_to_ydf",
        description: "Create a YDF escalation when a qualified person is needed and no mentor here can help.",
        parameters: {
          type: "object",
          properties: {
            reason: { type: "string", enum: ["specialist_required", "safeguarding", "dispute", "other"] },
            priority: { type: "string", enum: ["low", "medium", "high"] },
            summary: { type: "string", description: "Third person, for YDF staff, under 400 characters." },
            factors,
          },
          required: ["reason", "priority", "summary", "factors"],
        },
      });

      const { name, args } = await chooseTool({
        task: "blocker_decision",
        model: MODELS.main,
        signal,
        tools,
        system: sys(
          "An entrepreneur is stuck on an action. Decide how to help by calling exactly one tool.\n" +
            "1. Permits, licences, legal questions, business registration and tax are sensitive and need a qualified person: " +
            "never answer them with a resource. Ask the own mentor only if they list that expertise; otherwise suggest another mentor " +
            "who lists it; otherwise escalate to YDF.\n" +
            "2. Otherwise, if an approved resource clearly covers the problem, recommend it.\n" +
            "3. Otherwise ask the own mentor if their expertise covers it.\n" +
            "4. Otherwise suggest another mentor whose expertise covers it.\n" +
            "5. Otherwise escalate to YDF.",
        ),
        user: j({
          blocker: ctx.blocker,
          action: ctx.actionTitle,
          entrepreneur: ctx.entrepreneurName,
          sector: sectorLabel(ctx.sector),
          sensitive_topics_detected: ctx.topics.filter((t) => SENSITIVE_TOPICS.has(t)).map(expertiseLabel),
          own_mentor: current ? mentorFacts(current) : null,
          approved_resources: approved.map((r) => ({
            resource_id: r.id,
            title: r.title,
            summary: r.summary,
            topics: r.topics.map(expertiseLabel),
          })),
          other_mentors: others.map((m) => ({ mentor_id: m.id, name: m.full_name, expertise: m.expertise.map(expertiseLabel) })),
        }),
      });

      const a = (args ?? {}) as Record<string, unknown>;
      switch (name) {
        case "recommend_approved_resource":
          return { action: "recommend_resource", resource_id: a.resource_id, factors: a.factors };
        case "request_own_mentor_help":
          return { action: "request_mentor_help", mentor_id: ctx.currentMentorId, factors: a.factors };
        case "suggest_other_mentor":
          return { action: "suggest_mentor_session", mentor_id: a.mentor_id, factors: a.factors };
        case "escalate_to_ydf":
          return { action: "escalate", reason: a.reason, priority: a.priority, summary: a.summary, factors: a.factors };
        default:
          throw new Error(`Unknown tool ${name}`);
      }
    },
};
