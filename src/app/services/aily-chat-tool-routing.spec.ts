import {
  findPreferredAilyChatTool,
  resolvePreferredAilyChatTool,
} from './aily-chat-tool-routing';
import {
  HOST_EXIT_REQUIRES_USER_REASON,
  mainMenuAutomationRejection,
} from './main-menu-automation-policy';

describe('resolvePreferredAilyChatTool', () => {
  it('selects the canonical Aily Chat when it is open', () => {
    expect(resolvePreferredAilyChatTool(['aily-chat', 'serial-monitor']))
      .toBe('aily-chat');
  });

  it('falls back to the canonical Aily Chat when no chat is open', () => {
    expect(resolvePreferredAilyChatTool(['serial-monitor']))
      .toBe('aily-chat');
  });

  it('reports no active chat when neither chat is open', () => {
    expect(findPreferredAilyChatTool(['serial-monitor'])).toBeNull();
  });

  it('reports the open chat for block-selection projection', () => {
    expect(findPreferredAilyChatTool(['serial-monitor', 'aily-chat']))
      .toBe('aily-chat');
  });
});

describe('Aily Chat host lifecycle boundary', () => {
  it('blocks in-process host exit with an explicit user-action contract', () => {
    const result = mainMenuAutomationRejection('app-exit', 'header/app-exit~12');

    expect(result).toEqual(jasmine.objectContaining({
      ok: false,
      action: 'app-exit',
      reason: HOST_EXIT_REQUIRES_USER_REASON,
      requiresUserAction: true,
      retryable: false,
    }));
    expect(result?.message).toContain('用户从主软件界面手动退出');
  });

  it('allows every non-exit menu action to continue through the real menu handler', () => {
    expect(mainMenuAutomationRejection('project-save', 'header/project-save~2')).toBeNull();
    expect(mainMenuAutomationRejection(undefined, 'header/item~0')).toBeNull();
  });
});
