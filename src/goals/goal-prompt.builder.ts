import { sanitizeText } from '../common/utils/sanitize-text';

export type GoalPromptInput = {
  title: string;
  category: string;
  metric: string;
  startingValue: number;
  targetValue: number;
  currentGymFrequency: number;
  weeklyStreak: number;
  longestStreak: number;
  requestedFrequency: number | null;
  userDeadline: string | null;
  weeksUntilDeadline: number | null;
  experienceLevel: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED' | null;
  bodyweightKg: number | null;
  heightCm: number | null;
  sessionMinutes: number | null;
  preferredTrainingDays: string[];
  sleepHoursAvg: number | null;
  primaryMotivation: string | null;
  injuryNotes: string | null;
  ageYears: number | null;
  sex: string | null;
  memberTenureMonths: number | null;
  hasPersonalTrainer: boolean;
  actualAttendanceLast4Weeks: number;
  subscriptionPlanName: string | null;
  isOffPeakPlan: boolean;
  priorGoalsCompleted: number;
  priorGoalsAbandoned: number;
};

const clampFrequency = (v: number | null): number | null =>
  v == null ? null : Math.max(1, Math.min(6, v));

const NOT_SPECIFIED = 'not specified';

const line = (
  label: string,
  value: string | number | null,
  suffix = '',
): string =>
  `- ${label}: ${value == null || value === '' ? NOT_SPECIFIED : `${value}${suffix}`}`;

