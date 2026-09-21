import { Injectable, signal } from '@angular/core';
import { AgentEvalCase, AgentEvalCaseResult } from './agents-api.service';

export interface EvalSelection {
  /** The question that was clicked. */
  evalCase: AgentEvalCase;
  /** Its run result, absent until the question has been executed. */
  result?: AgentEvalCaseResult;
}

/** Eval question selected in the Evals tab, shown in the right panel. */
@Injectable({ providedIn: 'root' })
export class EvalSelectionService {
  readonly selection = signal<EvalSelection | null>(null);

  select(selection: EvalSelection): void {
    this.selection.set(selection);
  }

  clear(): void {
    this.selection.set(null);
  }
}
