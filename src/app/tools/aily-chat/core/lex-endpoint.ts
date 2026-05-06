/**
 * Lightweight stateless LLM call utility using lex endpoints.
 *
 * Bypasses Python server — calls LLM API directly via AilyServicesEndpoint / OpenAIEndpoint.
 * Used by: ChatEngineService.generateTitle() and legacy stateless helper flows.
 */

import { Observable } from 'rxjs';
import { AilyHost } from './host';

type AilyLexModule = typeof import('aily-lex/browser');

// Module singleton — shared with LexOwnerFacade (both lazy-load the same module).
let _lex: AilyLexModule | null = null;
let _loadPromise: Promise<AilyLexModule | null> | null = null;

async function getLexModule(): Promise<AilyLexModule | null> {
  if (_lex) return _lex;
  if (!_loadPromise) {
    _loadPromise = import('aily-lex/browser')
      .then(m => { _lex = m; return m; })
      .catch(() => { _loadPromise = null; return null; });
  }
  return _loadPromise;
}

function buildEndpoint(
  lex: AilyLexModule,
  llmConfig?: { apiKey: string; baseUrl: string } | null,
) {
  if (llmConfig?.apiKey && llmConfig?.baseUrl) {
    return new lex.OpenAIEndpoint({
      baseUrl: llmConfig.baseUrl,
      apiKey: llmConfig.apiKey,
      modelFamily: 'openai',
    });
  }

  const apiEndpoint = AilyHost.get().config?.apiEndpoint || '';
  return new lex.AilyServicesEndpoint({
    baseUrl: apiEndpoint,
    authTokenProvider: () => {
      const auth = AilyHost.get().auth;
      return auth?.getToken ? auth.getToken() : (auth?.token || '');
    },
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface LexStatelessStreamOptions {
  modelId?: string;
  llmConfig?: { apiKey: string; baseUrl: string } | null;
}

/**
 * Stateless LLM stream via lex endpoint.
 *
 * Emits `{ type: 'ModelClientStreamingChunkEvent', content }` events —
 * compatible with the existing stateless helper subscription pattern.
 */
export function lexStatelessStream(
  messages: any[],
  options?: LexStatelessStreamOptions,
): Observable<{ type: string; content?: string }> {
  return new Observable(observer => {
    const abortCtrl = new AbortController();

    (async () => {
      try {
        const lex = await getLexModule();
        if (!lex) {
          observer.error(new Error('aily-lex module not available'));
          return;
        }

        const endpoint = buildEndpoint(lex, options?.llmConfig);
        const config = {
          modelId: options?.modelId || 'default',
          maxOutputTokens: 4096,
        };

        for await (const chunk of endpoint.stream(messages, [], config, abortCtrl.signal)) {
          if (abortCtrl.signal.aborted) return;
          if (chunk.type === 'text' && chunk.text) {
            observer.next({ type: 'ModelClientStreamingChunkEvent', content: chunk.text });
          }
        }
        if (!abortCtrl.signal.aborted) observer.complete();
      } catch (err) {
        if (!abortCtrl.signal.aborted) observer.error(err);
      }
    })();

    return () => abortCtrl.abort();
  });
}

// ---------------------------------------------------------------------------
// Title generation prompt (replicated from server /api/v1/generate_title)
// ---------------------------------------------------------------------------

const TITLE_GEN_PROMPT = `你的职责是根据用户提供的内容生成一个十五字以内合适的标题。

重要规则：
1. 只返回JSON格式，不要输出任何思考过程或其他文字
2. 返回格式必须是：{"title": "<生成的标题>"}

请严格按照上述格式返回，直接输出JSON，不要添加任何额外说明。`;

/**
 * Generate a concise title for the given user message content.
 * Calls LLM via lex endpoint, returns parsed title string.
 */
export async function lexGenerateTitle(
  content: string,
  options?: LexStatelessStreamOptions,
): Promise<string> {
  const titleContent = content.length > 500 ? content.substring(0, 500) : content;
  const messages = [
    { role: 'system', content: TITLE_GEN_PROMPT },
    { role: 'user', content: titleContent },
  ];

  return new Promise<string>((resolve, reject) => {
    let text = '';
    const sub = lexStatelessStream(messages, options).subscribe({
      next: data => { if (data.content) text += data.content; },
      complete: () => {
        sub.unsubscribe();
        const trimmed = text.trim();
        try {
          resolve(JSON.parse(trimmed).title || trimmed);
        } catch {
          resolve(trimmed);
        }
      },
      error: err => { sub.unsubscribe(); reject(err); },
    });

    // 30s timeout (same as server)
    setTimeout(() => {
      sub.unsubscribe();
      if (text.trim()) {
        try { resolve(JSON.parse(text.trim()).title || text.trim()); }
        catch { resolve(text.trim()); }
      } else {
        reject(new Error('标题生成超时'));
      }
    }, 30000);
  });
}
