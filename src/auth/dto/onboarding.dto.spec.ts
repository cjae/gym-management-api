import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { OnboardingDto } from './onboarding.dto';

const validPayload = {
  experienceLevel: 'INTERMEDIATE',
  bodyweightKg: 72.5,
  heightCm: 175,
  sessionMinutes: 60,
  preferredTrainingDays: ['MON', 'WED', 'FRI'],
  sleepHoursAvg: 7.5,
  primaryMotivation: 'STRENGTH',
  injuryNotes: 'Mild right shoulder impingement, avoid overhead press',
};

const errorsFor = async (
  payload: Record<string, unknown>,
): Promise<ValidationError[]> => {
  const dto = plainToInstance(OnboardingDto, payload);
  return validate(dto);
};

const hasErrorOn = (errors: ValidationError[], prop: string): boolean =>
  errors.some((e) => e.property === prop);

describe('OnboardingDto', () => {
  it('accepts a fully-valid payload', async () => {
    const errors = await errorsFor(validPayload);
    expect(errors).toHaveLength(0);
  });

  describe.each([
    'experienceLevel',
    'bodyweightKg',
    'heightCm',
    'sessionMinutes',
    'preferredTrainingDays',
    'sleepHoursAvg',
    'primaryMotivation',
  ])('required field %s', (field) => {
    it(`rejects when ${field} is missing`, async () => {
      const rest: Record<string, unknown> = { ...validPayload };
      delete rest[field];
      const errors = await errorsFor(rest);
      expect(hasErrorOn(errors, field)).toBe(true);
    });
  });

  it('rejects preferredTrainingDays with an unknown code', async () => {
    const errors = await errorsFor({
      ...validPayload,
      preferredTrainingDays: ['MON', 'FUNDAY'],
    });
    expect(hasErrorOn(errors, 'preferredTrainingDays')).toBe(true);
  });

  it('rejects duplicate weekday codes', async () => {
    const errors = await errorsFor({
      ...validPayload,
      preferredTrainingDays: ['MON', 'MON'],
    });
    expect(hasErrorOn(errors, 'preferredTrainingDays')).toBe(true);
  });

  it.each([
    ['bodyweightKg', 19],
    ['bodyweightKg', 401],
    ['heightCm', 99],
    ['heightCm', 251],
    ['sessionMinutes', 14],
    ['sessionMinutes', 241],
    ['sleepHoursAvg', -0.1],
    ['sleepHoursAvg', 24.1],
  ])('rejects out-of-range %s value %p', async (field, value) => {
    const errors = await errorsFor({ ...validPayload, [field]: value });
    expect(hasErrorOn(errors, field)).toBe(true);
  });

  it('rejects an invalid experienceLevel enum value', async () => {
    const errors = await errorsFor({
      ...validPayload,
      experienceLevel: 'EXPERT',
    });
    expect(hasErrorOn(errors, 'experienceLevel')).toBe(true);
  });

  it('rejects an invalid primaryMotivation enum value', async () => {
    const errors = await errorsFor({
      ...validPayload,
      primaryMotivation: 'REVENGE',
    });
    expect(hasErrorOn(errors, 'primaryMotivation')).toBe(true);
  });

  it('accepts injuryNotes up to 500 characters', async () => {
    const errors = await errorsFor({
      ...validPayload,
      injuryNotes: 'x'.repeat(500),
    });
    expect(hasErrorOn(errors, 'injuryNotes')).toBe(false);
  });

  it('rejects injuryNotes longer than 500 characters', async () => {
    const errors = await errorsFor({
      ...validPayload,
      injuryNotes: 'x'.repeat(501),
    });
    expect(hasErrorOn(errors, 'injuryNotes')).toBe(true);
  });

  it('accepts missing optional injuryNotes', async () => {
    const rest: Record<string, unknown> = { ...validPayload };
    delete rest.injuryNotes;
    const errors = await errorsFor(rest);
    expect(hasErrorOn(errors, 'injuryNotes')).toBe(false);
  });
});
