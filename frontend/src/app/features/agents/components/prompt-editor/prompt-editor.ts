import {
  Component,
  ElementRef,
  OnDestroy,
  afterNextRender,
  computed,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Editor, type JSONContent } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Mention from '@tiptap/extension-mention';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { UndoRedo } from '@tiptap/extensions';
import type {
  SuggestionKeyDownProps,
  SuggestionProps,
} from '@tiptap/suggestion';
import {
  LINKABLE_TOOLS,
  LinkKind,
  LinkOption,
  chipClass,
  promptLink,
  promptSegments,
} from '../../services/prompt-links';

interface LinkMenu {
  items: LinkOption[];
  active: number;
  top: number;
  left: number;
  select: (option: LinkOption) => void;
}

/** Mention ids are `kind:name`, so one node type covers skills and tools. */
function splitId(id: string): { kind: LinkKind; name: string } {
  const [kind, ...rest] = id.split(':');
  return { kind: kind as LinkKind, name: rest.join(':') };
}

/**
 * The text editor of instructions and skill bodies (ADR-0023): plain lines
 * with skill and tool chips. Type "/" (or press a `+ Link` button) to pick
 * one. The saved text carries the chips as `[[skill:name]]` and
 * `[[tool:name]]`. Loaded lazily, so Tiptap stays out of the initial bundle.
 */
@Component({
  selector: 'app-prompt-editor',
  templateUrl: './prompt-editor.html',
  styleUrl: './prompt-editor.scss',
})
export class PromptEditor implements OnDestroy {
  /** The text to start from; afterwards the editor owns it. */
  readonly value = input.required<string>();
  /** Skills offered in the "/" menu; none where only tools can be linked. */
  readonly skills = input<{ name: string; description: string }[]>([]);
  /** Whether skills can be linked at all (not in a skill body). */
  readonly linkSkills = input(true);
  /** The field's label, as the editor's accessible name. */
  readonly label = input('Instructions');
  /** The saved text may not be longer than this. */
  readonly maxLength = input(Infinity);
  readonly countTestId = input<string | null>(null);
  /** `single`: one `+ Link skill or tool` button that opens the whole menu. */
  readonly toolbar = input<'kinds' | 'single'>('kinds');
  /** Text beside the button of the `single` toolbar. */
  readonly toolbarHint = input('');
  readonly valueChange = output<string>();

  protected readonly menu = signal<LinkMenu | null>(null);
  /** The length of the saved text, shown as `<n>/<max>`. */
  protected readonly length = signal(0);
  protected readonly maxLabel = computed(() =>
    Number.isFinite(this.maxLength())
      ? this.maxLength().toLocaleString('en-US')
      : '',
  );

  private readonly options = computed<LinkOption[]>(() => [
    ...(this.linkSkills()
      ? this.skills().map((skill) => ({
          kind: 'skill' as const,
          name: skill.name,
          description: skill.description,
        }))
      : []),
    ...LINKABLE_TOOLS,
  ]);
  private readonly known = computed(
    () => new Set(this.options().map((o) => `${o.kind}:${o.name}`)),
  );
  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private editor?: Editor;
  /** Until the user has placed the cursor, a `+ Link` button appends. */
  private hasFocused = false;

  constructor() {
    afterNextRender(() => {
      this.length.set(this.value().length);
      this.editor = new Editor({
        element: this.host().nativeElement,
        extensions: [
          Document,
          Paragraph,
          Text,
          UndoRedo,
          this.mentionExtension(),
        ],
        content: toDoc(this.value()),
        editorProps: {
          attributes: {
            role: 'textbox',
            'aria-multiline': 'true',
            'aria-label': this.label(),
            spellcheck: 'false',
          },
        },
        onFocus: () => (this.hasFocused = true),
        onUpdate: ({ editor }) => {
          const text = toText(editor);
          if (text.length > this.maxLength()) {
            // Over the limit: take the edit back.
            editor.commands.undo();
            return;
          }
          this.length.set(text.length);
          this.valueChange.emit(text);
        },
      });
    });
  }

