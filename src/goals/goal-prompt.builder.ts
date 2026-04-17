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
  "recommendedGymFrequency": <integer 1-7>,
  "estimatedWeeks": <integer 1-52>,
  "reasoning": "<2-3 sentences explaining timeline and frequency>",
  "milestones": [
    { "weekNumber": <integer>, "description": "<string>", "targetValue": <number or null> }
  ],
  "plan": [
    {
      "weekNumber": <integer>,
      "dayLabel": "<e.g. Monday>",
      "description": "<exercise or activity>",
      "sets": <integer or null>,
      "reps": <integer or null>,
      "weight": <number or null>,
      "duration": <integer minutes or null>
    }
  ]
}

Rules:
- Plan items must cover weeks 1 through estimatedWeeks.
- Each week has exactly recommendedGymFrequency plan items.
- Milestones every 2-4 weeks as checkpoints.
- Progressive overload for strength goals.
- For CONSISTENCY with metric DAYS_PER_WEEK, plan items are general gym sessions.
- Keep descriptions concise and actionable.
- If requestedFrequency is specified, use it as recommendedGymFrequency.
`.trim();
