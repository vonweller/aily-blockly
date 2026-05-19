import { ChatPartStore } from './chat-part-store';
import { RenderEventPartAdapter } from './render-event-part-adapter';
import { buildToolActivityDisplayItem } from '../components/x-dialog/chat-activity-group-projection';
import type { RenderEvent } from 'aily-lex/browser';

describe('RenderEventPartAdapter', () => {
  let store: ChatPartStore;
  let adapter: RenderEventPartAdapter;
  let currentHandle: any;

  beforeEach(() => {
    store = new ChatPartStore();
    adapter = new RenderEventPartAdapter(store);
    currentHandle = store.createDetachedHandle();
  });

  afterEach(() => {
    adapter.dispose();
    store.destroy();
  });

  it('should append markdown deltas to MarkdownPart', () => {
    processCurrent({ type: 'markdown_delta', text: 'Hello ', timestamp: 1 });
    processCurrent({ type: 'markdown_delta', text: 'world', timestamp: 2 });

    const parts = store.getPartsForHandle(currentHandle);
    expect(parts.length).toBe(1);
    expect(parts[0].type).toBe('markdown');
    expect((parts[0] as any).content).toBe('Hello world');
  });

  it('should append thinking deltas and complete', () => {
    processCurrent({ type: 'thinking_delta', text: 'Let me think...', timestamp: 1 });
    processCurrent({ type: 'thinking_complete', timestamp: 2 });

    const parts = store.getPartsForHandle(currentHandle);
    expect(parts.length).toBe(1);
    expect(parts[0].type).toBe('thinking');
    expect((parts[0] as any).content).toBe('Let me think...');
    expect((parts[0] as any).isComplete).toBe(true);
  });

  it('should handle tool call lifecycle', () => {
    processCurrent({
      type: 'tool_call_begin',
      toolCallId: 'tc1',
      toolName: 'readFile',
      input: { path: '/test.ts' },
      timestamp: 1,
    });

    let parts = store.getPartsForHandle(currentHandle);
    expect(parts.length).toBe(1);
    expect(parts[0].type).toBe('tool_call');
    expect((parts[0] as any).state).toBe('doing');

    processCurrent({
      type: 'tool_call_end',
      toolCallId: 'tc1',
      toolName: 'readFile',
      resultText: 'File read successfully',
      durationMs: 100,
      state: 'done',
      isError: false,
      timestamp: 2,
    });

    parts = store.getPartsForHandle(currentHandle);
    expect((parts[0] as any).state).toBe('done');
    expect((parts[0] as any).text).toBe('File read successfully');
  });

  it('should handle error tool call', () => {
    processCurrent({
      type: 'tool_call_begin',
      toolCallId: 'tc2',
      toolName: 'writeFile',
      input: {},
      timestamp: 1,
    });

    processCurrent({
      type: 'tool_call_end',
      toolCallId: 'tc2',
      toolName: 'writeFile',
      resultText: 'Permission denied',
      durationMs: 50,
      state: 'error',
      isError: true,
      timestamp: 2,
    });

    const parts = store.getPartsForHandle(currentHandle);
    expect((parts[0] as any).state).toBe('error');
  });

  it('preserves structured read_file metadata from lex tool results through the displayed tool header', () => {
    processCurrent({
      type: 'tool_call_begin',
      toolCallId: 'tc-read-file',
      toolName: 'read_file',
      input: { filePath: '/workspace/readme_ai.md', startLine: 1, endLine: 2000 },
      timestamp: 1,
    });

    processCurrent({
      type: 'tool_call_end',
      toolCallId: 'tc-read-file',
      toolName: 'read_file',
      resultText: '1\talpha\n2\tbeta',
      result: {
        content: [{ type: 'text', text: '1\talpha\n2\tbeta' }],
        metadata: {
          readFile: {
            filePath: '/workspace/readme_ai.md',
            requestedStartLine: 1,
            requestedEndLine: 2000,
            returnedStartLine: 1,
            returnedEndLine: 120,
            lineCount: 120,
            totalLines: 4000,
            readBytes: 4096,
            totalBytes: 16384,
            truncatedByBytes: true,
            continueWith: {
              startLine: 121,
              endLine: 2120,
            },
          },
        },
      },
      durationMs: 100,
      state: 'done',
      isError: false,
      timestamp: 2,
    });

    const part = store.getPartsForHandle(currentHandle)[0] as any;
    expect(part.metadata?.readFile).toEqual(jasmine.objectContaining({
      returnedStartLine: 1,
      returnedEndLine: 120,
      totalBytes: 16384,
      readBytes: 4096,
      truncatedByBytes: true,
      continueWith: jasmine.objectContaining({ startLine: 121, endLine: 2120 }),
    }));

    const display = buildToolActivityDisplayItem(part);
    expect(display.toolHeader).toEqual(jasmine.objectContaining({
      title: 'Read readme_ai.md',
      subtitle: 'lines 1 to 120, 4,096 bytes of 16,384 bytes, byte-capped, continue with lines 121 to 2120',
    }));
  });

  it('should append a terminal part for run_in_terminal tool results', () => {
    processCurrent({
      type: 'tool_call_begin',
      toolCallId: 'tc-terminal',
      toolName: 'run_in_terminal',
      input: { command: 'npm test' },
      timestamp: 1,
    });

    processCurrent({
      type: 'tool_call_end',
      toolCallId: 'tc-terminal',
      toolName: 'run_in_terminal',
      resultText: 'status: success',
      result: {
        content: [{
          type: 'text',
          text: 'status: success\nterminalId: term-1\nexitCode: 0\ncwd: /workspace\ncommand: npm test\n\nstdout:\ndone\n\nstderr:\n(terminal stderr completed with no output)',
        }],
      },
      durationMs: 50,
      state: 'done',
      isError: false,
      timestamp: 2,
    });

    const parts = store.getPartsForHandle(currentHandle);
    expect(parts).toEqual([
      jasmine.objectContaining({ type: 'tool_call', toolCallId: 'tc-terminal', state: 'done' }),
      jasmine.objectContaining({ type: 'terminal', command: 'npm test', output: 'done', exitCode: 0 }),
    ]);
    expect((parts[0] as any).metadata?.timeline?.[0]?.resultContent).toEqual([
      jasmine.objectContaining({
        type: 'terminal_command',
        text: 'npm test',
      }),
      jasmine.objectContaining({ type: 'terminal_stdout', text: 'done' }),
    ]);
  });

  it('should preserve structured image and resource tool results in metadata timeline', () => {
    processCurrent({
      type: 'tool_call_begin',
      toolCallId: 'tc-structured',
      toolName: 'mcp_read_resource',
      input: { uri: 'file:///workspace/report.json' },
      timestamp: 1,
    });

    processCurrent({
      type: 'tool_call_end',
      toolCallId: 'tc-structured',
      toolName: 'mcp_read_resource',
      resultText: '读取资源结果',
      result: {
        content: [
          {
            type: 'image',
            mimeType: 'image/png',
            data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4//8/AwAI/AL+X2HFNwAAAABJRU5ErkJggg==',
          },
          {
            type: 'resource',
            uri: 'file:///workspace/report.json',
            mimeType: 'application/json',
            text: '结构化诊断结果',
          },
        ],
      },
      durationMs: 20,
      state: 'done',
      isError: false,
      timestamp: 2,
    });

    const parts = store.getPartsForHandle(currentHandle);
    expect((parts[0] as any).metadata?.timeline?.[0]?.resultContent).toEqual([
      jasmine.objectContaining({ type: 'output_image', mimeType: 'image/png' }),
      jasmine.objectContaining({
        type: 'output_resource',
        uri: 'file:///workspace/report.json',
        mimeType: 'application/json',
        text: '结构化诊断结果',
      }),
    ]);
  });

  it('should upsert state updates', () => {
    processCurrent({
      type: 'state_update',
      stateId: 'mcp-1',
      kind: 'mcp',
      text: 'Connecting...',
      state: 'doing',
      timestamp: 1,
    });

    processCurrent({
      type: 'state_update',
      stateId: 'mcp-1',
      kind: 'mcp',
      text: 'Connected',
      state: 'done',
      timestamp: 2,
    });

    const parts = store.getPartsForHandle(currentHandle);
    // Should still be 1 part (upsert, not add)
    expect(parts.filter(p => p.type === 'state').length).toBe(1);
    expect((parts[0] as any).text).toBe('Connected');
    expect((parts[0] as any).state).toBe('done');
  });

  it('should handle question request', () => {
    processCurrent({
      type: 'question_request',
      requestId: 'q1',
      questions: [{ question: 'Continue?', options: [{ label: 'Yes' }, { label: 'No' }] }],
      timestamp: 1,
    });

    const parts = store.getPartsForHandle(currentHandle);
    expect(parts.length).toBe(1);
    expect(parts[0].type).toBe('question');
    expect((parts[0] as any).partId).toBe('question:q1');
    expect((parts[0] as any).questions.length).toBe(1);
  });

  it('should handle approval request and resolve', () => {
    processCurrent({
      type: 'tool_call_begin',
      toolCallId: 'a1',
      toolName: 'writeFile',
      input: { path: '/demo.ts' },
      timestamp: 0,
    });

    processCurrent({
      type: 'approval_request',
      toolCallId: 'a1',
      toolName: 'writeFile',
      input: {},
      message: 'Allow file write?',
      timestamp: 1,
    });

    let parts = store.getPartsForHandle(currentHandle);
    expect(parts.length).toBe(1);
    expect(parts[0]).toEqual(jasmine.objectContaining({
      type: 'tool_call',
      toolCallId: 'a1',
      state: 'pending_approval',
      text: 'Allow file write?',
      metadata: jasmine.objectContaining({
        approval: jasmine.objectContaining({
          toolCallId: 'a1',
          toolName: 'writeFile',
          resolved: false,
        }),
      }),
    }));

    processCurrent({
      type: 'approval_resolve',
      toolCallId: 'a1',
      result: 'approved',
      scope: 'session',
      timestamp: 2,
    });

    parts = store.getPartsForHandle(currentHandle);
    expect(parts.length).toBe(1);
    expect(parts[0]).toEqual(jasmine.objectContaining({
      type: 'tool_call',
      toolCallId: 'a1',
      state: 'doing',
      text: 'writeFile…',
      metadata: jasmine.objectContaining({
        approval: jasmine.objectContaining({
          toolCallId: 'a1',
          toolName: 'writeFile',
          message: 'Allow file write?',
          previousText: 'writeFile…',
          resolved: true,
          result: 'approved',
          scope: 'session',
        }),
      }),
    }));
  });

  it('should keep standalone confirmation parts when no matching tool call exists', () => {
    processCurrent({
      type: 'approval_request',
      requestId: 'standalone-approval',
      toolName: 'writeFile',
      input: { path: '/demo.ts' },
      message: 'Allow file write?',
      timestamp: 1,
    });

    const parts = store.getPartsForHandle(currentHandle);
    expect(parts.length).toBe(1);
    expect(parts[0]).toEqual(jasmine.objectContaining({
      type: 'confirmation',
      askId: 'standalone-approval',
      title: '确认执行 writeFile',
      resolved: false,
    }));
  });

  it('should preserve structured approval presentation data from render events', () => {
    processCurrent({
      type: 'approval_request',
      requestId: 'a2',
      toolName: 'run_in_terminal',
      input: { command: 'npm test' },
      message: 'lex 下发的审批消息',
      description: '```diff\n- old\n+ new\n```',
      title: '运行终端命令',
      subtitle: 'run_in_terminal · lex',
      actions: [
        { scope: 'workspace', label: '在当前工作区中自动运行此命令', tooltip: '写入工作区规则' },
      ],
      primaryScope: 'workspace',
      timestamp: 3,
    });

    const parts = store.getPartsForHandle(currentHandle);
    expect(parts[0]).toEqual(jasmine.objectContaining({
      type: 'confirmation',
      askId: 'a2',
      title: '运行终端命令',
      subtitle: 'run_in_terminal · lex',
      description: '```diff\n- old\n+ new\n```',
      args: jasmine.objectContaining({ command: 'npm test' }),
      primaryScope: 'workspace',
      actions: [
        jasmine.objectContaining({ scope: 'workspace', label: '在当前工作区中自动运行此命令' }),
      ],
    }));
  });

  it('should not synthesize standalone confirmation parts for tool-linked approval events without a matching tool call', () => {
    processCurrent({
      type: 'approval_request',
      toolCallId: 'missing-tool-call',
      toolName: 'writeFile',
      input: { path: '/demo.ts' },
      message: 'Allow file write?',
      timestamp: 1,
    });

    const parts = store.getPartsForHandle(currentHandle);
    expect(parts.length).toBe(0);
  });

  it('should handle error notice', () => {
    processCurrent({
      type: 'error_notice',
      message: 'Something went wrong',
      timestamp: 1,
    });

    const parts = store.getPartsForHandle(currentHandle);
    expect(parts[0].type).toBe('error');
    expect((parts[0] as any).message).toBe('Something went wrong');
  });

  it('should handle info notice', () => {
    processCurrent({
      type: 'info_notice',
      message: 'Index complete',
      timestamp: 1,
    });

    const parts = store.getPartsForHandle(currentHandle);
    expect(parts[0].type).toBe('error');
    expect((parts[0] as any).message).toBe('Index complete');
    expect((parts[0] as any).severity).toBe('info');
  });

  it('should handle subagent lifecycle', () => {
    processCurrent({
      type: 'subagent_begin',
      toolCallId: 'sa1',
      agentName: 'Explore',
      description: 'Searching codebase',
      timestamp: 1,
    });

    let parts = store.getPartsForHandle(currentHandle);
    expect(parts[0].type).toBe('tool_call');
    expect((parts[0] as any).state).toBe('doing');
    expect((parts[0] as any).toolName).toBe('agent');
    expect((parts[0] as any).metadata).toEqual(jasmine.objectContaining({
      toolName: 'agent',
      subAgentInvocationId: 'sa1',
      invocationMessage: 'Searching codebase',
      toolSpecificData: jasmine.objectContaining({
        description: 'Searching codebase',
        agentName: 'Explore',
        result: '',
      }),
    }));

    processCurrent({
      type: 'subagent_activity',
      toolCallId: 'sa1',
      activityKind: 'tool_started',
      toolName: 'grep',
      childToolCallId: 'child1',
      content: 'Searching...',
      timestamp: 2,
    });

    parts = store.getPartsForHandle(currentHandle);
    expect((parts[0] as any).metadata.toolSpecificData.childItems.length).toBe(1);
    expect((parts[0] as any).metadata.toolSpecificData.childItems[0].kind).toBe('tool');

    processCurrent({
      type: 'subagent_activity',
      toolCallId: 'sa1',
      activityKind: 'tool_progress',
      toolName: 'grep',
      childToolCallId: 'child1',
      content: 'Still searching...',
      timestamp: 2.5,
    });

    parts = store.getPartsForHandle(currentHandle);
    expect((parts[0] as any).metadata.toolSpecificData.childItems.length).toBe(1);
    expect((parts[0] as any).metadata.toolSpecificData.childItems[0]).toEqual(jasmine.objectContaining({
      kind: 'tool',
      toolCallId: 'child1',
      content: 'Still searching...',
      state: 'doing',
    }));

    processCurrent({
      type: 'subagent_end',
      toolCallId: 'sa1',
      agentName: 'Explore',
      resultText: 'Found 3 matches',
      state: 'done',
      durationMs: 500,
      timestamp: 3,
    });

    parts = store.getPartsForHandle(currentHandle);
    expect((parts[0] as any).state).toBe('done');
    expect((parts[0] as any).metadata).toEqual(jasmine.objectContaining({
      subAgentInvocationId: 'sa1',
      toolSpecificData: jasmine.objectContaining({
        description: 'Searching codebase',
        agentName: 'Explore',
        result: 'Found 3 matches',
      }),
    }));
  });

  it('should handle background task update', () => {
    processCurrent({
      type: 'background_task_update',
      taskId: 'task-1',
      stateId: 'bg-task-1',
      description: 'Building project',
      state: 'doing',
      progress: 50,
      timestamp: 1,
    });

    const parts = store.getPartsForHandle(currentHandle);
    expect(parts[0].type).toBe('state');
    expect((parts[0] as any).kind).toBe('background_task');
    expect((parts[0] as any).progress).toBe(50);
  });

  it('projects todo updates as dedicated todo activity state', () => {
    processCurrent({
      type: 'todo_update',
      sessionId: 'sess-1',
      summary: 'Todo list updated: 2 items (0 completed, 2 remaining). Current: "收口 input part band"',
      items: [
        { id: 1, title: '收口 input part band', status: 'in-progress' },
        { id: 2, title: '对齐 todo transcript 标题', status: 'not-started' },
      ],
      timestamp: 1,
    } as any);

    const parts = store.getPartsForHandle(currentHandle);
    expect(parts[0].type).toBe('state');
    expect((parts[0] as any).kind).toBe('todo');
    expect((parts[0] as any).state).toBe('doing');
    expect((parts[0] as any).text).toContain('Todo list updated');
    expect((parts[0] as any).metadata.timeline.length).toBe(1);
    expect((parts[0] as any).metadata.timeline[0].phaseLabel).toBe('开始 收口 input part band');

    processCurrent({
      type: 'todo_update',
      sessionId: 'sess-1',
      summary: 'Todo list updated: 2 items (1 completed, 1 remaining). Current: "对齐 todo transcript 标题"',
      items: [
        { id: 1, title: '收口 input part band', status: 'completed' },
        { id: 2, title: '对齐 todo transcript 标题', status: 'in-progress' },
      ],
      timestamp: 2,
    } as any);

    const nextParts = store.getPartsForHandle(currentHandle);
    expect((nextParts[0] as any).metadata.timeline.length).toBe(2);
    expect((nextParts[0] as any).metadata.timeline[1].activeTitle).toBe('对齐 todo transcript 标题');
    expect((nextParts[0] as any).metadata.timeline[1].phaseLabel).toBe('完成 收口 input part band');
    expect((nextParts[0] as any).metadata.timeline[1].phaseDetail).toBe('切换到 对齐 todo transcript 标题');
  });

  it('patches the latest todo tool call with todoList-style toolSpecificData on todo updates', () => {
    processCurrent({
      type: 'tool_call_begin',
      toolCallId: 'todo-tool-1',
      toolName: 'todo_write_tool',
      input: { operation: 'add' },
      timestamp: 1,
    } as any);

    processCurrent({
      type: 'todo_update',
      sessionId: 'sess-tools',
      summary: 'Todo list updated: 1 items (0 completed, 1 remaining). Current: "补齐 toolSpecificData"',
      items: [
        { id: 1, title: '补齐 toolSpecificData', status: 'in-progress' },
      ],
      timestamp: 2,
    } as any);

    const parts = store.getPartsForHandle(currentHandle);
    expect((parts[0] as any).metadata.toolSpecificData).toEqual(jasmine.objectContaining({
      kind: 'todoList',
      summary: 'Todo list updated: 1 items (0 completed, 1 remaining). Current: "补齐 toolSpecificData"',
      currentTask: '补齐 toolSpecificData',
      todoList: [
        jasmine.objectContaining({ id: '1', title: '补齐 toolSpecificData', status: 'in-progress' }),
      ],
    }));
  });

  it('should return false for lifecycle events', () => {
    expect(processCurrent({ type: 'turn_begin', turnId: 't1', timestamp: 1 } as RenderEvent)).toBe(false);
    expect(processCurrent({ type: 'turn_end', turnId: 't1', reason: 'end_turn', timestamp: 2 } as RenderEvent)).toBe(false);
    expect(store.getPartsForHandle(currentHandle).length).toBe(0);
  });

  it('should ignore events when msgIndex not set', () => {
    const adapter2 = new RenderEventPartAdapter(store);
    // no current handle configured
    const result = adapter2.process({ type: 'markdown_delta', text: 'Hello', timestamp: 1 }, null);
    expect(result).toBe(false);
    adapter2.dispose();
  });

  it('should handle interleaved markdown and thinking', () => {
    processCurrent({ type: 'thinking_delta', text: 'Analyzing...', timestamp: 1 });
    processCurrent({ type: 'thinking_complete', timestamp: 2 });
    processCurrent({ type: 'markdown_delta', text: 'Here is the result', timestamp: 3 });

    const parts = store.getPartsForHandle(currentHandle);
    expect(parts.length).toBe(2);
    expect(parts[0].type).toBe('thinking');
    expect(parts[1].type).toBe('markdown');
  });

  it('keeps tool call updates on the originating handle after current handle advances', () => {
    processCurrent({
      type: 'tool_call_begin',
      toolCallId: 'tc-shift',
      toolName: 'readFile',
      input: { path: '/test.ts' },
      timestamp: 1,
    });

    const originalHandle = currentHandle;
    const advancedHandle = store.createDetachedHandle('shift-1');
    currentHandle = advancedHandle;

    processCurrent({
      type: 'tool_call_progress',
      toolCallId: 'tc-shift',
      data: 'still running',
      timestamp: 2,
    } as RenderEvent);
    processCurrent({
      type: 'tool_call_end',
      toolCallId: 'tc-shift',
      toolName: 'readFile',
      resultText: 'File read successfully',
      durationMs: 100,
      state: 'done',
      isError: false,
      timestamp: 3,
    });

    expect(store.getPartsForHandle(originalHandle)).toEqual([
      jasmine.objectContaining({
        type: 'tool_call',
        toolCallId: 'tc-shift',
        state: 'done',
        text: 'File read successfully',
      }),
    ]);
    expect(store.getPartsForHandle(advancedHandle)).toEqual([]);
  });

  it('projects structured tool progress updates onto the live tool_call part', () => {
    processCurrent({
      type: 'tool_call_begin',
      toolCallId: 'tc-progress',
      toolName: 'read_file',
      input: { filePath: 'src/app/main.ts' },
      timestamp: 1,
    });

    processCurrent({
      type: 'tool_call_progress',
      toolCallId: 'tc-progress',
      data: {
        message: 'Reading file',
        detail: 'src/app/main.ts',
        statusText: 'running',
        progress: 42,
      },
      timestamp: 2,
    } as RenderEvent);

    expect(store.getPartsForHandle(currentHandle)).toEqual([
      jasmine.objectContaining({
        type: 'tool_call',
        toolCallId: 'tc-progress',
        toolName: 'read_file',
        state: 'doing',
        text: 'Reading file',
        metadata: jasmine.objectContaining({
          toolName: 'read_file',
          phase: 'progress',
          progress: 42,
          timeline: [jasmine.objectContaining({
            recordId: 'tc-progress:progress',
            phase: 'progress',
            summary: 'Reading file',
            progress: 42,
            progressDetails: jasmine.objectContaining({
              message: 'Reading file',
              detail: 'src/app/main.ts',
              statusText: 'running',
              progress: 42,
            }),
            timestamp: 2,
          })],
        }),
      }),
    ]);
  });

  it('keeps subagent activity and completion on the originating handle after current handle advances', () => {
    processCurrent({
      type: 'subagent_begin',
      toolCallId: 'sa-shift',
      agentName: 'Explore',
      description: 'Searching codebase',
      timestamp: 1,
    });

    const originalHandle = currentHandle;
    const advancedHandle = store.createDetachedHandle('shift-2');
    currentHandle = advancedHandle;

    processCurrent({
      type: 'subagent_activity',
      toolCallId: 'sa-shift',
      activityKind: 'tool_started',
      toolName: 'grep',
      childToolCallId: 'child-shift',
      content: 'Searching...',
      timestamp: 2,
    });
    processCurrent({
      type: 'subagent_end',
      toolCallId: 'sa-shift',
      agentName: 'Explore',
      resultText: 'Found matches',
      state: 'done',
      durationMs: 500,
      timestamp: 3,
    });

    expect(store.getPartsForHandle(originalHandle)).toEqual([
      jasmine.objectContaining({
        type: 'tool_call',
        toolCallId: 'sa-shift',
        state: 'done',
        metadata: jasmine.objectContaining({
          toolSpecificData: jasmine.objectContaining({
            result: 'Found matches',
            childItems: [
              jasmine.objectContaining({
                kind: 'tool',
                toolCallId: 'child-shift',
                state: 'doing',
              }),
            ],
          }),
        }),
      }),
    ]);
    expect(store.getPartsForHandle(advancedHandle)).toEqual([]);
  });

  it('keeps subagent child-item updates on the originating handle after current handle advances', () => {
    processCurrent({
      type: 'subagent_begin',
      toolCallId: 'sa-child-shift',
      agentName: 'Explore',
      description: 'Searching codebase',
      timestamp: 1,
    });

    const originalHandle = currentHandle;
    const advancedHandle = store.createDetachedHandle('shift-3');
    currentHandle = advancedHandle;

    processCurrent({
      type: 'subagent_activity',
      toolCallId: 'sa-child-shift',
      activityKind: 'tool_started',
      toolName: 'grep',
      childToolCallId: 'child-keep',
      content: 'Searching...',
      timestamp: 2,
    });
    processCurrent({
      type: 'subagent_activity',
      toolCallId: 'sa-child-shift',
      activityKind: 'tool_completed',
      toolName: 'grep',
      childToolCallId: 'child-keep',
      content: 'Done',
      durationMs: 1500,
      timestamp: 3,
    });

    expect(store.getPartsForHandle(originalHandle)).toEqual([
      jasmine.objectContaining({
        type: 'tool_call',
        toolCallId: 'sa-child-shift',
        metadata: jasmine.objectContaining({
          toolSpecificData: jasmine.objectContaining({
            childItems: [
              jasmine.objectContaining({
                kind: 'tool',
                toolCallId: 'child-keep',
                content: 'Done',
                state: 'done',
                duration: 1.5,
              }),
            ],
          }),
        }),
      }),
    ]);
    expect(store.getPartsForHandle(advancedHandle)).toEqual([]);
  });

  it('keeps a completed child tool result when the next child tool starts', () => {
    processCurrent({
      type: 'subagent_begin',
      toolCallId: 'sa-multi-child',
      agentName: 'Explore',
      description: 'Searching codebase',
      timestamp: 1,
    });

    processCurrent({
      type: 'subagent_activity',
      toolCallId: 'sa-multi-child',
      activityKind: 'tool_started',
      toolName: 'read_file',
      childToolCallId: 'child-first',
      content: '',
      argsSummary: 'src/app/main.ts',
      timestamp: 2,
    });
    processCurrent({
      type: 'subagent_activity',
      toolCallId: 'sa-multi-child',
      activityKind: 'tool_completed',
      toolName: 'read_file',
      childToolCallId: 'child-first',
      content: 'file contents',
      durationMs: 200,
      timestamp: 3,
    });
    processCurrent({
      type: 'subagent_activity',
      toolCallId: 'sa-multi-child',
      activityKind: 'tool_started',
      toolName: 'grep_search',
      childToolCallId: 'child-second',
      content: '',
      argsSummary: 'ToolDisplayRegistry',
      timestamp: 4,
    });

    const parts = store.getPartsForHandle(currentHandle);
    expect((parts[0] as any).metadata.toolSpecificData.childItems).toEqual([
      jasmine.objectContaining({
        kind: 'tool',
        toolCallId: 'child-first',
        toolName: 'read_file',
        argsSummary: 'src/app/main.ts',
        content: 'file contents',
        state: 'done',
        duration: 0.2,
      }),
      jasmine.objectContaining({
        kind: 'tool',
        toolCallId: 'child-second',
        toolName: 'grep_search',
        argsSummary: 'ToolDisplayRegistry',
        content: '',
        state: 'doing',
      }),
    ]);
  });

  it('coalesces consecutive subagent thinking and text chunks into single child items', () => {
    processCurrent({
      type: 'subagent_begin',
      toolCallId: 'sa-coalesce',
      agentName: 'Explore',
      description: 'Searching codebase',
      timestamp: 1,
    });

    processCurrent({
      type: 'subagent_activity',
      toolCallId: 'sa-coalesce',
      activityKind: 'thinking',
      content: 'Let',
      timestamp: 2,
    });
    processCurrent({
      type: 'subagent_activity',
      toolCallId: 'sa-coalesce',
      activityKind: 'thinking',
      content: ' me think',
      timestamp: 3,
    });
    processCurrent({
      type: 'subagent_activity',
      toolCallId: 'sa-coalesce',
      activityKind: 'text',
      content: 'Hello',
      timestamp: 4,
    });
    processCurrent({
      type: 'subagent_activity',
      toolCallId: 'sa-coalesce',
      activityKind: 'text',
      content: ' world',
      timestamp: 5,
    });
    processCurrent({
      type: 'subagent_activity',
      toolCallId: 'sa-coalesce',
      activityKind: 'text',
      content: '',
      timestamp: 6,
    });

    const parts = store.getPartsForHandle(currentHandle);
    expect((parts[0] as any).metadata.toolSpecificData.childItems).toEqual([
      jasmine.objectContaining({ kind: 'thinking', content: 'Let me think' }),
      jasmine.objectContaining({ kind: 'text', content: 'Hello world' }),
    ]);
  });

  function processCurrent(event: RenderEvent): boolean {
    return adapter.process(event, currentHandle);
  }
});