  /** Starts a link at the cursor, as if the user had typed "/". */
  openLinkMenu(kind?: LinkKind): void {
    const editor = this.editor;
    if (!editor) return;
    if (!this.hasFocused) editor.commands.focus('end');
    const { from } = editor.state.selection;
    const before = from > 1 ? editor.state.doc.textBetween(from - 1, from) : '';
    const trigger = before === '' || before === ' ' ? '/' : ' /';
    // The menu lists skills then tools; a kind button narrows it to that kind.
    this.kindFilter = kind;
    editor.chain().focus().insertContent(trigger).run();
  }

  protected choose(option: LinkOption): void {
    this.menu()?.select(option);
  }

  ngOnDestroy(): void {
    this.editor?.destroy();
  }

  private kindFilter?: LinkKind;

  private mentionExtension() {
    return Mention.configure({
      renderText: ({ node }) => {
        const { kind, name } = splitId(node.attrs['id']);
        return promptLink(kind, name);
      },
      renderHTML: ({ node }) => {
        const id: string = node.attrs['id'];
        const { kind, name } = splitId(id);
        return [
          'span',
          {
            class: chipClass(kind, name, this.known()),
            'data-link': id,
            ...(this.known().has(id) ? {} : { title: 'Not found' }),
          },
          name,
        ];
      },
      suggestion: {
        char: '/',
        // "/" inside a word ("km/h") is not a link: only after a space or at
        // the start of a line.
        allowedPrefixes: [' '],
        items: ({ query }) => {
          const q = query.toLowerCase();
          const kind = this.kindFilter;
          const matches = this.options().filter(
            (o) =>
              (!kind || o.kind === kind) &&
              (o.name.toLowerCase().includes(q) ||
                o.description.toLowerCase().includes(q)),
          );
          // Up to 6 of each kind, skills first, so neither crowds out the other.
          return [
            ...matches.filter((o) => o.kind === 'skill').slice(0, 6),
            ...matches.filter((o) => o.kind === 'tool').slice(0, 6),
          ];
        },
        render: () => ({
          onStart: (props) => this.showMenu(props),
          onUpdate: (props) => this.showMenu(props),
          onKeyDown: (props) => this.onMenuKey(props),
          onExit: () => {
            this.menu.set(null);
            this.kindFilter = undefined;
          },
        }),
      },
    });
  }

  private showMenu(props: SuggestionProps<LinkOption>): void {
    let rect: DOMRect | null = null;
    try {
      rect = props.clientRect?.() ?? null;
    } catch {
      // Some environments can't measure text ranges.
    }
    const active = this.menu()?.active ?? 0;
    this.menu.set({
      items: props.items,
      active: Math.min(active, Math.max(props.items.length - 1, 0)),
      top: (rect?.bottom ?? 0) + 6,
      left: rect?.left ?? 0,
      select: (option) =>
        props.command({
          id: `${option.kind}:${option.name}`,
          label: option.name,
        }),
    });
  }

  private onMenuKey({ event }: SuggestionKeyDownProps): boolean {
    const menu = this.menu();
    if (!menu) return false;
    const count = menu.items.length;

    switch (event.key) {
      case 'ArrowDown':
        if (count) {
          this.menu.set({ ...menu, active: (menu.active + 1) % count });
        }
        return true;
      case 'ArrowUp':
        if (count) {
          this.menu.set({
            ...menu,
            active: (menu.active - 1 + count) % count,
          });
        }
        return true;
      case 'Enter':
      case 'Tab':
        if (!count) return false;
        menu.select(menu.items[menu.active]);
        return true;
      case 'Escape':
        this.menu.set(null);
        return true;
      default:
        return false;
    }
  }
}

/** One paragraph per line; each link becomes a mention chip. */
export function toDoc(text: string): JSONContent {
  return {
    type: 'doc',
    content: text.split('\n').map((line) => ({
      type: 'paragraph',
      content: promptSegments(line)
        .filter((s) => s.kind !== 'text' || s.text !== '')
        .map((s) =>
          s.kind === 'text'
            ? { type: 'text', text: s.text }
            : {
                type: 'mention',
                attrs: { id: `${s.kind}:${s.name}`, label: s.name },
              },
        ),
    })),
  };
}

export function toText(editor: Editor): string {
  return editor.getText({ blockSeparator: '\n' });
}
