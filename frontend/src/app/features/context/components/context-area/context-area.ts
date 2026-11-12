import { Component, inject } from '@angular/core';
import {
  ArrowLeft,
  ChartColumn,
  LucideAngularModule,
  LucideIconData,
  Network,
  Users,
} from 'lucide-angular';
import { MainView, ShellState } from '../../../../core/shell/shell-state';
import { OntologyOverview } from '../../../ontology/components/ontology-overview/ontology-overview';
import { PersonaList } from '../../../personas/components/persona-list/persona-list';
import { VisualLibrary } from '../../../visuals/components/visual-library/visual-library';

/** The Context area: its section cards and each section (app-shell R3a). */
@Component({
  selector: 'app-context-area',
  imports: [LucideAngularModule, PersonaList, VisualLibrary, OntologyOverview],
  templateUrl: './context-area.html',
  styles: ':host { display: contents; }',
})
export class ContextArea {
  readonly shell = inject(ShellState);
  readonly ArrowLeft = ArrowLeft;

  /**
   * The Context area's sections, one card each in this order (app-shell R3a).
   * A new section is one entry here plus its view in the template.
   */
  readonly contextSections: {
    view: MainView;
    label: string;
    description: string;
    icon: LucideIconData;
  }[] = [
    {
      view: 'ontologies',
      label: 'Ontologies',
      description:
        "Each dataset's concepts, relations, constraints and instructions the assistant applies.",
      icon: Network,
    },
    {
      view: 'personas',
      label: 'User personas',
      description:
        'Who asks the questions: their role, goals, typical questions and the answers they prefer.',
      icon: Users,
    },
    {
      view: 'visuals',
      label: 'Visuals',
      description:
        'Chart types for data visualization, grouped by category, with when to use each.',
      icon: ChartColumn,
    },
  ];

  /** Opens a Context section from its card (app-shell R3a). */
  openContextSection(view: MainView): void {
    this.shell.mainView.set(view);
  }
}
