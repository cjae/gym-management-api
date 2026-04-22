import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { UpdateProfileDto } from './update-profile.dto';

const errorsFor = async (
  payload: Record<string, unknown>,
): Promise<ValidationError[]> => {
  const dto = plainToInstance(UpdateProfileDto, payload);
  return validate(dto, { whitelist: false });
};

const hasErrorOn = (errors: ValidationError[], prop: string): boolean =>
  errors.some((e) => e.property === prop);

describe('UpdateProfileDto personalization fields', () => {
  it('accepts an empty payload (all fields optional)', async () => {
    const errors = await errorsFor({});
    expect(errors).toHaveLength(0);
  });

  it('accepts a valid full personalization payload', async () => {
    const errors = await errorsFor({
      experienceLevel: 'BEGINNER',
      bodyweightKg: 60.5,
      heightCm: 165,
      sessionMinutes: 45,
      preferredTrainingDays: ['TUE', 'THU', 'SAT'],
      sleepHoursAvg: 7,
      primaryMotivation: 'HEALTH',
      injuryNotes: 'Mild lower back pain',
    });
    expect(errors).toHaveLength(0);
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
    const errors = await errorsFor({ [field]: value });
    expect(hasErrorOn(errors, field)).toBe(true);
  });

  it('rejects an invalid experienceLevel enum value', async () => {
    const errors = await errorsFor({ experienceLevel: 'EXPERT' });
    expect(hasErrorOn(errors, 'experienceLevel')).toBe(true);
  });

  it('rejects an invalid primaryMotivation enum value', async () => {
    const errors = await errorsFor({ primaryMotivation: 'REVENGE' });
    expect(hasErrorOn(errors, 'primaryMotivation')).toBe(true);
  });

  it('rejects preferredTrainingDays with an unknown code', async () => {
    const errors = await errorsFor({
      preferredTrainingDays: ['MON', 'FUNDAY'],
    });
    expect(hasErrorOn(errors, 'preferredTrainingDays')).toBe(true);
  });

  it('rejects duplicate weekday codes', async () => {
    const errors = await errorsFor({ preferredTrainingDays: ['MON', 'MON'] });
    expect(hasErrorOn(errors, 'preferredTrainingDays')).toBe(true);
  });

  it('allows preferredTrainingDays to be cleared (empty array)', async () => {
    const errors = await errorsFor({ preferredTrainingDays: [] });
    expect(hasErrorOn(errors, 'preferredTrainingDays')).toBe(false);
  });

  it('accepts injuryNotes up to 500 characters', async () => {
    const errors = await errorsFor({ injuryNotes: 'x'.repeat(500) });
    expect(hasErrorOn(errors, 'injuryNotes')).toBe(false);
  });

  it('rejects injuryNotes longer than 500 characters', async () => {
    const errors = await errorsFor({ injuryNotes: 'x'.repeat(501) });
    expect(hasErrorOn(errors, 'injuryNotes')).toBe(true);
  });
});
