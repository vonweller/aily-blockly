import { evaluateNativeCandidate } from '../../../editors/blockly-editor/services/blockly-native-candidate';
import type { NativeCandidateRequest } from '../../../editors/blockly-editor/services/blockly-native-candidate-protocol';
import { modelSteps } from './abs-native-models.fixture';
import { normalizeAbsSerializedWorkspace } from './abs-serialized-workspace';
import { dhtModelFixture } from './abs-native-dht-model.fixture';
import { spiModelFixture } from './abs-native-spi-model.fixture';

describe('native initializer model preparation', () => {
  const request = (abs: string): NativeCandidateRequest => ({ blocks: [], abs: '# ABS Schema: 2\n' + abs, steps: structuredClone(modelSteps), modelRequestId: 'native-model-test-namespace' });
  const run = (value: NativeCandidateRequest) => evaluateNativeCandidate(value, { assertCurrent: () => {} });
  afterEach(() => expect(document.querySelectorAll('[data-blockly-native-candidate]').length).toBe(0));

  it('runs the installed DHT full generator and binds README syntax without manually creating DHT models', async () => {
    const value = request('dht_read_temperature($sensor)\ndht_init("sensor", DHT11, 2)');
    value.steps = [{ kind: 'context', mode: 'arduino', boardConfig: { digitalPins: [['D2', '2']], i2c: [['Wire', 'Wire']] } },
      { kind: 'script', label: 'actual-installed-DHT', source: 'window.ENTRY_BLOCK_TYPES = ["arduino_setup", "arduino_loop"];\n' + dhtModelFixture.source },
      { kind: 'definitions', definitions: dhtModelFixture.blocks }];
    const result = await run(value), effect = result.binding!.modelDeclarations![0];
    expect(effect.name).toBe('sensor'); expect(effect.type).toBe('DHT');
    const contracts = { fields: Object.fromEntries(result.binding!.instances.map(item => [item.id, item.shape.fields])) };
    await run({ blocks: [], steps: value.steps, verify: { state: normalizeAbsSerializedWorkspace(result.state), contracts,
      modelDeclarations: [{ ...effect, ownerId: result.binding!.instances.find(item => item.start === effect.start)!.id }] } });
  });

  for (const initializer of ['max31865_init("rtd", HW, 5, MAX31865_2WIRE)',
    'max31865_init("rtd", SW, 15, MAX31865_3WIRE, SW_SCK_PIN=18, SW_MOSI_PIN=23, SW_MISO_PIN=19)']) {
    it('prepares real MAX31865 README hardware/software SPI model and dynamic fields: ' + initializer, async () => {
      const value = request('max31865_read_rtd($rtd)\n' + initializer);
      const pins = ['5', '15', '18', '23', '19'].map(pin => [pin, pin]);
      value.steps = [{ kind: 'context', mode: 'arduino', boardConfig: { digitalPins: pins } },
        { kind: 'script', label: 'actual-SPI-generator', source: spiModelFixture.source },
        { kind: 'definitions', definitions: JSON.parse(JSON.stringify(spiModelFixture.blocks).replaceAll('"${board.digitalPins}"', JSON.stringify(pins))) }];
      const result = await run(value), effect = result.binding!.modelDeclarations![0];
      expect(effect.name).toBe('rtd'); expect(effect.type).toBe('Adafruit_MAX31865');
      const contracts = { fields: Object.fromEntries(result.binding!.instances.map(item => [item.id, item.shape.fields])) };
      const verify = { state: normalizeAbsSerializedWorkspace(result.state), contracts,
        modelDeclarations: [{ ...effect, ownerId: result.binding!.instances.find(item => item.start === effect.start)!.id }] };
      await run({ blocks: [], steps: value.steps, verify });
      value.steps.push({ kind: 'script', label: 'missing-final-registration', source: 'Arduino.forBlock.max31865_init = () => "";' });
      await expectAsync(run({ blocks: [], steps: value.steps, verify })).toBeRejectedWith(jasmine.objectContaining({ code: 'ABS_MODEL_DECLARATION_CHANGED' }));
    });
  }

  for (const abs of ['test_object_init("sensor", Sensor)\ntest_object_read($sensor)',
    'test_object_read($sensor)\ntest_object_init("sensor", Sensor)']) {
    it('binds a whole batch with no createVariables regardless of declaration order: ' + abs, async () => {
      const value = request(abs), result = await run(value);
      const effect = result.binding!.modelDeclarations![0];
      expect(effect).toEqual(jasmine.objectContaining({ name: 'sensor', type: 'Sensor', blockType: 'test_object_init' }));
      expect(result.state['variables']).toEqual([{ name: 'sensor', type: 'Sensor', id: effect.id }]);
      const reader = result.binding!.instances.find(item => item.type === 'test_object_read')!;
      expect(reader.seed.fields!['OBJECT']).toEqual({ id: effect.id });
      const replay = await run({ ...value, variables: result.state['variables'], identities: result.binding!.instances.map(item => ({ start: item.start, id: 'owned-' + item.start })), creations: [] });
      expect(replay.binding!.modelDeclarations).toEqual(result.binding!.modelDeclarations);
      const state = normalizeAbsSerializedWorkspace(replay.state);
      const contracts = { fields: Object.fromEntries(replay.binding!.instances.map(item => [item.id, item.shape.fields])) };
      await run({ blocks: [], steps: value.steps, verify: { state, contracts,
        modelDeclarations: [{ ...effect, ownerId: 'owned-' + effect.start }] } });
    });
  }
  it('does not guess models from missing references or disabled initializers', async () => {
    for (const abs of ['test_object_read($missing)', 'test_object_read($sensor)\ntest_object_init("sensor", Sensor) @disabled']) {
      await expectAsync(run(request(abs))).toBeRejectedWith(jasmine.objectContaining({ code: 'ABS_SYMBOL_MISSING' }));
    }
  });
  it('preserves supplied identities, rejects type/case conflicts and duplicate producers', async () => {
    const value = request('test_object_init("sensor", Sensor)\ntest_object_read($sensor)');
    value.variables = [{ id: 'existing', name: 'sensor', type: 'Sensor' }];
    expect((await run(value)).binding!.modelDeclarations![0].id).toBe('existing');
    value.variables[0].type = 'Other';
    await expectAsync(run(value)).toBeRejected();
    for (const abs of ['test_object_init("sensor", Sensor)\ntest_object_init("sensor", Sensor)',
      'test_object_init("sensor", Other)\ntest_object_read($sensor)']) await expectAsync(run(request(abs))).toBeRejected();
  });
  it('prepares multiple independent objects and rejects unowned generator side effects', async () => {
    const value = request('test_object_read($a)\ntest_object_read($b)\ntest_object_init("a", Sensor)\ntest_object_init("b", Sensor)');
    expect((await run(value)).binding!.modelDeclarations!.map(item => item.name)).toEqual(['a', 'b']);
    value.steps.push({ kind: 'script', label: 'unowned-side-effect', source: 'Arduino.forBlock.test_object_init = block => { block.workspace.createVariable("leaked", "Sensor"); return ""; };' });
    await expectAsync(run(value)).toBeRejectedWithError(/unrequested blocks or models/);
  });

  it('rejects registration/registry replacement and swallowed declaration conflicts', async () => {
    for (const source of [
      'Arduino.forBlock.test_object_init = () => { Arduino.forBlock.test_object_read = () => ["0", 0]; return ""; };',
      'Arduino.forBlock.test_object_init = () => { registerVariableToBlockly = () => {}; return ""; };',
      'Arduino.forBlock.test_object_init = block => { try { registerVariableToBlockly("bad", null); } catch {} return ""; };',
    ]) {
      const value = request('test_object_init("sensor", Sensor)');
      value.steps.push({ kind: 'script', label: 'unowned-registry-effect', source });
      await expectAsync(run(value)).toBeRejected();
    }
  });
});
