import { Component, computed, effect, input, signal } from '@angular/core';
import { agentPortrait, portraitInitial } from '../../utils/agent-portrait';

/**
 * An agent's face (ui.md 4.4, 4.5): its illustrated portrait in a round
 * tile, or the name's initial while the portrait loads or if it cannot be
 * drawn. Decorative: the agent's name always sits next to it, so the image
 * has an empty alt and the tile is hidden from assistive technology.
 */
@Component({
  selector: 'app-agent-avatar',
  template: `
    <span
      data-testid="agent-avatar"
      [attr.data-state]="src() ? 'portrait' : 'initial'"
      aria-hidden="true"
      class="agent-avatar"
      [style.width.px]="size()"
      [style.height.px]="size()"
      [style.font-size.px]="size() * 0.4"
    >
      @if (src(); as uri) {
        <img [src]="uri" alt="" class="h-full w-full" draggable="false" />
      } @else {
        {{ initial() }}
      }
    </span>
  `,
  styles: `
    :host {
      display: inline-flex;
      flex-shrink: 0;
      position: relative;
    }
    /* The portrait is black line art, so its tile stays light in both
       themes; the dark theme softens it a little (ui.md 4.4). */
    .agent-avatar {
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      border-radius: 9999px;
      background: #fdeee8;
      color: #9c2a0b;
      font-weight: 600;
      user-select: none;
    }
    :host-context([data-theme='dark']) .agent-avatar {
      background: #f3e2da;
    }
  `,
})
export class AgentAvatar {
  /** The agent's registry key or user-agent id: the portrait's seed. */
  readonly agentKey = input.required<string>();
  /** The agent's name, for the initial shown until the portrait loads. */
  readonly name = input.required<string>();
  /** Width and height in px. */
  readonly size = input(40);

  readonly src = signal<string | null>(null);
  readonly initial = computed(() => portraitInitial(this.name()));

  constructor() {
    effect((onCleanup) => {
      const key = this.agentKey();
      let live = true;
      onCleanup(() => (live = false));
      this.src.set(null);
      agentPortrait(key).then(
        (uri) => live && this.src.set(uri),
        () => undefined, // Keep the initial.
      );
    });
  }
}
