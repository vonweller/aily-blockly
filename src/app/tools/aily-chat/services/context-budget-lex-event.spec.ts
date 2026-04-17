import { createLexContextBudgetSnapshot } from './context-budget-lex-event';

describe('createLexContextBudgetSnapshot', () => {
  it('converts lex ratio thresholds into absolute token counts', () => {
    const snapshot = createLexContextBudgetSnapshot({
      maxTokens: 1000,
      usedTokens: 600,
      fallbackCompressionThreshold: 500,
      fallbackSummarizationThreshold: 750,
      extra: {
        systemTokens: 100,
        toolsTokens: 50,
        compressionThreshold: 0.6,
        summarizationThreshold: 0.85,
        messageCount: 4,
      },
    });

    expect(snapshot.currentTokens).toBe(600);
    expect(snapshot.compressionThreshold).toBe(600);
    expect(snapshot.summarizationThreshold).toBe(850);
    expect(snapshot.messagesTokens).toBe(450);
    expect(snapshot.usagePercent).toBe(60);
    expect(snapshot.messageCount).toBe(4);
  });

  it('falls back to host thresholds when lex ratios are absent', () => {
    const snapshot = createLexContextBudgetSnapshot({
      maxTokens: 2000,
      usedTokens: 400,
      fallbackCompressionThreshold: 900,
      fallbackSummarizationThreshold: 1400,
      extra: {
        messagesTokens: 250,
      },
    });

    expect(snapshot.compressionThreshold).toBe(900);
    expect(snapshot.summarizationThreshold).toBe(1400);
    expect(snapshot.messagesTokens).toBe(250);
    expect(snapshot.systemTokens).toBe(0);
    expect(snapshot.toolsTokens).toBe(0);
  });
});