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
});