export const buildGoalPrompt = (input: GoalPromptInput): string => {
  const requestedFrequency = clampFrequency(input.requestedFrequency);
  const weightUnit = input.metric === 'LBS' ? 'lbs' : 'kg';

  const trainingDays = input.preferredTrainingDays.length
    ? input.preferredTrainingDays.map((d) => d.toUpperCase()).join(', ')
    : null;
  const injuryNotes = input.injuryNotes
    ? sanitizeText(input.injuryNotes)
    : null;
  const sleep =
    input.sleepHoursAvg == null
      ? null
      : `${input.sleepHoursAvg.toFixed(1)} hours/night`;
  const trainerLine = input.hasPersonalTrainer
    ? 'yes (plans should complement trainer guidance, not replace it)'
    : 'no';
  const showBodyweightScaling =
    input.experienceLevel === 'BEGINNER' && input.bodyweightKg != null;
  const attendancePerWeek = (input.actualAttendanceLast4Weeks / 4).toFixed(1);
  const planLine = input.subscriptionPlanName
    ? `${sanitizeText(input.subscriptionPlanName)} (off-peak: ${input.isOffPeakPlan ? 'yes' : 'no'})`
    : null;
  const showConservativePace =
    input.priorGoalsAbandoned > input.priorGoalsCompleted;
  const showAttendanceMismatch =
    input.requestedFrequency != null &&
    input.memberTenureMonths != null &&
    input.memberTenureMonths >= 1 &&
    input.actualAttendanceLast4Weeks / 4 < input.requestedFrequency;

  return `
A gym member wants to achieve the following goal:
- Goal: ${sanitizeText(input.title)}
- Category: ${input.category}
- Metric: ${input.metric}
- Starting value: ${input.startingValue} ${input.metric}
- Target value: ${input.targetValue} ${input.metric}
- Current gym attendance: ${input.currentGymFrequency} days/week
- Current weekly streak: ${input.weeklyStreak} weeks
- Longest streak ever: ${input.longestStreak} weeks
- Desired frequency: ${requestedFrequency ?? 'not specified — recommend one'}
- User deadline: ${
    input.userDeadline
      ? `${input.userDeadline}${input.weeksUntilDeadline != null ? ` (~${input.weeksUntilDeadline} weeks away)` : ''}`
      : 'not specified — choose a realistic timeline'
  }

Member profile:
${line('Age', input.ageYears, ' years')}
${line('Sex', input.sex)}
${line('Experience', input.experienceLevel)}
${line('Bodyweight', input.bodyweightKg, ' kg')}
${line('Height', input.heightCm, ' cm')}
${line('Typical session length', input.sessionMinutes, ' minutes')}
${line('Preferred training days', trainingDays)}
${line('Average sleep', sleep)}
${line('Primary motivation', input.primaryMotivation)}
${line('Injury notes', injuryNotes)}
${line('Member for', input.memberTenureMonths, ' months')}
- Working with a personal trainer: ${trainerLine}

System context:
- Recent attendance: ${input.actualAttendanceLast4Weeks} days over the last 4 weeks (~${attendancePerWeek}/week actual)
${line('Subscription plan', planLine)}
- Prior goal history: ${input.priorGoalsCompleted} completed, ${input.priorGoalsAbandoned} abandoned

Return ONLY valid JSON in this shape:
{
  "recommendedGymFrequency": <integer 1-6>,
  "estimatedWeeks": <integer 1-16>,
  "reasoning": "<2-3 sentences explaining timeline and frequency>",
  "milestones": [
    { "weekNumber": <integer>, "description": "<string>", "targetValue": <number or null> }
  ],
  "plan": [
    {
      "weekNumber": <integer>,
      "dayLabel": "<e.g. Monday>",
      "exerciseOrder": <integer starting at 1 within each day>,
      "description": "<exercise name and key execution note — under 15 words>",
      "workoutType": "<strength | cardio | hiit | flexibility | warmup | cooldown>",
      "muscleGroup": "<e.g. chest, legs, full body, core — or null>",
      "sets": <integer or null>,
      "reps": <integer or null>,
      "weight": <lift weight in ${weightUnit}, or null>,
      "duration": <integer minutes or null>,
      "restSeconds": <integer seconds between sets or null>,
      "distanceKm": <decimal km or null — use for running/cycling/rowing exercises>,
      "paceMinPerKm": <decimal min/km or null — use for running/cycling exercises>,
      "notes": "<form cue, safety tip, or technique reminder — under 15 words, or null>"
    }
  ]
}

Rules:
- estimatedWeeks must be between 1 and 16 (cap at 16 even for ambitious goals).
- CRITICAL: The plan array MUST include items for EVERY week from 1 through estimatedWeeks. Do NOT generate only week 1 as a sample — output all weeks.
- Each week must have exactly recommendedGymFrequency training days (max 6 days/week).
- exerciseOrder starts at 1 for each new day and increments per exercise within that day.
- For STRENGTH, MUSCLE_GAIN, BODY_COMPOSITION, WEIGHT_LOSS, and OTHER categories:
    - Each training day has 4-6 plan items (one per exercise).
    - Include a warmup item (exerciseOrder 1, workoutType "warmup") and cooldown (last, workoutType "cooldown") every session.
    - Apply progressive overload — increase weight or reps each week.
- For ENDURANCE category:
    - Each training day has 2-4 plan items (e.g. warmup, main run/ride/row, cooldown).
    - Populate distanceKm and paceMinPerKm for running/cycling exercises; increase distance progressively each week.
- For CONSISTENCY category (metric DAYS_PER_WEEK):
    - Each training day has 1 or 2 plan items: a general session note and an optional focus area.
    - Do NOT generate detailed exercise prescriptions — the goal is attendance, not periodisation.
- Milestones every 2-4 weeks as checkpoints; maximum 6 milestones total.
- Keep descriptions under 15 words — concise and actionable.
- Units: all lift weights in the plan MUST be in ${weightUnit} (derived from the goal's metric — lbs when the member tracks their goal in pounds, kg otherwise). Do not mix units within the same plan.
- The milestone.targetValue field uses the goal's metric (${input.metric}) so it can be compared directly against member-logged progress.
- If requestedFrequency is specified, use it as recommendedGymFrequency (clamped to the 1-6 range).
- If a user deadline is specified, set estimatedWeeks to match the weeks until the deadline (clamped to the 1-16 range). If the deadline is beyond 16 weeks, cap at 16 and acknowledge the extended timeline in reasoning. If the deadline is unrealistically short for the goal, still honour it but flag the aggressive pace in reasoning.
- Schedule training days on the member's preferred days when provided. Distribute across the week; do not cluster 3 days back-to-back.
${showBodyweightScaling ? '- Scale starting loads to bodyweight when BEGINNER (e.g. squat 0.5-0.8x BW, bench 0.4-0.6x BW). Adjust for INTERMEDIATE/ADVANCED using historical progression.' : "- Adjust starting loads to the member's experience level and historical progression."}
- If injury notes mention a specific region or movement, substitute safer variants and note the reason in that exercise's notes field.
- Cap daily session duration at the member's sessionMinutes when provided. Reduce exercise count or trim rest if needed.
- If primary motivation is APPEARANCE, bias toward hypertrophy rep ranges (8-12). If STRENGTH, bias toward 3-6. If HEALTH, mix modalities. If SPORT_PERFORMANCE, include power and conditioning. If EVENT_SPECIFIC, tighten timeline and increase specificity.
${input.hasPersonalTrainer ? '- The member has a personal trainer — write reasoning so the plan reads as a complement to the trainer\'s guidance, e.g. "discuss with your trainer before adjusting."' : ''}
${showAttendanceMismatch ? '- Use actual attendance as the honest baseline; currentGymFrequency is self-reported and may overstate reality. If actual is lower than requestedFrequency, flag the jump in reasoning.' : ''}
${input.isOffPeakPlan ? '- The member is on an off-peak plan: training must occur during off-peak hours (the gym restricts check-in outside that window).' : ''}
${showConservativePace ? '- The member has more abandoned goals than completed — acknowledge in reasoning that past plans may have been too aggressive and set a more conservative pace.' : ''}
- Omit fields that are null — do not include null-valued keys in the JSON output.
`.trim();
};
