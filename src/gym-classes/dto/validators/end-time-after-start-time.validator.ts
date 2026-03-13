import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

@ValidatorConstraint({ name: 'isEndTimeAfterStartTime', async: false })
export class IsEndTimeAfterStartTime implements ValidatorConstraintInterface {
  validate(_value: string, args: ValidationArguments) {
    const obj = args.object as { startTime?: string; endTime?: string };
    if (!obj.startTime || !obj.endTime) return true;
    return obj.startTime < obj.endTime;
  }

  defaultMessage() {
    return 'endTime must be after startTime';
  }
}
