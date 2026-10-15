import { ValidateBy, ValidationOptions } from 'class-validator';
import { isIsoDate, sectionPatchProblems } from '../rfp.rules';

/** An ISO `YYYY-MM-DD` naming a real calendar day. */
export function IsIsoDate(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isIsoDate',
      validator: {
        validate: (value: unknown) => isIsoDate(value),
        defaultMessage: (args) =>
          `${args?.property} must be a date as YYYY-MM-DD (got ${JSON.stringify(args?.value)})`,
      },
    },
    options,
  );
}

/** A `sections` patch: only the known keys, each a string or null. */
export function IsSectionsPatch(
  options?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isSectionsPatch',
      validator: {
        validate: (value: unknown) => sectionPatchProblems(value).length === 0,
        defaultMessage: (args) => sectionPatchProblems(args?.value).join('; '),
      },
    },
    options,
  );
}
