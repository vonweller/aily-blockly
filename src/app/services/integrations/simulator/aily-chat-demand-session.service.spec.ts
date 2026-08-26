import {
  AilyChatDemandSessionService,
  type AilyChatDemandSessionResult,
} from './aily-chat-demand-session.service';

describe('AilyChatDemandSessionService', () => {
  const channel = 'aily-chat-demand-session-v1';

  function createHarness() {
    let processMessageListener: ((message: Record<string, unknown>) => void) | null = null;
    const sentMessages: Record<string, unknown>[] = [];
    const openedSessions: string[] = [];
    const childToolProcess = {
      acquire: async () => undefined,
      release: async () => undefined,
      onMessage: (
        _toolId: string,
        listener: (message: Record<string, unknown>) => void,
      ) => {
        processMessageListener = listener;
        return () => {
          processMessageListener = null;
        };
      },
      sendMessage: async (_toolId: string, message: Record<string, unknown>) => {
        sentMessages.push(message);
        const requestId = String(message['requestId']);
        queueMicrotask(() => {
          processMessageListener?.({
            channel,
            type: 'event',
            requestId,
            event: { type: 'session-created', sessionId: 'session-1' },
          });
          const result: AilyChatDemandSessionResult = {
            accepted: true,
            sessionId: 'session-1',
            state: 'settled',
          };
          processMessageListener?.({
            channel,
            type: 'response',
            requestId,
            result,
          });
        });
      },
    };
    const service = new AilyChatDemandSessionService(
      { currentProjectPath: '/tmp/project' } as never,
      { getConnectionGraph: () => null } as never,
      { isElectron: false } as never,
      childToolProcess as never,
      {
        openAilyChatSession: async (sessionId: string) => {
          openedSessions.push(sessionId);
          return true;
        },
      } as never,
    );
    return { service, sentMessages, openedSessions };
  }

  it('creates an ArchitectureAgent demand session without composer injection', async () => {
    const harness = createHarness();

    await harness.service.createArchitectureSession('生成项目架构图');

    expect(harness.sentMessages).toHaveSize(1);
    expect(harness.sentMessages[0]).toEqual(jasmine.objectContaining({
      channel,
      action: 'demand-session.run',
      kind: 'architecture',
      mode: 'agent',
      prompt: '[AGENT: ArchitectureAgent] 生成项目架构图',
      revealSession: true,
    }));
    expect(harness.openedSessions).toEqual(['session-1']);
  });

  it('creates an ask-mode block explanation session with block resources', async () => {
    const harness = createHarness();
    const resources = [{
      type: 'block' as const,
      name: 'digital write',
      blockId: 'block-1',
      blockContext: '<block type="digital_write" />',
    }];

    await harness.service.explainBlocks('解释这个积木块', resources);

    expect(harness.sentMessages[0]).toEqual(jasmine.objectContaining({
      action: 'demand-session.run',
      kind: 'block-explain',
      mode: 'ask',
      prompt: '解释这个积木块',
      resources,
    }));
  });

  it('uses only the canonical SchematicAgent marker', async () => {
    const harness = createHarness();

    await harness.service.generateSchematic('生成项目连线图', { revealSession: true });

    expect(harness.sentMessages[0]).toEqual(jasmine.objectContaining({
      action: 'demand-session.run',
      kind: 'schematic',
      mode: 'agent',
      prompt: '[AGENT: SchematicAgent] 生成项目连线图',
    }));
  });
});
