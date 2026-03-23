export const STREAK_MILESTONES = [
  { value: 2, title: 'Two weeks strong!', body: "You've checked in consistently for 2 weeks. A great habit is forming!" },
  { value: 4, title: 'One month of consistency!', body: "4 weeks in a row — you're building something real. Keep showing up!" },
  { value: 8, title: 'Two months unstoppable!', body: '8 consecutive weeks! Your dedication is seriously impressive.' },
  { value: 12, title: 'Quarter-year warrior!', body: "12 weeks straight! You're in the top tier of committed members!" },
  { value: 26, title: 'Half a year of greatness!', body: "26 WEEKS! Six months of showing up. You're an absolute machine!" },
  { value: 52, title: 'ONE YEAR STREAK!', body: '52 weeks. 365 days of commitment. You are LEGENDARY!' },
];

export const CHECKIN_MILESTONES = [
  { value: 10, title: 'Double digits!', body: "You've hit 10 check-ins! The journey is well underway." },
  { value: 25, title: '25 and counting!', body: '25 visits to the gym — consistency is your superpower.' },
  { value: 50, title: 'Half century!', body: "50 check-ins! That's serious commitment right there." },
  { value: 100, title: 'The 100 Club!', body: "100 CHECK-INS! You've joined an elite club. Incredible!" },
  { value: 200, title: '200 — Unstoppable!', body: '200 check-ins! Your dedication is on another level entirely!' },
  { value: 500, title: '500 — LEGENDARY!', body: '500 CHECK-INS! You are a gym LEGEND. Absolute respect!' },
];

export const FIRST_CHECKIN = {
  title: 'Welcome to the gym!',
  body: "Your fitness journey starts today. We're glad you're here!",
};

export type MilestoneType =
  | 'WEEKLY_STREAK'
  | 'TOTAL_CHECKINS'
  | 'FIRST_CHECKIN'
  | 'BEST_WEEK'
  | 'LONGEST_STREAK';

export interface StreakUpdatedPayload {
  memberId: string;
  weeklyStreak: number;
  longestStreak: number;
  previousLongestStreak: number;
  daysThisWeek: number;
  previousBestWeek: number;
  totalCheckIns: number;
  isFirstCheckIn: boolean;
}
