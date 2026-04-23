import { buildGoalPrompt } from './goal-prompt.builder';

describe('buildGoalPrompt', () => {
  const base = {
    title: 'Bench 120kg',
    category: 'STRENGTH' as const,
    metric: 'KG' as const,
    startingValue: 80,
    targetValue: 120,
    currentGymFrequency: 3,
    weeklyStreak: 2,
    longestStreak: 6,
    userDeadline: null,
    weeksUntilDeadline: null,
    experienceLevel: null,
    bodyweightKg: null,
    heightCm: null,
    sessionMinutes: null,
    preferredTrainingDays: [] as string[],
    sleepHoursAvg: null,
    primaryMotivation: null,
    injuryNotes: null,
    ageYears: null,
    sex: null,
    memberTenureMonths: null,
    hasPersonalTrainer: false,
    actualAttendanceLast4Weeks: 0,
    subscriptionPlanName: null,
    isOffPeakPlan: false,
    priorGoalsCompleted: 0,
    priorGoalsAbandoned: 0,
  };

  it('includes all member context fields', () => {
    const out = buildGoalPrompt({ ...base, requestedFrequency: null });
    expect(out).toContain('Bench 120kg');
    expect(out).toContain('STRENGTH');
    expect(out).toContain('80 KG');
    expect(out).toContain('120 KG');
    expect(out).toContain('3 days/week');
    expect(out).toContain('2 weeks');
    expect(out).toContain('6 weeks');
    expect(out).toContain('not specified');
  });

  it('inlines the requested frequency when provided', () => {
    const out = buildGoalPrompt({ ...base, requestedFrequency: 5 });
    expect(out).toContain('Desired frequency: 5');
  });

  it('inlines the user deadline and weeks-until-deadline when provided', () => {
    const out = buildGoalPrompt({
      ...base,
      requestedFrequency: null,
      userDeadline: '2026-08-01',
      weeksUntilDeadline: 14,
    });
    expect(out).toContain('User deadline: 2026-08-01');
    expect(out).toContain('~14 weeks away');
  });

  it('falls back to "not specified" when no deadline is provided', () => {
    const out = buildGoalPrompt({ ...base, requestedFrequency: null });
    expect(out).toContain('User deadline: not specified');
  });

  it('uses kg as the lift weight unit when the goal metric is not LBS', () => {
    const out = buildGoalPrompt({
      ...base,
      metric: 'KG',
      requestedFrequency: null,
    });
    expect(out).toContain('lift weight in kg');
    expect(out).toContain('MUST be in kg');
    expect(out).not.toContain('lift weight in lbs');
  });

  it('switches the lift weight unit to lbs when the goal metric is LBS', () => {
    const out = buildGoalPrompt({
      ...base,
      metric: 'LBS',
      requestedFrequency: null,
    });
    expect(out).toContain('lift weight in lbs');
    expect(out).toContain('MUST be in lbs');
    expect(out).not.toContain('lift weight in kg');
  });

  it('ties milestone.targetValue to the goal metric', () => {
    const out = buildGoalPrompt({
      ...base,
      metric: 'LBS',
      requestedFrequency: null,
    });
    expect(out).toContain(
      "milestone.targetValue field uses the goal's metric (LBS)",
    );
  });

  describe('member profile block', () => {
    it('renders a Member profile block', () => {
      const out = buildGoalPrompt({ ...base, requestedFrequency: null });
      expect(out).toContain('Member profile:');
    });

    it('renders age when ageYears is provided, falls back to not specified otherwise', () => {
      const withAge = buildGoalPrompt({
        ...base,
        requestedFrequency: null,
        ageYears: 28,
      });
      expect(withAge).toContain('Age: 28 years');

      const without = buildGoalPrompt({ ...base, requestedFrequency: null });
      expect(without).toContain('Age: not specified');
    });

    it('renders sex, experience, bodyweight, height, session length, sleep, motivation, tenure', () => {
      const out = buildGoalPrompt({
        ...base,
        requestedFrequency: null,
        ageYears: 28,
        sex: 'FEMALE',
        experienceLevel: 'INTERMEDIATE',
        bodyweightKg: 64,
        heightCm: 168,
        sessionMinutes: 45,
        sleepHoursAvg: 7,
        primaryMotivation: 'HEALTH',
        memberTenureMonths: 14,
      });
      expect(out).toContain('Sex: FEMALE');
      expect(out).toContain('Experience: INTERMEDIATE');
      expect(out).toContain('Bodyweight: 64 kg');
      expect(out).toContain('Height: 168 cm');
      expect(out).toContain('Typical session length: 45 minutes');
      expect(out).toContain('Average sleep: 7');
      expect(out).toContain('Primary motivation: HEALTH');
      expect(out).toContain('Member for: 14 months');
    });

    it('renders preferredTrainingDays verbatim and uppercase when provided', () => {
      const out = buildGoalPrompt({
        ...base,
        requestedFrequency: null,
        preferredTrainingDays: ['TUE', 'THU', 'SAT'],
      });
      expect(out).toContain('Preferred training days: TUE, THU, SAT');
    });

    it('falls back to not specified when preferredTrainingDays is empty', () => {
      const out = buildGoalPrompt({ ...base, requestedFrequency: null });
      expect(out).toContain('Preferred training days: not specified');
    });

    it('renders injuryNotes and sanitizes raw newlines/tabs', () => {
      const out = buildGoalPrompt({
        ...base,
        requestedFrequency: null,
        injuryNotes: 'mild lower-back pain\navoid heavy deadlifts',
      });
      expect(out).toContain(
        'Injury notes: mild lower-back pain avoid heavy deadlifts',
      );
      expect(out).not.toContain('mild lower-back pain\navoid heavy deadlifts');
    });

    it('emits complementary-guidance note when hasPersonalTrainer=true', () => {
      const out = buildGoalPrompt({
        ...base,
        requestedFrequency: null,
        hasPersonalTrainer: true,
      });
      expect(out).toContain('Working with a personal trainer: yes');
      expect(out).toContain('complement trainer guidance');
    });

    it('omits complementary-guidance note when hasPersonalTrainer=false', () => {
      const out = buildGoalPrompt({
        ...base,
        requestedFrequency: null,
        hasPersonalTrainer: false,
      });
      expect(out).toContain('Working with a personal trainer: no');
      expect(out).not.toContain('complement trainer guidance');
    });

    it('triggers bodyweight-scaling language when BEGINNER + bodyweightKg set', () => {
      const out = buildGoalPrompt({
        ...base,
        requestedFrequency: null,
        experienceLevel: 'BEGINNER',
        bodyweightKg: 70,
      });
      expect(out).toContain('Scale starting loads to bodyweight');
    });
  });

  describe('system context block', () => {
    it('renders a System context block with attendance, plan, and prior goal history', () => {
      const out = buildGoalPrompt({
        ...base,
        requestedFrequency: null,
        actualAttendanceLast4Weeks: 10,
        subscriptionPlanName: 'Premium Monthly',
        isOffPeakPlan: false,
        priorGoalsCompleted: 2,
        priorGoalsAbandoned: 1,
      });
      expect(out).toContain('System context:');
      expect(out).toContain('Recent attendance: 10 days over the last 4 weeks');
      expect(out).toContain('~2.5/week actual');
      expect(out).toContain('Subscription plan: Premium Monthly');
      expect(out).toContain('off-peak: no');
      expect(out).toContain('Prior goal history: 2 completed, 1 abandoned');
    });

    it('falls back when subscription plan is absent', () => {
      const out = buildGoalPrompt({
        ...base,
        requestedFrequency: null,
        subscriptionPlanName: null,
      });
      expect(out).toContain('Subscription plan: not specified');
    });

    it('marks off-peak plans', () => {
      const out = buildGoalPrompt({
        ...base,
        requestedFrequency: null,
        subscriptionPlanName: 'Off-Peak Monthly',
        isOffPeakPlan: true,
      });
      expect(out).toContain('off-peak: yes');
    });

    it('emits off-peak rule only when plan is off-peak', () => {
      const on = buildGoalPrompt({
        ...base,
        requestedFrequency: null,
        isOffPeakPlan: true,
      });
      expect(on).toContain('training must occur during off-peak hours');

      const off = buildGoalPrompt({ ...base, requestedFrequency: null });
      expect(off).not.toContain('training must occur during off-peak hours');
    });

    it('emits conservative-pace rule when abandoned > completed', () => {
      const out = buildGoalPrompt({
        ...base,
        requestedFrequency: null,
        priorGoalsCompleted: 0,
        priorGoalsAbandoned: 2,
      });
      expect(out).toContain('past plans may have been too aggressive');
    });

    it('omits conservative-pace rule when abandoned <= completed', () => {
      const out = buildGoalPrompt({
        ...base,
        requestedFrequency: null,
        priorGoalsCompleted: 3,
        priorGoalsAbandoned: 1,
      });
      expect(out).not.toContain('past plans may have been too aggressive');
    });

    it('emits attendance-mismatch rule when actual is lower than requested', () => {
      const out = buildGoalPrompt({
        ...base,
        requestedFrequency: 5,
        actualAttendanceLast4Weeks: 4,
        memberTenureMonths: 3,
      });
      expect(out).toContain('Use actual attendance as the honest baseline');
    });

    it('suppresses attendance-mismatch rule for brand-new members (tenure < 1 month)', () => {
      const out = buildGoalPrompt({
        ...base,
        requestedFrequency: 5,
        actualAttendanceLast4Weeks: 0,
        memberTenureMonths: 0,
      });
      expect(out).not.toContain('Use actual attendance as the honest baseline');
    });

    it('emits attendance-mismatch rule once tenure reaches 1 month', () => {
      const out = buildGoalPrompt({
        ...base,
        requestedFrequency: 5,
        actualAttendanceLast4Weeks: 4,
        memberTenureMonths: 1,
      });
      expect(out).toContain('Use actual attendance as the honest baseline');
    });
  });
});
