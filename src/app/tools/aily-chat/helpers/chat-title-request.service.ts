import type { LexStatelessStreamOptions } from '../core/lex-endpoint';
import { lexGenerateTitle } from '../core/lex-endpoint';

type TitleGenerator = (content: string, options?: LexStatelessStreamOptions) => Promise<string>;

export interface ChatTitleRequestProvider {
  generate(content: string): Promise<string>;
}

/**
 * Shapes title requests as a distinct utility/background call.
 */
export class ChatTitleRequestService implements ChatTitleRequestProvider {
  constructor(
    private readonly getLlmConfig: () => { apiKey: string; baseUrl: string } | null,
    private readonly generateTitleFn: TitleGenerator = lexGenerateTitle,
  ) {}

  generate(content: string): Promise<string> {
    return this.generateTitleFn(content, {
      requestContext: {
        requestKind: 'utility',
        interactionTypeOverride: 'conversation-background',
        userInitiatedRequest: false,
      },
      llmConfig: this.getLlmConfig(),
    });
  }
}