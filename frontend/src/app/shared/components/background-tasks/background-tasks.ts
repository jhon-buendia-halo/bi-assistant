import {
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import {
  CircleAlert,
  CircleCheck,
  CircleStop,
  ListChecks,
  LoaderCircle,
  LucideAngularModule,
  X,
} from 'lucide-angular';
import {
  BackgroundTask,
  BackgroundTasksService,
  formatElapsed,
} from '../../../core/background-tasks/background-tasks.service';

/**
 * The rail's Background tasks button and its panel (app-shell R58–R63,
 * ui.md 1.3 and 3.7): the count of running tasks on the button, and the
 * list of running and finished tasks with Open, Retry, Dismiss and Stop.
 */
@Component({
  selector: 'app-background-tasks',
  imports: [LucideAngularModule],
  templateUrl: './background-tasks.html',
  styles: `
    :host {
      display: block;
      width: 100%;
    }
    .bg-task-indeterminate {
      animation: bg-task-slide 1.4s ease-in-out infinite;
    }
    @keyframes bg-task-slide {
      from {
        transform: translateX(-100%);
      }
      to {
        transform: translateX(300%);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .bg-task-indeterminate {
        animation: none;
        width: 100%;
        opacity: 0.4;
      }
    }
  `,
})
export class BackgroundTasks {
  readonly CircleAlert = CircleAlert;
  readonly CircleCheck = CircleCheck;
  readonly CircleStop = CircleStop;
  readonly ListChecks = ListChecks;
  readonly LoaderCircle = LoaderCircle;
  readonly X = X;

  /** The rail is the wide drawer: show the label beside the icon. */
  readonly expanded = input(false);

  readonly service = inject(BackgroundTasksService);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly button = viewChild<ElementRef<HTMLButtonElement>>('button');

  readonly open = signal(false);
  /** Where the panel sits: right of the rail, its bottom at the button's. */
  readonly position = signal<{ left: number; bottom: number }>({
    left: 64,
    bottom: 16,
  });

  readonly runningCount = this.service.runningCount;
  readonly badge = computed(() => {
    const n = this.runningCount();
    return n > 99 ? '99+' : String(n);
  });
  readonly label = computed(() => {
    const n = this.runningCount();
    return n === 0 ? 'Background tasks' : `Background tasks, ${n} running`;
  });

  toggle(): void {
    if (this.open()) {
      this.open.set(false);
      return;
    }
    const rect = this.button()?.nativeElement.getBoundingClientRect();
    if (rect) {
      this.position.set({
        left: Math.round(rect.right + 12),
        bottom: Math.max(8, Math.round(window.innerHeight - rect.bottom)),
      });
    }
    this.open.set(true);
  }

  close(): void {
    if (!this.open()) return;
    this.open.set(false);
    this.button()?.nativeElement.focus();
  }

  elapsed(task: BackgroundTask): string {
    return formatElapsed(this.service.now() - task.startedAt);
  }

  /** "Done 1 min ago", "Failed just now". */
  ago(task: BackgroundTask): string {
    const ms = this.service.now() - (task.finishedAt ?? task.startedAt);
    const min = Math.floor(ms / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min} min ago`;
    return `${Math.floor(min / 60)} h ago`;
  }

  percent(task: BackgroundTask): number | null {
    const p = task.progress;
    if (!p || p.total <= 0) return null;
    return Math.min(100, Math.round((p.done / p.total) * 100));
  }

  openTask(task: BackgroundTask): void {
    this.open.set(false);
    this.service.open(task.id);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close();
  }

  @HostListener('document:mousedown', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.open()) return;
    const target = event.target as Node | null;
    if (target && this.host.nativeElement.contains(target)) return;
    this.open.set(false);
  }
}
