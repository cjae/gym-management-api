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
});
