export type GoalPromptInput = {
  title: string;
  category: string;
  metric: string;
  currentValue: number;
  targetValue: number;
  currentGymFrequency: number;
  weeklyStreak: number;
  longestStreak: number;
  requestedFrequency: number | null;
};

const sanitizeText = (s: string) => s.replace(/[\r\n\t]/g, ' ').trim();

export const buildGoalPrompt = (input: GoalPromptInput): string =>
  `
A gym member wants to achieve the following goal:
- Goal: ${sanitizeText(input.title)}
- Category: ${input.category}
- Metric: ${input.metric}
- Current value: ${input.currentValue} ${input.metric}
- Target value: ${input.targetValue} ${input.metric}
- Current gym attendance: ${input.currentGymFrequency} days/week
- Current weekly streak: ${input.weeklyStreak} weeks
- Longest streak ever: ${input.longestStreak} weeks
- Desired frequency: ${input.requestedFrequency ?? 'not specified — recommend one'}

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
      "workoutType": "<strength | cardio | HIIT | flexibility | warmup | cooldown>",
      "muscleGroup": "<e.g. chest, legs, full body, core — or null>",
      "sets": <integer or null>,
      "reps": <integer or null>,
      "weight": <number kg or null>,
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
    - Each training day has exactly 1-2 plan items: a general session note and an optional focus area.
    - Do NOT generate detailed exercise prescriptions — the goal is attendance, not periodisation.
- Milestones every 2-4 weeks as checkpoints; maximum 6 milestones total.
- Keep descriptions under 15 words — concise and actionable.
- If requestedFrequency is specified, use it as recommendedGymFrequency.
- Omit fields that are null — do not include null-valued keys in the JSON output.
`.trim();
