import { BlocklyGeneratorRuntimeService } from './blockly-generator-runtime.service';

describe('BlocklyGeneratorRuntimeService Python mode', () => {
  let service: BlocklyGeneratorRuntimeService;

  beforeEach(() => {
    service = new BlocklyGeneratorRuntimeService();
  });

  afterEach(() => {
    service.destroy();
  });

  it('activates the Python generator with canonical and compatibility globals', () => {
    const generator = service.activate({
      mode: 'python',
      getWorkspace: () => null,
    });
    const iframe = document.querySelector<HTMLIFrameElement>('iframe[data-blockly-generator-runtime]');
    const realm = iframe?.contentWindow as unknown as Record<string, unknown>;

    expect(generator.name_).toBe('MicroPython');
    expect(realm['Python']).toBe(generator);
    expect(realm['MPY']).toBe(generator);
    expect(realm['MicropPython']).toBe(generator);
    expect(realm['Arduino']).toBeUndefined();
  });
});
