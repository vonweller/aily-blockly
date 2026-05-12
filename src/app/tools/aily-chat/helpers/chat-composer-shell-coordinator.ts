import type { ComposerKeyAction } from './chat-composer-view';

interface ComposerViewStateLike {
  updateAgentSuggestions(inputValue: string): void;
  applyAgentSelection(agentName: string): string;
  resolveComposerKeyAction(input: {
    key: string;
    ctrlKey: boolean;
    inputValue: string;
    selectionStart: number;
    selectionEnd: number;
    isWaiting: boolean;
  }): ComposerKeyAction;
  hideAgentSuggestions(): void;
}

interface TextareaRefLike {
  nativeElement?: HTMLTextAreaElement | null;
}

export class ChatComposerShellCoordinator {
  constructor(
    private readonly deps: {
      viewState: ComposerViewStateLike;
      getInputValue: () => string;
      setInputValue: (value: string) => void;
      isWaiting: () => boolean;
      submitCurrentInput: () => Promise<unknown>;
      getTextareaRef: () => TextareaRefLike | undefined;
      schedule?: (work: () => void) => void;
    },
  ) {}

  updateSuggestions(): void {
    this.deps.viewState.updateAgentSuggestions(this.deps.getInputValue());
  }

  updateInputValue(value: string): void {
    this.deps.setInputValue(value);
  }

  selectAgent(agentName: string): void {
    this.deps.setInputValue(this.deps.viewState.applyAgentSelection(agentName));
    this.schedule(() => {
      this.deps.getTextareaRef()?.nativeElement?.focus();
    });
  }

  applyLineBreak(value: string, caret: number, textarea: HTMLTextAreaElement | null): void {
    this.deps.setInputValue(value);
    if (!textarea) {
      return;
    }

    this.schedule(() => {
      textarea.selectionStart = caret;
      textarea.selectionEnd = caret;
    });
  }

  async handleKeyDown(event: KeyboardEvent): Promise<void> {
    const textarea = event.target as HTMLTextAreaElement | null;
    const inputValue = this.deps.getInputValue();
    const composerAction = this.deps.viewState.resolveComposerKeyAction({
      key: event.key,
      ctrlKey: event.ctrlKey,
      inputValue,
      selectionStart: textarea?.selectionStart ?? inputValue.length,
      selectionEnd: textarea?.selectionEnd ?? inputValue.length,
      isWaiting: this.deps.isWaiting(),
    });

    switch (composerAction.kind) {
      case 'select-agent':
        event.preventDefault();
        this.selectAgent(composerAction.agentName);
        return;

      case 'hide-suggestions':
        this.deps.viewState.hideAgentSuggestions();
        event.preventDefault();
        return;

      case 'insert-line-break':
        this.applyLineBreak(composerAction.value, composerAction.caret, textarea);
        event.preventDefault();
        return;

      case 'submit':
        event.preventDefault();
        await this.deps.submitCurrentInput();
        return;

      default:
        return;
    }
  }

  private schedule(work: () => void): void {
    const scheduler = this.deps.schedule ?? ((callback: () => void) => setTimeout(callback, 0));
    scheduler(work);
  }
}