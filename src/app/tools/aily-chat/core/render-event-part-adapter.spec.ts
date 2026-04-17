import { ChatPartStore } from './chat-part-store';
import { RenderEventPartAdapter } from './render-event-part-adapter';
import type { RenderEvent } from 'aily-lex';

describe('RenderEventPartAdapter', () => {
  let store: ChatPartStore;
  let adapter: RenderEventPartAdapter;

  beforeEach(() => {
    store = new ChatPartStore();
    adapter = new RenderEventPartAdapter(store);
    adapter.setMsgIndex(0);
  });

  afterEach(() => {
    adapter.dispose();
    store.destroy();
  });

  it('should append markdown deltas to MarkdownPart', () => {
    adapter.process({ type: 'markdown_delta', text: 'Hello ', timestamp: 1 });
    adapter.process({ type: 'markdown_delta', text: 'world', timestamp: 2 });

    const parts = store.getParts(0);
    expect(parts.length).toBe(1);
    expect(parts[0].type).toBe('markdown');
    expect((parts[0] as any).content).toBe('Hello world');
  });

  it('should append thinking deltas and complete', () => {
    adapter.process({ type: 'thinking_delta', text: 'Let me think...', timestamp: 1 });
    adapter.process({ type: 'thinking_complete', timestamp: 2 });

    const parts = store.getParts(0);
    expect(parts.length).toBe(1);
    expect(parts[0].type).toBe('thinking');
    expect((parts[0] as any).content).toBe('Let me think...');
    expect((parts[0] as any).isComplete).toBe(true);
  });

  it('should handle tool call lifecycle', () => {
    adapter.process({
      type: 'tool_call_begin',
      toolCallId: 'tc1',
      toolName: 'readFile',
      input: { path: '/test.ts' },
      timestamp: 1,
    });

    let parts = store.getParts(0);
    expect(parts.length).toBe(1);
    expect(parts[0].type).toBe('tool_call');
    expect((parts[0] as any).state).toBe('doing');

    adapter.process({
      type: 'tool_call_end',
      toolCallId: 'tc1',
      toolName: 'readFile',
      resultText: 'File read successfully',
      durationMs: 100,
      state: 'done',
      isError: false,
      timestamp: 2,
    });

    parts = store.getParts(0);
    expect((parts[0] as any).state).toBe('done');
    expect((parts[0] as any).text).toBe('File read successfully');
  });

  it('should handle error tool call', () => {
    adapter.process({
      type: 'tool_call_begin',
      toolCallId: 'tc2',
      toolName: 'writeFile',
      input: {},
      timestamp: 1,
    });

    adapter.process({
      type: 'tool_call_end',
      toolCallId: 'tc2',
      toolName: 'writeFile',
      resultText: 'Permission denied',
      durationMs: 50,
      state: 'error',
      isError: true,
      timestamp: 2,
    });

    const parts = store.getParts(0);
    expect((parts[0] as any).state).toBe('error');
  });

  it('should upsert state updates', () => {
    adapter.process({
      type: 'state_update',
      stateId: 'mcp-1',
      kind: 'mcp',
      text: 'Connecting...',
      state: 'doing',
      timestamp: 1,
    });

    adapter.process({
      type: 'state_update',
      stateId: 'mcp-1',
      kind: 'mcp',
      text: 'Connected',
      state: 'done',
      timestamp: 2,
    });

    const parts = store.getParts(0);
    // Should still be 1 part (upsert, not add)
    expect(parts.filter(p => p.type === 'state').length).toBe(1);
    expect((parts[0] as any).text).toBe('Connected');
    expect((parts[0] as any).state).toBe('done');
  });

  it('should handle question request', () => {
    adapter.process({
      type: 'question_request',
      requestId: 'q1',
      questions: [{ question: 'Continue?', options: [{ label: 'Yes' }, { label: 'No' }] }],
      timestamp: 1,
    });

    const parts = store.getParts(0);
    expect(parts.length).toBe(1);
    expect(parts[0].type).toBe('question');
    expect((parts[0] as any).questions.length).toBe(1);
  });

  it('should handle approval request and resolve', () => {
    adapter.process({
      type: 'approval_request',
      requestId: 'a1',
      toolName: 'writeFile',
      input: {},
      message: 'Allow file write?',
      timestamp: 1,
    });

    let parts = store.getParts(0);
    expect(parts[0].type).toBe('approval');
    expect((parts[0] as any).resolved).toBe(false);

    adapter.process({
      type: 'approval_resolve',
      requestId: 'a1',
      result: 'approved',
      scope: 'session',
      timestamp: 2,
    });

    parts = store.getParts(0);
    expect((parts[0] as any).resolved).toBe(true);
    expect((parts[0] as any).result).toBe('approved');
  });

  it('should handle error notice', () => {
    adapter.process({
      type: 'error_notice',
      message: 'Something went wrong',
      timestamp: 1,
    });

    const parts = store.getParts(0);
    expect(parts[0].type).toBe('error');
    expect((parts[0] as any).message).toBe('Something went wrong');
  });

  it('should handle subagent lifecycle', () => {
    adapter.process({
      type: 'subagent_begin',
      toolCallId: 'sa1',
      agentName: 'Explore',
      description: 'Searching codebase',
      timestamp: 1,
    });

    let parts = store.getParts(0);
    expect(parts[0].type).toBe('subagent');
    expect((parts[0] as any).state).toBe('doing');

    adapter.process({
      type: 'subagent_activity',
      toolCallId: 'sa1',
      activityKind: 'tool_started',
      toolName: 'grep',
      childToolCallId: 'child1',
      content: 'Searching...',
      timestamp: 2,
    });

    parts = store.getParts(0);
    expect((parts[0] as any).childItems.length).toBe(1);
    expect((parts[0] as any).childItems[0].kind).toBe('tool');

    adapter.process({
      type: 'subagent_end',
      toolCallId: 'sa1',
      agentName: 'Explore',
      resultText: 'Found 3 matches',
      state: 'done',
      durationMs: 500,
      timestamp: 3,
    });

    parts = store.getParts(0);
    expect((parts[0] as any).state).toBe('done');
    expect((parts[0] as any).resultText).toBe('Found 3 matches');
  });

  it('should handle background task update', () => {
    adapter.process({
      type: 'background_task_update',
      taskId: 'task-1',
      stateId: 'bg-task-1',
      description: 'Building project',
      state: 'doing',
      progress: 50,
      timestamp: 1,
    });

    const parts = store.getParts(0);
    expect(parts[0].type).toBe('state');
    expect((parts[0] as any).kind).toBe('background_task');
    expect((parts[0] as any).progress).toBe(50);
  });

  it('should return false for lifecycle events', () => {
    expect(adapter.process({ type: 'turn_begin', turnId: 't1', timestamp: 1 } as RenderEvent)).toBe(false);
    expect(adapter.process({ type: 'turn_end', turnId: 't1', reason: 'end_turn', timestamp: 2 } as RenderEvent)).toBe(false);
    expect(store.getParts(0).length).toBe(0);
  });

  it('should ignore events when msgIndex not set', () => {
    const adapter2 = new RenderEventPartAdapter(store);
    // msgIndex defaults to -1
    const result = adapter2.process({ type: 'markdown_delta', text: 'Hello', timestamp: 1 });
    expect(result).toBe(false);
    adapter2.dispose();
  });

  it('should handle interleaved markdown and thinking', () => {
    adapter.process({ type: 'thinking_delta', text: 'Analyzing...', timestamp: 1 });
    adapter.process({ type: 'thinking_complete', timestamp: 2 });
    adapter.process({ type: 'markdown_delta', text: 'Here is the result', timestamp: 3 });

    const parts = store.getParts(0);
    expect(parts.length).toBe(2);
    expect(parts[0].type).toBe('thinking');
    expect(parts[1].type).toBe('markdown');
  });
});
