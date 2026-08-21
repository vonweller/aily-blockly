import { isDetachedAilyChatRenderer } from './detached-aily-chat-auth';

describe('isDetachedAilyChatRenderer', () => {
  it('matches the canonical detached child-tool route', () => {
    expect(isDetachedAilyChatRenderer({
      pathname: '/',
      hash: '#/child-tool/aily-chat?standalone=true',
    })).toBeTrue();
  });

  it('matches the pre-normalized pooled-window hash with a double slash', () => {
    expect(isDetachedAilyChatRenderer({
      pathname: '/',
      hash: '#//child-tool/aily-chat',
    })).toBeTrue();
  });

  it('does not classify the embedded main window as detached', () => {
    expect(isDetachedAilyChatRenderer({
      pathname: '/',
      hash: '#/main/blockly-editor',
    })).toBeFalse();
  });

  it('does not match another child tool', () => {
    expect(isDetachedAilyChatRenderer({
      pathname: '/',
      hash: '#/child-tool/network-debugger?standalone=true',
    })).toBeFalse();
  });
});
