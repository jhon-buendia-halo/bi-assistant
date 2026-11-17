import { SheetWarning } from '../../models/datasource.model';

/** The chip text of a warning (plan M1-31 section 3). */
export function warningLabel(w: SheetWarning, excluded = false): string {
  switch (w.code) {
    case 'total-row':
      return excluded
        ? 'Last row looks like a total — excluded'
        : 'Last row looks like a total';
    case 'no-table':
      return 'No table found';
    case 'header-guessed':
      return `Header found on row ${w.row}`;
    case 'duplicate-columns':
      return `Duplicate columns renamed (${w.names.join(', ')})`;
  }
}

/** Real problems get the warning chip; "header found on row n" is only information. */
export function isProblem(w: SheetWarning): boolean {
  return w.code !== 'header-guessed';
}
