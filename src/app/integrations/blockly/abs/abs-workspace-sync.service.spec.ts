import * as Blockly from 'blockly';
import 'blockly/blocks';
import '../../../editors/blockly-editor/components/blockly/plugins/block-plus-minus/src/index.js';
import { AbsWorkspaceSyncService } from './abs-workspace-sync.service';
import { AbsBaselineStore, AbsSyncStoragePort, AbsSyncStorageAccess } from './abs-baseline-store';
import { absJson, hashAbsText } from './abs-identity-map';
import { normalizeAbsSerializedWorkspace } from './abs-serialized-workspace';
import { composeBlocklyPage, replaceBlocklyPageWorkspace } from '../../../editors/blockly-editor/services/blockly-project-model';
import { BlocklyProjectRevision } from '../../../editors/blockly-editor/services/blockly-project-revision';
import { BlocklyWorkspaceEditGate } from '../../../editors/blockly-editor/services/blockly-workspace-edit-lease';
import { _ProjectService } from '../../../editors/blockly-editor/services/project.service';
import { createAilyProjectDataValue, materializeGenericProjectDataValues, projectDataRuntime } from '@domain/project/public-api';
import { SerialOperationQueue } from '@shared/public-api';
import { BlocklyDeclarativeBlockCatalog } from '../../../editors/blockly-editor/services/blockly-declarative-block-catalog';
import { AbsGenerationToolsService } from './abs-generation-tools.service';
import { BlocklyEditorAutomationAdapter } from '../blockly-editor-automation.adapter';
import { BlocklyGeneratorRuntimeService } from '../../../editors/blockly-editor/services/blockly-generator-runtime.service';
import { nativeReconciliationDefinition, nativeReconciliationSteps } from './abs-native-reconciliation.fixture';
import { nativeFieldOrder } from './abs-native-field-order';
import { withNativeStateLoading } from '../../../editors/blockly-editor/services/blockly-native-state-loading';
import { observeNativeBlockDefinition } from '../../../editors/blockly-editor/services/blockly-native-structure';
import { nativeDefaultSource } from './abs-native-defaults.fixture';
import { nativeDormantSource } from './abs-native-shadows.fixture';
import '../../../editors/blockly-editor/components/blockly/custom-field/field-u8g2-bitmap';

describe('v2 actual workspace generation coordinator', () => {
  let originalTimeout: number;
  beforeAll(() => {
    originalTimeout = jasmine.DEFAULT_TIMEOUT_INTERVAL;
    // One coordinator case may validate, apply, reshape and reopen through
    // several isolated candidates. Keep each product deadline unchanged.
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 20000;
  });
  afterAll(() => { jasmine.DEFAULT_TIMEOUT_INTERVAL = originalTimeout; });
  let service: AbsWorkspaceSyncService, project: _ProjectService, editor: any;
  let disk: Map<string, string>, values: Map<string, any>;
  let port: AbsSyncStoragePort, gate: BlocklyWorkspaceEditGate;
  let catalog: BlocklyDeclarativeBlockCatalog;
  let failWrite: string | undefined, loseCommitReply: boolean, held: boolean;
  let oldBlockly: unknown, oldFs: unknown, container: HTMLDivElement | undefined;
  const registeredTypes: string[] = [];
  const declare = (definition: any) => {
    Blockly.defineBlocksWithJsonArray([definition]); catalog.record(definition, Blockly.Blocks[definition.type]);
    registeredTypes.push(definition.type);
  };
  const scope = { projectKey: 'D:/project', pageId: 'main' };
  const nativeState = () => normalizeAbsSerializedWorkspace(Blockly.serialization.workspaces.save(editor.workspace));
  const seed = () => ({ blocks: { languageVersion: 0, blocks: [{ type: 'abs_sync_root', id: 'protected', x: 30, y: 60,
    deletable: false, movable: false, data: 'opaque', fields: { TEXT: 'before' }, inputs: { VALUE: {
      shadow: { type: 'math_number', id: 'dormant', fields: { NUM: 2 } },
      block: { type: 'math_number', id: 'child', fields: { NUM: 1 } },
    } } }] } });
  const baseline = async () => {
    expect((await service.exportGeneration()).publication.status).toBe('COMMITTED');
    return { source: disk.get('project.abs')!, generation: JSON.parse(disk.get('project.abs.map.json')!).generation };
  };
  const apply = (base: Awaited<ReturnType<typeof baseline>>, options = {}) => service.applyGeneration(
    base.source.replace('TEXT="before"', 'TEXT="after"'), base.generation, options);
  const roots = () => editor.workspace.getBlockById('protected');
  const renderWorkspace = () => {
    editor.workspace.dispose(); container = document.createElement('div'); container.style.cssText = 'width:600px;height:400px';
    document.body.appendChild(container); editor.workspace = Blockly.inject(container, {});
    Blockly.serialization.workspaces.load(seed(), editor.workspace);
  };

  beforeEach(() => {
    oldBlockly = window['Blockly']; oldFs = window['fs']; window['Blockly'] = Blockly;
    Blockly.Blocks['abs_sync_root'] = { init() {
      this.appendDummyInput().appendField(new Blockly.FieldTextInput(''), 'TEXT');
      this.appendValueInput('VALUE').setCheck('Number');
    } };
    disk = new Map(); values = new Map(); failWrite = undefined; loseCommitReply = false; held = false;
    const read = async key => disk.get(key) ?? null;
    const access: AbsSyncStorageAccess = {
      read, replace: async (key, expected, content) => {
        expect(held).toBeTrue();
        if (key === failWrite) throw new Error('injected write failure');
        const before = await read(key);
        if ((before === null ? null : await hashAbsText(before)) !== expected) return false;
        if (content === null) disk.delete(key); else disk.set(key, content);
        return true;
      },
    };
    const locks = new SerialOperationQueue();
    port = { read, withLock: operation => locks.run(async () => {
      held = true;
      try {
        const result = await operation(access);
        if (loseCommitReply && disk.has('project.abi')) throw new Error('lost commit acknowledgement');
        return result;
      } finally { held = false; }
    }) };
    window['fs'] = { projectSyncStorageVersion: 2, openProjectSyncStorage: async (_path, assertCurrent) => {
      assertCurrent();
      return { read: port.read, withLock: operation => port.withLock(locked => new Promise((resolve, reject) => {
        operation(locked, result => result.ok ? resolve(result.value) : reject(Object.assign(new Error(result.error.message), { code: result.error.code })));
      })) };
    } };
    gate = new BlocklyWorkspaceEditGate(); const queue = new SerialOperationQueue(); const revisions = new BlocklyProjectRevision();
    let document: any = { schemaVersion: 3, activePageId: 'main', openedPageIds: ['main'],
      pages: [{ id: 'main', title: 'Main', content: { blocks: { blocks: [] } } },
        { id: 'other', title: 'Other', content: { blocks: { blocks: [] } }, custom: { preserved: true } }],
      sharedModel: { procedureBlocks: [] }, metadata: 'retained' };
    editor = {
      blockTypeToLibMap: new Map(),
      captureDeclarativeBlockDefinitions: () => catalog.capture(Blockly.Blocks),
      workspace: new Blockly.Workspace(),
      getActivePageId: () => document.activePageId,
      runProjectOperation: operation => queue.run(() => { gate.assertAvailable(); return operation(); }),
      acquireWorkspaceEditLease: () => gate.acquire(),
      assertWorkspaceEditAvailable: owner => gate.assertAvailable(owner),
      captureProjectSnapshot: owner => {
        gate.assertAvailable(owner);
        const current = replaceBlocklyPageWorkspace(document, document.activePageId, nativeState(), () => undefined);
        return { document: current, revision: revisions.observe(current) };
      },
      getProjectAbiForSave: snapshot => snapshot,
      mutateOtherPage: () => { document.pages[1].custom.preserved = false; },
      switchPage: id => {
        document = replaceBlocklyPageWorkspace(document, document.activePageId, nativeState(), () => undefined);
        document.activePageId = id;
        Blockly.serialization.workspaces.load(composeBlocklyPage(document, id), editor.workspace);
      },
      assertWorkspaceSharedChange: jasmine.createSpy('shared'),
      restoreProjectWorkspaceSnapshot: jasmine.createSpy('restore').and.callFake((snapshot, owner) => {
        gate.assertAvailable(owner); document = JSON.parse(absJson(snapshot));
        const state = composeBlocklyPage(document, document.activePageId);
        const definitions = editor.captureDeclarativeBlockDefinitions();
        withNativeStateLoading(Blockly, editor.workspace, state,
          () => Blockly.serialization.workspaces.load(state, editor.workspace), block => nativeFieldOrder(block, definitions));
      }),
      prepareProjectCode: jasmine.createSpy('prepareCode').and.resolveTo(null),
      markWorkspaceCodeDirty: jasmine.createSpy('dirty'),
      publishAbsContext: jasmine.createSpy('publishAbsContext'),
    };
    Blockly.serialization.workspaces.load(seed(), editor.workspace);
    project = new _ProjectService(editor, {} as any, {} as any); project.currentProjectPath = scope.projectKey;
    spyOn(project, 'publishPreparedSaveOutputs').and.resolveTo();
    spyOn(projectDataRuntime, 'flushPending').and.resolveTo();
    spyOn(projectDataRuntime, 'prepareValue').and.resolveTo();
    spyOn(projectDataRuntime, 'getStore').and.returnValue({ collectReferences: () => [], validateReferences: async () => ({ valid: true, issues: [] }) } as any);
    spyOn(projectDataRuntime, 'put').and.callFake(async request => {
      const id = await hashAbsText(request.codec + ':' + absJson(request.value));
      const size = new TextEncoder().encode(typeof request.value === 'string' ? request.value : absJson(request.value)).length;
      const ref: any = { $ailyData: { schemaVersion: 1, id, codec: request.codec, logicalType: request.codec === 'utf8-v1' ? 'text' : 'json',
        storage: 'raw-v1', rawLength: size, storedLength: size } };
      values.set(id, request.value); return ref;
    });
    spyOn(projectDataRuntime, 'resolve').and.callFake(async ref => {
      if (!values.has(ref.$ailyData.id)) throw new Error('missing resource');
      return values.get(ref.$ailyData.id);
    });
    service = new AbsWorkspaceSyncService(editor, project);
    catalog = new BlocklyDeclarativeBlockCatalog();
    const definition = { type: 'abs_declared_text', message0: '%1 %2', args0: [
      { type: 'field_input', name: 'TEXT', text: 'default' }, { type: 'field_checkbox', name: 'FLAG', checked: true },
    ], output: 'String' };
    declare(definition);
  });
  afterEach(() => {
    editor.workspace.dispose(); container?.remove(); container = undefined;
    delete Blockly.Blocks['abs_sync_root']; window['Blockly'] = oldBlockly; window['fs'] = oldFs;
    for (const type of registeredTypes.splice(0)) delete Blockly.Blocks[type];
    if (Blockly.Extensions.isRegistered('native_commit_extension')) Blockly.Extensions.unregister('native_commit_extension');
  });

  const enableNative = () => {
    Blockly.Extensions.register('native_commit_extension', function() {
      this.getField('MODE').setValidator(mode => {
        if (this.getInput('DETAIL')) this.removeInput('DETAIL');
        if (mode === 'B') this.appendDummyInput('DETAIL').appendField(new Blockly.FieldTextInput('default'), 'DETAIL');
        return mode;
      });
      this.data = 'native:' + this.id;
    });
    declare(nativeReconciliationDefinition);
    const replay = { steps: structuredClone(nativeReconciliationSteps), assertCurrent: jasmine.createSpy('nativeCurrent') };
    editor.captureNativeReplay = jasmine.createSpy('captureNativeReplay').and.returnValue(replay);
    return replay;
  };

  const enableDefaults = (extra = '') => {
    const replay = enableNative(), source = nativeDefaultSource + extra;
    new Function('Blockly', 'Arduino', source)(Blockly, { forBlock: {} });
    for (const type of ['native_default_owner', 'native_default_leaf']) {
      registeredTypes.push(type); observeNativeBlockDefinition(Blockly.Blocks[type]);
    }
    replay.steps.push({ kind: 'script', label: 'owned-default', source });
  };

  for (const { rendered, chunk } of [{ rendered: false, chunk: false }, { rendered: true, chunk: false }, { rendered: true, chunk: true }]) it(`replaces owned default children through validate/apply/edit/disconnect/reopen (${rendered ? 'rendered' : 'headless'}, chunk=${chunk})`, async () => {
    enableDefaults();
    if (rendered) renderWorkspace();
    const base = await baseline(), before = absJson(nativeState()), files = [...disk];
    const source = base.source + '\nnative_default_owner(B, math_number(7))\n';
    const committed = (await new AbsBaselineStore(port, scope).loadCommitted())!;
    const { generationEvidence } = await import('./abs-generation-protocol');
    const request = { version: 2 as const, requestId: crypto.randomUUID(), base: (await generationEvidence(committed, null)).binding,
      candidate: { hash: await hashAbsText(source), bytes: new TextEncoder().encode(source).byteLength } };
    const validation = await service.validateGeneration(source, request);
    expect(absJson(nativeState())).toBe(before); expect([...disk]).toEqual(files);
    expect((await service.applyGeneration(source, base.generation, { chunk }, validation)).publication.status).toBe('COMMITTED');
    const owner = editor.workspace.getBlocksByType('native_default_owner', false)[0], id = owner.id;
    const childId = owner.getInputTargetBlock('VALUE').id;
    expect(owner.getInputTargetBlock('VALUE').getFieldValue('NUM')).toBe(7);
    expect(editor.workspace.getBlocksByType('native_default_leaf', false).length).toBe(0);
    const edit = disk.get('project.abs')!.replace(/native_default_owner\(B, math_number\((?:NUM=)?7\)\)/, 'native_default_owner(B, math_number(9))');
    expect(edit).not.toBe(disk.get('project.abs'));
    expect((await service.applyGeneration(edit, JSON.parse(disk.get('project.abs.map.json')!).generation, { chunk })).publication.status).toBe('COMMITTED');
    expect(editor.workspace.getBlockById(childId).getFieldValue('NUM')).toBe(9);
    const empty = disk.get('project.abs')!.replace(/native_default_owner\(B, math_number\((?:NUM=)?9\)\)/, 'native_default_owner(B, null)');
    expect((await service.applyGeneration(empty, JSON.parse(disk.get('project.abs.map.json')!).generation, { chunk })).publication.status).toBe('COMMITTED');
    const saved = disk.get('project.abi')!;
    editor.restoreProjectWorkspaceSnapshot(JSON.parse(saved));
    expect(editor.workspace.getBlockById(id).getInputTargetBlock('VALUE')).toBeNull();
    expect(editor.workspace.getBlocksByType('native_default_leaf', false).length).toBe(0);
    expect(editor.workspace.getBlockById(childId)).toBeNull();
    expect(roots().isDeletable()).toBeFalse(); expect(disk.get('project.abi')).toBe(saved);
  });

  for (const shadow of [false, true]) it(`adopts new omitted defaults, publishes normal ABS, edits and reopens stable IDs (shadow=${shadow})`, async () => {
    enableDefaults(shadow ? `
      Blockly.Blocks.native_default_owner.makeDefault = function() {
        this.getInput('VALUE').connection.setShadowState({ type: 'math_number', fields: { NUM: 5 } });
      };` : '');
    renderWorkspace();
    const base = await baseline();
    expect((await service.applyGeneration(base.source + '\nnative_default_owner(A)\n', base.generation, { chunk: true })).publication.status).toBe('COMMITTED');
    const owner = editor.workspace.getBlocksByType('native_default_owner', false)[0], ownerId = owner.id;
    const child = shadow ? owner.getInputTargetBlock('VALUE') : owner.getInputTargetBlock('VALUE').getInputTargetBlock('CHILD');
    const childId = child.id;
    expect(child.getFieldValue('NUM')).toBe(5); expect(child.isShadow()).toBe(shadow);
    const published = disk.get('project.abs')!;
    expect(published).toContain('math_number'); expect(published).not.toContain(childId);
    const edited = published.replace(/math_number\((?:NUM=)?5\)/, 'math_number(8)');
    expect(edited).not.toBe(published);
    expect((await service.applyGeneration(edited, JSON.parse(disk.get('project.abs.map.json')!).generation, { chunk: false })).publication.status).toBe('COMMITTED');
    expect(editor.workspace.getBlockById(childId).getFieldValue('NUM')).toBe(8);
    const saved = disk.get('project.abi')!;
    editor.restoreProjectWorkspaceSnapshot(JSON.parse(saved));
    expect(editor.workspace.getBlockById(childId).getFieldValue('NUM')).toBe(8);
    expect(editor.workspace.getBlockById(childId).isShadow()).toBe(shadow);
    expect(editor.workspace.getBlockById(ownerId)).not.toBeNull(); expect(roots().isDeletable()).toBeFalse();
    if (!shadow) {
      const latest = disk.get('project.abs')!;
      const empty = latest.replace(/native_default_owner\(A, native_default_leaf\(math_number\((?:NUM=)?8\)\)\)/, 'native_default_owner(A)');
      expect(empty).not.toBe(latest);
      expect((await service.applyGeneration(empty, JSON.parse(disk.get('project.abs.map.json')!).generation)).publication.status).toBe('COMMITTED');
      expect(editor.workspace.getBlockById(ownerId).getInputTargetBlock('VALUE')).toBeNull();
      expect(editor.workspace.getBlockById(childId)).toBeNull();
    }
  });

  it('persists a covered default shadow and respawns its original identity after save/reopen', async () => {
    enableDefaults(`Blockly.Blocks.native_default_owner.makeDefault = function() {
      this.getInput('VALUE').connection.setShadowState({ type: 'math_number', fields: { NUM: 13 } });
    };`);
    renderWorkspace();
    const base = await baseline();
    expect((await service.applyGeneration(base.source + '\nnative_default_owner(A, math_number(7))\n', base.generation)).publication.status).toBe('COMMITTED');
    const owner = editor.workspace.getBlocksByType('native_default_owner', false)[0], ownerId = owner.id;
    const fallbackId = owner.getInput('VALUE').connection.getShadowState().id;
    expect(fallbackId).toBeTruthy();
    editor.restoreProjectWorkspaceSnapshot(JSON.parse(disk.get('project.abi')!));
    const reopened = editor.workspace.getBlockById(ownerId);
    reopened.getInputTargetBlock('VALUE').dispose(false);
    const fallback = reopened.getInputTargetBlock('VALUE');
    expect(fallback.id).toBe(fallbackId); expect(fallback.isShadow()).toBeTrue(); expect(fallback.getFieldValue('NUM')).toBe(13);
    expect(roots().isDeletable()).toBeFalse();
  });

  it('externalizes large data in an adopted default through the existing Project Data pipeline', async () => {
    enableDefaults(`const init = Blockly.Blocks.native_default_leaf.init;
      Blockly.Blocks.native_default_leaf.init = function() {
        init.call(this); this.appendDummyInput().appendField(new Blockly.FieldTextInput('x'.repeat(40000)), 'TEXT');
        this.payload = { numbers: Array(12000).fill(42) };
        this.saveExtraState = () => this.payload;
        this.loadExtraState = state => { this.payload = state; };
      };`);
    const base = await baseline();
    expect((await service.applyGeneration(base.source + '\nnative_default_owner(A)\n', base.generation)).publication.status).toBe('COMMITTED');
    const leaf = editor.workspace.getBlocksByType('native_default_leaf', false)[0], id = leaf.id;
    expect(leaf.getFieldValue('TEXT')).toBe('x'.repeat(40000));
    expect(leaf.saveExtraState().numbers.length).toBe(12000);
    expect(values.size).toBe(2);
    expect(disk.get('project.abs')).not.toContain('x'.repeat(100));
    expect(disk.get('project.abi')).not.toContain('x'.repeat(100));
    const source = disk.get('project.abs')!.replace(/math_number\((?:NUM=)?5\)/, 'math_number(9)');
    expect((await service.applyGeneration(source, JSON.parse(disk.get('project.abs.map.json')!).generation)).publication.status).toBe('COMMITTED');
    expect(editor.workspace.getBlockById(id).getFieldValue('TEXT')).toBe('x'.repeat(40000));
    expect(editor.workspace.getBlockById(id).saveExtraState().numbers).toEqual(Array(12000).fill(42));
  });

  for (const chunk of [false, true]) it(`validates, commits, edits and reopens nested dormant shadows without exposing hidden data in ABS (chunk=${chunk})`, async () => {
    enableDefaults(nativeDormantSource + `
      const init = Blockly.Blocks.native_default_leaf.init;
      Blockly.Blocks.native_default_leaf.init = function() { init.call(this);
        this.payload = { text: 'h'.repeat(40000), numbers: Array(12000).fill(42) };
        this.saveExtraState = () => this.isShadow() ? this.payload : null;
        this.loadExtraState = state => { if(state) this.payload = state; };
      };
    `);
    renderWorkspace();
    const base = await baseline(), before = absJson(nativeState()), files = [...disk];
    const source = base.source + '\nnative_default_owner(A)\n';
    const committed = (await new AbsBaselineStore(port, scope).loadCommitted())!;
    const { generationEvidence } = await import('./abs-generation-protocol');
    const request = { version: 2 as const, requestId: crypto.randomUUID(), base: (await generationEvidence(committed, null)).binding,
      candidate: { hash: await hashAbsText(source), bytes: new TextEncoder().encode(source).byteLength } };
    const validation = await service.validateGeneration(source, request);
    expect(absJson(nativeState())).toBe(before); expect([...disk]).toEqual(files);
    expect((await service.applyGeneration(source, base.generation, { chunk }, validation)).publication.status).toBe('COMMITTED');
    const owner = editor.workspace.getBlocksByType('native_default_owner', false)[0], ownerId = owner.id;
    const fallback = owner.getInput('VALUE').connection.getShadowState(), fallbackId = fallback.id;
    const real = owner.getInputTargetBlock('VALUE'), realId = real.id;
    const nestedFallbackId = real.getInput('CHILD').connection.getShadowState().id;
    expect(fallback.extraState.text.length).toBe(40000); expect(values.size).toBe(1);
    expect(disk.get('project.abs')).not.toContain('h'.repeat(100));
    expect(disk.get('project.abs')).not.toContain('$ailyProjectDataValue');
    expect(disk.get('project.abi')).toContain('$ailyProjectDataValue');
    const edited = disk.get('project.abs')!.replace(/math_number\((?:NUM=)?5\)/, 'math_number(7)');
    expect(edited).not.toBe(disk.get('project.abs'));
    expect((await service.applyGeneration(edited, JSON.parse(disk.get('project.abs.map.json')!).generation, { chunk })).publication.status).toBe('COMMITTED');
    // The normal open pipeline materializes payloads before the synchronous loader.
    editor.restoreProjectWorkspaceSnapshot(await materializeGenericProjectDataValues(JSON.parse(disk.get('project.abi')!), {
      resolve: ref => projectDataRuntime.resolve(ref),
    }));
    const loadedOwner = editor.workspace.getBlockById(ownerId), loadedReal = editor.workspace.getBlockById(realId);
    loadedReal.getInputTargetBlock('CHILD').dispose(false);
    expect(loadedReal.getInputTargetBlock('CHILD').id).toBe(nestedFallbackId);
    expect(loadedReal.getInputTargetBlock('CHILD').getFieldValue('NUM')).toBe(11);
    loadedReal.dispose(false);
    const visibleFallback = loadedOwner.getInputTargetBlock('VALUE');
    expect(visibleFallback.id).toBe(fallbackId); expect(visibleFallback.isShadow()).toBeTrue();
    expect(visibleFallback.getInputTargetBlock('CHILD').getFieldValue('NUM')).toBe(13);
    expect(visibleFallback.saveExtraState()).toEqual({ text: 'h'.repeat(40000), numbers: Array(12000).fill(42) });
    expect(roots().isDeletable()).toBeFalse();
  });

  it('creates a JS-only dynamic block, commits canonical ABI, and reopens without prior instance evidence', async () => {
    const replay = enableNative();
    const source = `Blockly.Blocks.native_js_reopen = { init() {
      this.appendDummyInput('mode').appendField(new Blockly.FieldDropdown([['A', 'A'], ['B', 'B']], mode => {
        if (this.getInput('detail')) this.removeInput('detail');
        if (mode === 'B') this.appendDummyInput('detail').appendField(new Blockly.FieldTextInput('default'), 'A_DETAIL');
        return mode;
      }), 'Z_MODE');
    } };
    Arduino.forBlock.native_js_reopen = block => '// ' + block.getFieldValue('A_DETAIL') + '\\n';`;
    const register = () => {
      new Function('Blockly', 'Arduino', source)(Blockly, { forBlock: {} });
      observeNativeBlockDefinition(Blockly.Blocks['native_js_reopen']);
    };
    register(); registeredTypes.push('native_js_reopen');
    replay.steps.push({ kind: 'script', label: 'js-only-reopen', source });
    const base = await baseline(), before = absJson(nativeState());
    const candidate = base.source + '\nnative_js_reopen(B, "preserved")\n';
    const committed = (await new AbsBaselineStore(port, scope).loadCommitted())!;
    const { generationEvidence } = await import('./abs-generation-protocol');
    const request = { version: 2 as const, requestId: crypto.randomUUID(), base: (await generationEvidence(committed, null)).binding,
      candidate: { hash: await hashAbsText(candidate), bytes: new TextEncoder().encode(candidate).byteLength } };
    await service.validateGeneration(candidate, request);
    expect(absJson(nativeState())).toBe(before);
    expect((await service.applyGeneration(candidate, base.generation)).publication.status).toBe('COMMITTED');
    const added = editor.workspace.getBlocksByType('native_js_reopen', false)[0], id = added.id;
    expect(added.getFieldValue('A_DETAIL')).toBe('preserved');
    const saved = disk.get('project.abi')!;
    editor.workspace.clear(); catalog.clear(); register();
    expect(catalog.capture(Blockly.Blocks).get('native_js_reopen')).toBeUndefined();
    editor.restoreProjectWorkspaceSnapshot(JSON.parse(saved));
    expect(editor.workspace.getBlockById(id).getFieldValue('A_DETAIL')).toBe('preserved');
    expect(roots().isDeletable()).toBeFalse();
    expect(disk.get('project.abi')).toBe(saved);
  });

  it('creates and reshapes an unknown native extension through the unique validate/apply transaction', async () => {
    enableNative();
    const base = await baseline(), before = absJson(nativeState()), diskBefore = [...disk];
    let source = base.source + '\nnative_commit_shape(B, math_number(7), "detail")\n';
    const evidence = (await new AbsBaselineStore(port, scope).loadCommitted())!;
    const { generationEvidence } = await import('./abs-generation-protocol');
    const request = { version: 2 as const, requestId: crypto.randomUUID(), base: (await generationEvidence(evidence, null)).binding,
      candidate: { hash: await hashAbsText(source), bytes: new TextEncoder().encode(source).byteLength } };
    const validated = await service.validateGeneration(source, request);
    expect(absJson(nativeState())).toBe(before); expect([...disk]).toEqual(diskBefore);
    expect(editor.prepareProjectCode).not.toHaveBeenCalled();
    expect((await service.applyGeneration(source, base.generation, {}, validated)).publication.status).toBe('COMMITTED');
    const added = editor.workspace.getBlocksByType('native_commit_shape', false)[0];
    const id = added.id;
    expect(id).not.toContain('abs-candidate-'); expect(added.data).toBe('native:' + id);
    expect(added.getFieldValue('DETAIL')).toBe('detail');
    expect(roots().id).toBe('protected'); expect(roots().isDeletable()).toBeFalse();
    expect(roots().isMovable()).toBeFalse(); expect(roots().data).toBe('opaque');
    expect(nativeState().blocks.blocks[0].inputs!['VALUE'].shadow!.id).toBe('dormant');
    expect(editor.prepareProjectCode).toHaveBeenCalledTimes(1);
    source = disk.get('project.abs')!.replace(/native_commit_shape\(B, math_number\((?:NUM=)?7\), "detail"\)/, 'native_commit_shape(A, math_number(8))');
    expect(source).not.toBe(disk.get('project.abs')!);
    const generation = JSON.parse(disk.get('project.abs.map.json')!).generation;
    expect((await service.applyGeneration(source, generation)).publication.status).toBe('COMMITTED');
    const changed = editor.workspace.getBlockById(id);
    expect(changed.getField('DETAIL')).toBeNull(); expect(changed.data).toBe('native:' + id);
    expect(changed.getInputTargetBlock('VALUE').getFieldValue('NUM')).toBe(8);
    const persisted = disk.get('project.abi')!;
    editor.restoreProjectWorkspaceSnapshot(JSON.parse(persisted));
    expect(editor.workspace.getBlockById(id).getFieldValue('MODE')).toBe('A');
    expect(roots().isDeletable()).toBeFalse();
  });

  for (const effect of [
    `block.workspace.createVariable('unrequested');`,
    `try { setTimeout(() => {}, 1); } catch {}`,
    `block.setFieldValue('A', 'MODE');`,
    `throw Error('generator failed');`,
  ]) it(`rejects native generator effects before host mutation: ${effect}`, async () => {
    const replay = enableNative();
    replay.steps.push({ kind: 'script', label: 'generator-effect', source:
      `Arduino.forBlock.native_commit_shape = block => { ${effect} return ''; };` });
    const base = await baseline(), before = absJson(nativeState()), originalDisk = [...disk];
    const source = base.source + '\nnative_commit_shape(B, math_number(7), "detail")\n';
    await expectAsync(service.applyGeneration(source, base.generation)).toBeRejected();
    expect(absJson(nativeState())).toBe(before); expect([...disk]).toEqual(originalDisk);
    expect(editor.restoreProjectWorkspaceSnapshot).not.toHaveBeenCalled();
    expect(editor.prepareProjectCode).not.toHaveBeenCalled();
  });

  it('rejects a replay becoming stale and a disk CAS conflict during native preparation', async () => {
    const replay = enableNative();
    const base = await baseline(), before = absJson(nativeState());
    const source = base.source + '\nnative_commit_shape(B, math_number(7), "detail")\n';
    let calls = 0;
    replay.assertCurrent.and.callFake(() => { if (++calls > 8) throw Error('stale native replay'); });
    await expectAsync(service.applyGeneration(source, base.generation)).toBeRejectedWithError(/stale native replay/);
    expect(absJson(nativeState())).toBe(before);
    replay.assertCurrent.and.callFake(() => { disk.set('project.abs', 'external edit'); });
    await expectAsync(service.applyGeneration(source, base.generation)).toBeRejected();
    expect(disk.get('project.abs')).toBe('external edit'); expect(absJson(nativeState())).toBe(before);
    expect(editor.prepareProjectCode).not.toHaveBeenCalled();
  });

  it('retains disabled reasons and rejects protected deletion before native execution', async () => {
    enableNative();
    roots().setDisabledReason(true, 'HOST_POLICY');
    const base = await baseline();
    expect(base.source).toContain('@disabled');
    const source = base.source + '\nnative_commit_shape(A, math_number(7))\n';
    expect((await service.applyGeneration(source, base.generation)).publication.status).toBe('COMMITTED');
    expect([...roots().getDisabledReasons()]).toEqual(['HOST_POLICY']);
    const generation = JSON.parse(disk.get('project.abs.map.json')!).generation;
    const oldState = absJson(nativeState()), oldDisk = [...disk];
    editor.captureNativeReplay.calls.reset();
    await expectAsync(service.applyGeneration('# ABS Schema: 2\n', generation)).toBeRejected();
    expect(editor.captureNativeReplay).not.toHaveBeenCalled();
    expect(absJson(nativeState())).toBe(oldState); expect([...disk]).toEqual(oldDisk);
  });

  it('reshapes a protected native instance without replacing its metadata, child or dormant shadow', async () => {
    enableNative();
    const block = editor.workspace.newBlock('native_commit_shape', 'native-protected');
    block.setFieldValue('B', 'MODE'); block.setFieldValue('old', 'DETAIL');
    block.setDeletable(false); block.setMovable(false); block.data = 'user-owned metadata';
    const child = editor.workspace.newBlock('math_number', 'native-value'); child.setFieldValue(9, 'NUM');
    block.getInput('VALUE').connection.connect(child.outputConnection);
    block.getInput('VALUE').connection.setShadowState({ type: 'math_number', id: 'native-shadow', fields: { NUM: 4 } });
    const base = await baseline();
    const source = base.source.replace(/native_commit_shape\(B, math_number\((?:NUM=)?9\), "old"\)/, 'native_commit_shape(A, math_number(9))');
    expect(source).not.toBe(base.source);
    expect((await service.applyGeneration(source, base.generation)).publication.status).toBe('COMMITTED');
    const changed = editor.workspace.getBlockById('native-protected');
    expect(changed.isDeletable()).toBeFalse(); expect(changed.isMovable()).toBeFalse();
    expect(changed.data).toBe('user-owned metadata'); expect(changed.getField('DETAIL')).toBeNull();
    expect(changed.getInputTargetBlock('VALUE').id).toBe('native-value');
    expect(changed.getInput('VALUE').connection.getShadowState()).toEqual({ type: 'math_number', id: 'native-shadow', fields: { NUM: 4 } });
  });

  it('does not promote one prepared native instance to all configurations of the same type', async () => {
    enableNative();
    const base = await baseline();
    const source = base.source + '\nnative_commit_shape(A, math_number(1))\nnative_commit_shape(B, math_number(2), "only B")\n';
    expect((await service.applyGeneration(source, base.generation)).publication.status).toBe('COMMITTED');
    const variants = editor.workspace.getBlocksByType('native_commit_shape', false);
    expect(variants.length).toBe(2);
    expect(variants.find(block => block.getFieldValue('MODE') === 'A').getField('DETAIL')).toBeNull();
    expect(variants.find(block => block.getFieldValue('MODE') === 'B').getFieldValue('DETAIL')).toBe('only B');
    expect(new Set(variants.map(block => block.id)).size).toBe(2);
    expect(variants.every(block => block.data === 'native:' + block.id)).toBeTrue();
  });

  const enableNativeVariables = () => {
    const replay = enableNative();
    const variable = { type: 'variables_get', message0: '%1', args0: [{ type: 'field_variable', name: 'VAR', variable: 'unused-default' }], output: null };
    replay.steps.push({ kind: 'definitions', definitions: [variable] });
    replay.steps.push({ kind: 'script', label: 'variable-generator', source: `
      Arduino.forBlock.variables_get = block => [block.getField('VAR').getVariable().name, 0];
    ` });
    return replay;
  };

  const enableNativeProcedures = () => {
    const replay = enableNativeVariables();
    replay.steps.push({ kind: 'script', label: 'procedure-generators', source: `
      Arduino.forBlock.procedures_defnoreturn = block => {
        Arduino.addFunction(block.getFieldValue('NAME'), 'void ' + block.getFieldValue('NAME') + '() {\\n' + Arduino.statementToCode(block, 'STACK') + '}');
        return '';
      };
      Arduino.forBlock.procedures_defreturn = block => {
        Arduino.addFunction(block.getFieldValue('NAME'), 'int ' + block.getFieldValue('NAME') + '() { return ' + Arduino.valueToCode(block, 'RETURN', 0) + '; }');
        return '';
      };
      // Actual older library handlers use INPUT<n>; the shared adapter must also
      // run in the independent candidate, without changing its ARG<n> blocks.
      Arduino.forBlock.procedures_callnoreturn = block => block.getProcedureCall() + '(' + (block.arguments_ || []).map((_, index) => Arduino.valueToCode(block, 'INPUT' + index, 0)).join(',') + ');\\n';
      Arduino.forBlock.procedures_callreturn = block => [block.getProcedureCall() + '()', 0];
    ` });
    return replay;
  };

  it('prepares procedure parameter identities alongside unknown native blocks, then edits and reopens without new models', async () => {
    enableNativeProcedures(); editor.workspace.createVariable('amount', '', 'amount-id');
    const base = await baseline(), before = absJson(nativeState()), files = [...disk];
    const source = base.source + '\nprocedures_defnoreturn(NAME="work") @extra:{"params":[{"name":"amount"}]}\n'
      + '    @STACK:\n        native_commit_shape(B, $amount, "inside")\n'
      + 'procedures_callnoreturn() @extra:{"name":"work","params":["amount"]}\n    @ARG0:\n        math_number(5)\n';
    const committed = (await new AbsBaselineStore(port, scope).loadCommitted())!;
    const { generationEvidence } = await import('./abs-generation-protocol');
    const request = { version: 2 as const, requestId: crypto.randomUUID(), base: (await generationEvidence(committed, null)).binding,
      candidate: { hash: await hashAbsText(source), bytes: new TextEncoder().encode(source).byteLength } };
    const validation = await service.validateGeneration(source, request);
    expect(absJson(nativeState())).toBe(before); expect([...disk]).toEqual(files);
    await service.applyGeneration(source, base.generation, {}, validation);
    const definition = editor.workspace.getBlocksByType('procedures_defnoreturn', false)[0];
    const state = nativeState(), parameter = definition.saveExtraState().params[0];
    expect(state.blocks.blocks[0].id).toBe(definition.id); // Same shared-first order as project save/reopen.
    expect(parameter).toEqual({ name: 'amount', id: 'amount-id', argId: 'abs_arg_0' });
    expect(definition.getInputTargetBlock('STACK').getInputTargetBlock('VALUE').getFieldValue('VAR')).toBe('amount-id');
    expect(state['variables']).toEqual([{ name: 'amount', id: 'amount-id' }]);
    const ids = editor.workspace.getAllBlocks(false).map(block => block.id).sort();
    const next = disk.get('project.abs')!.replace('"inside"', '"edited"');
    await service.applyGeneration(next, JSON.parse(disk.get('project.abs.map.json')!).generation);
    expect(editor.workspace.getAllBlocks(false).map(block => block.id).sort()).toEqual(ids);
    expect(editor.workspace.getBlockById(definition.id).saveExtraState().params[0]).toEqual(parameter);
    editor.restoreProjectWorkspaceSnapshot(JSON.parse(disk.get('project.abi')!));
    expect(nativeState()['variables']).toEqual(state['variables']);
    expect(editor.workspace.getBlockById(definition.id).getInputTargetBlock('STACK').getFieldValue('DETAIL')).toBe('edited');
    const withoutParam = base.source + '\nprocedures_defnoreturn(NAME="work") @extra:{"params":[]}\n'
      + '    @STACK:\n        native_commit_shape(B, $amount, "edited")\nprocedures_callnoreturn() @extra:{"name":"work"}\n';
    await service.applyGeneration(withoutParam, JSON.parse(disk.get('project.abs.map.json')!).generation);
    expect(editor.workspace.getBlockById(definition.id).getField('abs_arg_0')).toBeNull();
    expect(nativeState()['variables']).toEqual(state['variables']);
  });

  it('verifies a host-prepared value call connected to a native parent even when the definition follows the call', async () => {
    enableNativeProcedures(); const base = await baseline();
    const source = base.source + '\nnative_commit_shape(B, procedures_callreturn() @extra:{"name":"read"}, "caller")\n'
      + 'procedures_defreturn(NAME="read")\n    @RETURN:\n        math_number(7)\n';
    await service.applyGeneration(source, base.generation);
    const parent = editor.workspace.getBlocksByType('native_commit_shape', false)[0];
    expect(parent.getInputTargetBlock('VALUE').type).toBe('procedures_callreturn');
    expect(editor.workspace.getAllVariables()).toEqual([]);
    expect(editor.workspace.getBlocksByType('procedures_defreturn', false).length).toBe(1);
  });

  for (const signature of [
    '{"params":[{"name":"missing"}]}', '{"params":[{"name":"amount","id":"forged"}]}', '{"hidden":true}',
  ]) it(`rejects invalid prepared procedure intent in a mixed candidate: ${signature}`, async () => {
    enableNativeProcedures(); editor.workspace.createVariable('amount', '', 'amount-id');
    const base = await baseline(), before = absJson(nativeState()), files = [...disk];
    const source = base.source + '\nnative_commit_shape(B, math_number(1), "native")\nprocedures_defnoreturn(NAME="work") @extra:' + signature;
    await expectAsync(service.applyGeneration(source, base.generation)).toBeRejectedWith(jasmine.objectContaining({ code: 'ABS_PROCEDURE_INVALID' }));
    expect(absJson(nativeState())).toBe(before); expect([...disk]).toEqual(files);
    expect(editor.restoreProjectWorkspaceSnapshot).not.toHaveBeenCalled();
  });

  it('still executes hosted generators and rejects their unowned child blocks before any host mutation', async () => {
    const replay = enableNativeProcedures();
    replay.steps.push({ kind: 'script', label: 'unowned-procedure-child', source: `
      Arduino.forBlock.procedures_defnoreturn = block => { block.workspace.newBlock('math_number'); return ''; };
    ` });
    const base = await baseline(), before = absJson(nativeState()), files = [...disk];
    const source = base.source + '\nnative_commit_shape(B, math_number(1), "native")\nprocedures_defnoreturn(NAME="work")';
    await expectAsync(service.applyGeneration(source, base.generation)).toBeRejected();
    expect(absJson(nativeState())).toBe(before); expect([...disk]).toEqual(files);
    expect(editor.prepareProjectCode).not.toHaveBeenCalled(); expect(editor.restoreProjectWorkspaceSnapshot).not.toHaveBeenCalled();
  });

  for (const call of ['procedures_callnoreturn() @extra:{"name":"work"}', 'procedures_callreturn() @extra:{"name":"missing"}']) {
    it(`does not accept an invalid cross-boundary procedure edge: ${call}`, async () => {
      enableNativeProcedures(); const base = await baseline(), before = absJson(nativeState()), files = [...disk];
      const source = base.source + '\nnative_commit_shape(B, ' + call + ', "native")\nprocedures_defnoreturn(NAME="work")';
      await expectAsync(service.applyGeneration(source, base.generation)).toBeRejected();
      expect(absJson(nativeState())).toBe(before); expect([...disk]).toEqual(files);
      expect(editor.prepareProjectCode).not.toHaveBeenCalled(); expect(editor.restoreProjectWorkspaceSnapshot).not.toHaveBeenCalled();
    });
  }

  it('creates native dynamic blocks using existing variables without changing model identity', async () => {
    enableNativeVariables();
    editor.workspace.createVariable('counter', '', 'counter-id');
    const base = await baseline();
    const source = base.source + '\nnative_commit_shape(A, $counter)\n';
    expect((await service.applyGeneration(source, base.generation)).publication.status).toBe('COMMITTED');
    const created = editor.workspace.getBlocksByType('native_commit_shape', false)[0];
    expect(created.getInputTargetBlock('VALUE').getFieldValue('VAR')).toBe('counter-id');
    expect(nativeState()['variables']).toEqual([{ id: 'counter-id', name: 'counter' }]);
  });

  it('carries explicit variable creation intent into both native binding passes and the same transaction', async () => {
    enableNativeVariables();
    const base = await baseline();
    const source = base.source + '\nnative_commit_shape(A, variables_get($counter))\n';
    const committed = (await new AbsBaselineStore(port, scope).loadCommitted())!;
    const { generationEvidence } = await import('./abs-generation-protocol');
    const request = { version: 2 as const, requestId: crypto.randomUUID(), base: (await generationEvidence(committed, null)).binding,
      createVariables: [{ name: 'counter' }], candidate: { hash: await hashAbsText(source), bytes: new TextEncoder().encode(source).byteLength } };
    const validation = await service.validateGeneration(source, request);
    expect(editor.workspace.getAllVariables().length).toBe(0);
    expect((await service.applyGeneration(source, base.generation, {}, validation)).publication.status).toBe('COMMITTED');
    expect(nativeState()['variables']).toEqual([{ id: `abs-variable:${request.requestId}:0`, name: 'counter' }]);
  });

  const enableNativeDeclarations = () => {
    const replay = enableNativeVariables();
    const definitions = [
      { type: 'native_model_owner', message0: '%1', args0: [{ type: 'input_statement', name: 'BODY' }] },
      // Deliberately value-before-type, not a hardcoded variable_define argument order.
      { type: 'native_model_declare', message0: '%1 %2 %3', args0: [
        { type: 'field_input', name: 'NAME', text: 'unused' }, { type: 'input_value', name: 'VALUE' },
        { type: 'field_dropdown', name: 'TYPE', options: [['int', 'int'], ['float', 'float']] },
      ], previousStatement: null, nextStatement: null },
    ];
    definitions.forEach(declare);
    replay.steps.push({ kind: 'definitions', definitions });
    replay.steps.push({ kind: 'script', label: 'declaration-generator', source: `
      Arduino.forBlock.native_model_owner = block => Arduino.statementToCode(block, 'BODY');
      Arduino.forBlock.native_model_declare = block => {
        block.workspace.createVariable(block.getFieldValue('NAME'), '');
        return block.getFieldValue('TYPE') + ' ' + block.getFieldValue('NAME') + ' = ' + Arduino.valueToCode(block, 'VALUE', 0) + ';\\n';
      };
    ` });
    // Test-only attestation. Production still verifies loaded source/handler/shape provenance.
    editor.captureDeclarativeBlockDefinitions = () => ({ ...catalog.capture(Blockly.Blocks), variableDeclarations: {
      assertCurrent() {}, get: type => type === 'native_model_declare'
        ? { nameField: 'NAME', nativeType: '', owner: { type: 'native_model_owner', input: 'BODY' } } : undefined,
    } });
    return replay;
  };
  const nativeDeclaration = 'native_model_declare("counter", math_number(7), int)';

  for (const forward of [true, false]) it(`prepares declaration models before native binding (${forward ? 'forward' : 'backward'} reference), then applies/reopens once`, async () => {
    enableNativeDeclarations();
    const base = await baseline(), before = absJson(nativeState()), files = [...disk];
    const consumer = 'native_commit_shape(B, $counter, "detail")';
    const body = forward ? [consumer, nativeDeclaration] : [nativeDeclaration, consumer];
    const source = base.source + '\nnative_model_owner()\n    ' + body.join('\n    ') + '\n';
    const committed = (await new AbsBaselineStore(port, scope).loadCommitted())!;
    const { generationEvidence } = await import('./abs-generation-protocol');
    const request = { version: 2 as const, requestId: crypto.randomUUID(), base: (await generationEvidence(committed, null)).binding,
      candidate: { hash: await hashAbsText(source), bytes: new TextEncoder().encode(source).byteLength } };
    const validation = await service.validateGeneration(source, request);
    expect(absJson(nativeState())).toBe(before); expect([...disk]).toEqual(files);
    expect(editor.prepareProjectCode).not.toHaveBeenCalled();
    expect((await service.applyGeneration(source, base.generation, {}, validation)).publication.status).toBe('COMMITTED');
    const model = editor.workspace.getAllVariables()[0], models = nativeState()['variables'];
    expect(editor.workspace.getAllVariables().length).toBe(1); expect(model.name).toBe('counter');
    const block = editor.workspace.getBlocksByType('native_commit_shape', false)[0];
    expect(block.getInputTargetBlock('VALUE').getFieldValue('VAR')).toBe(model.getId());
    const ids = editor.workspace.getAllBlocks(false).map(block => block.id).sort();
    const second = disk.get('project.abs')!.replace('"detail"', '"changed"');
    expect((await service.applyGeneration(second, JSON.parse(disk.get('project.abs.map.json')!).generation)).publication.status).toBe('COMMITTED');
    expect(nativeState()['variables']).toEqual(models);
    expect(editor.workspace.getAllBlocks(false).map(block => block.id).sort()).toEqual(ids);
    editor.restoreProjectWorkspaceSnapshot(JSON.parse(disk.get('project.abi')!));
    expect(nativeState()['variables']).toEqual(models);
    expect(editor.workspace.getBlockById(block.id).getInputTargetBlock('VALUE').getFieldValue('VAR')).toBe(model.getId());
    expect(roots().isDeletable()).toBeFalse();
  });

  for (const invalid of [
    { source: 'native_model_owner()\n    ' + nativeDeclaration + '\n    ' + nativeDeclaration, code: 'ABS_DECLARATION_DUPLICATE' },
    { source: nativeDeclaration, code: 'ABS_DECLARATION_SCOPE_UNSUPPORTED' },
  ]) it(`never commits tentative models when authoritative planning rejects ${invalid.code}`, async () => {
    enableNativeDeclarations();
    const base = await baseline(), before = absJson(nativeState()), files = [...disk];
    const source = base.source + '\nnative_commit_shape(A, $counter)\n' + invalid.source;
    await expectAsync(service.applyGeneration(source, base.generation)).toBeRejectedWith(jasmine.objectContaining({ code: invalid.code }));
    expect(absJson(nativeState())).toBe(before); expect([...disk]).toEqual(files);
    expect(editor.prepareProjectCode).not.toHaveBeenCalled(); expect(editor.restoreProjectWorkspaceSnapshot).not.toHaveBeenCalled();
  });

  it('does not turn a declaration rename or a misspelled reference into model creation in a mixed native edit', async () => {
    enableNativeDeclarations();
    const base = await baseline();
    const source = base.source + '\nnative_model_owner()\n    ' + nativeDeclaration + '\n    native_commit_shape(B, $counter, "detail")';
    await service.applyGeneration(source, base.generation);
    const before = absJson(nativeState()), files = [...disk], saved = disk.get('project.abs')!;
    const generation = JSON.parse(disk.get('project.abs.map.json')!).generation;
    for (const bad of [saved.replaceAll('counter', 'renamed'), saved.replace('$counter', '$typo')]) {
      await expectAsync(service.applyGeneration(bad, generation)).toBeRejected();
      expect(absJson(nativeState())).toBe(before); expect([...disk]).toEqual(files);
    }
  });

  it('uses an agreeing explicit model intent once alongside a declaration and native forward reference', async () => {
    enableNativeDeclarations();
    const base = await baseline();
    const source = base.source + '\nnative_commit_shape(B, variables_get($counter), "detail")\nnative_model_owner()\n    ' + nativeDeclaration;
    const committed = (await new AbsBaselineStore(port, scope).loadCommitted())!;
    const { generationEvidence } = await import('./abs-generation-protocol');
    const request = { version: 2 as const, requestId: crypto.randomUUID(), base: (await generationEvidence(committed, null)).binding,
      createVariables: [{ name: 'counter' }], candidate: { hash: await hashAbsText(source), bytes: new TextEncoder().encode(source).byteLength } };
    const validation = await service.validateGeneration(source, request);
    await service.applyGeneration(source, base.generation, {}, validation);
    expect(nativeState()['variables']).toEqual([{ name: 'counter', id: `abs-variable:${request.requestId}:0` }]);
  });

  it('does not bootstrap declarations without provenance or adopt an incompatible existing model', async () => {
    enableNativeDeclarations();
    const base = await baseline(), before = absJson(nativeState()), files = [...disk];
    const source = base.source + '\nnative_commit_shape(B, $counter, "detail")\nnative_model_owner()\n    ' + nativeDeclaration;
    const capture = editor.captureDeclarativeBlockDefinitions;
    editor.captureDeclarativeBlockDefinitions = () => catalog.capture(Blockly.Blocks);
    await expectAsync(service.applyGeneration(source, base.generation)).toBeRejected();
    expect(absJson(nativeState())).toBe(before); expect([...disk]).toEqual(files);
    editor.captureDeclarativeBlockDefinitions = capture;
    editor.workspace.createVariable('counter', 'typed', 'existing-typed');
    const typed = await baseline(), typedBefore = absJson(nativeState()), typedFiles = [...disk];
    const next = typed.source + '\nnative_commit_shape(B, $counter, "detail")\nnative_model_owner()\n    ' + nativeDeclaration;
    await expectAsync(service.applyGeneration(next, typed.generation)).toBeRejectedWith(jasmine.objectContaining({ code: 'ABS_DECLARATION_MODEL_CONFLICT' }));
    expect(absJson(nativeState())).toBe(typedBefore); expect([...disk]).toEqual(typedFiles);
    expect(editor.prepareProjectCode).not.toHaveBeenCalled();
  });

  it('hydrates compact large values for native binding and preserves external-only storage through apply/reload', async () => {
    enableNative();
    const text = 'native resource payload '.repeat(2200);
    const ref = await projectDataRuntime.put({ codec: 'utf8-v1', storage: 'raw-v1', value: text });
    const base = await baseline(), compact = JSON.stringify(createAilyProjectDataValue(ref));
    const source = base.source + `\nnative_commit_shape(B, math_number(7), ${compact})\n`;
    expect((await service.applyGeneration(source, base.generation)).publication.status).toBe('COMMITTED');
    const id = editor.workspace.getBlocksByType('native_commit_shape', false)[0].id;
    expect(editor.workspace.getBlockById(id).getFieldValue('DETAIL')).toBe(text);
    expect(disk.get('project.abs')).toContain('$ailyProjectDataValue');
    expect(disk.get('project.abs')).not.toContain(text); expect(disk.get('project.abi')).not.toContain(text);
    const generation = JSON.parse(disk.get('project.abs.map.json')!).generation;
    const next = disk.get('project.abs')!.replace(/math_number\((?:NUM=)?7\)/, 'math_number(8)');
    expect((await service.applyGeneration(next, generation)).publication.status).toBe('COMMITTED');
    expect(editor.workspace.getBlockById(id).getFieldValue('DETAIL')).toBe(text);
    expect(editor.workspace.getBlockById(id).getInputTargetBlock('VALUE').getFieldValue('NUM')).toBe(8);
    expect(values.get(ref.$ailyData.id)).toBe(text);
  });

  it('fails native preparation on a missing resource without saving or loading the host workspace', async () => {
    enableNative();
    const ref = await projectDataRuntime.put({ codec: 'utf8-v1', storage: 'raw-v1', value: 'missing'.repeat(6000) });
    values.delete(ref.$ailyData.id);
    const base = await baseline(), before = absJson(nativeState()), originalDisk = [...disk];
    const source = base.source + `\nnative_commit_shape(B, null, ${JSON.stringify(createAilyProjectDataValue(ref))})\n`;
    await expectAsync(service.applyGeneration(source, base.generation)).toBeRejectedWithError(/missing resource/);
    expect(absJson(nativeState())).toBe(before); expect([...disk]).toEqual(originalDisk);
    expect(editor.prepareProjectCode).not.toHaveBeenCalled();
  });

  for (const chunk of [false, true]) it(`preserves binary media through native create/edit/save/reopen (chunk=${chunk})`, async () => {
    const replay = enableNative();
    if (chunk) renderWorkspace();
    const definition = { type: 'native_commit_media', message0: '%1', args0: [
      { type: 'field_bitmap_u8g2', name: 'DATA', width: 8, height: 1 },
    ], output: 'Bitmap' };
    declare(definition);
    replay.steps.push({ kind: 'definitions', definitions: [definition] }, { kind: 'script', label: 'media-codegen', source: `
      Arduino.forBlock.native_commit_media = block => {
        const pixels = block.getFieldValue('DATA');
        if (pixels[0][0] !== 1 || pixels[0][7] !== 1) throw Error('Binary bytes lost');
        return ['0', 0];
      };` });
    const ref: any = { $ailyData: { schemaVersion: 1, id: 'sha256:' + 'c'.repeat(64), codec: 'u8g2-xbm-v1',
      logicalType: 'binary', storage: 'raw-v1', rawLength: 1, storedLength: 1 } };
    values.set(ref.$ailyData.id, new Uint8Array([129]));
    const field = { schemaVersion: 1, encoding: 'xbm-lsb-row-v1', width: 8, height: 1, bitmap: ref };
    const base = await baseline(), source = base.source + `\nnative_commit_shape(B, math_number(7), "detail")\nnative_commit_media(${JSON.stringify(field)})\n`;
    expect((await service.applyGeneration(source, base.generation, { chunk })).publication.status).toBe('COMMITTED');
    const id = editor.workspace.getBlocksByType('native_commit_media', false)[0].id;
    expect(editor.workspace.getBlockById(id).getFieldValue('DATA')).toEqual(field);
    const next = await baseline();
    expect((await service.applyGeneration(next.source.replace('"detail"', '"edited"'), next.generation, { chunk })).publication.status).toBe('COMMITTED');
    const state = nativeState(), persisted = JSON.parse(disk.get('project.abi')!);
    editor.restoreProjectWorkspaceSnapshot(persisted);
    expect(nativeState()).toEqual(state); expect(roots().isDeletable()).toBeFalse();
    expect(editor.workspace.getBlockById(id).getFieldValue('DATA')).toEqual(field);
    expect(values.get(ref.$ailyData.id)).toEqual(new Uint8Array([129]));
    const again = await baseline(), files = [...disk], before = absJson(nativeState());
    values.delete(ref.$ailyData.id);
    // Force native shape discovery; the fixture's fast-path resource port is a stub.
    const missing = again.source.replace(/native_commit_shape\([^\n]+/, 'native_commit_shape(A, math_number(7))');
    expect(missing).not.toBe(again.source);
    await expectAsync(service.applyGeneration(missing, again.generation, { chunk })).toBeRejectedWithError(/missing resource/);
    expect([...disk]).toEqual(files); expect(absJson(nativeState())).toBe(before);
  });

  it('discovers scoped capabilities without storage, generation, block creation or mutation', () => {
    const before = absJson(nativeState()), probe = spyOn(Blockly.Workspace.prototype, 'newBlock').and.callThrough();
    const report = new AbsGenerationToolsService(service).capabilities({ version: 1, type: 'abs_declared_text' });
    expect(report.scope).toEqual(scope); expect(report.blocks.length).toBe(1); expect(report.blocks[0].level).toBe('create');
    expect(report.runtimeRevision).toBeGreaterThanOrEqual(0); expect(absJson(nativeState())).toBe(before);
    expect(disk.size).toBe(0); expect(editor.prepareProjectCode).not.toHaveBeenCalled(); expect(probe).not.toHaveBeenCalled();
    editor.blockTypeToLibMap.set('abs_declared_text', { name: 'unique-library' });
    expect(service.describeCapabilities({ version: 1, filter: 'unique-library' }).blocks.map(block => block.type)).toEqual(['abs_declared_text']);
    editor.switchPage('other');
    expect(service.describeCapabilities({ version: 1, type: 'abs_declared_text' }).scope.pageId).toBe('other');
  });

  it('offers native validation only with a current complete replay, without probing blocks', () => {
    const replay = enableNative(), probe = spyOn(Blockly.Workspace.prototype, 'newBlock').and.callThrough();
    const describe = () => service.describeCapabilities({ version: 1, type: 'native_commit_shape' }).blocks[0];
    expect(describe().level).toBe('validate');
    expect((describe() as any).contract).toBe('native-sync-v1');
    expect(probe).not.toHaveBeenCalled(); expect(disk.size).toBe(0);
    replay.steps.push({ kind: 'script', label: 'unsupported', source: 'async function later() {}' });
    expect(describe().level).toBe('preserve-only');
    replay.steps.pop(); replay.assertCurrent.and.throwError('stale');
    expect(describe().level).toBe('preserve-only');
    expect(service.describeCapabilities({ version: 1, type: 'missing' }).blocks[0].level).toBe('unavailable');
  });

  it('rejects malformed capability requests and missing runtime context', () => {
    for (const query of [{}, { version: 2 }, { version: 1, type: '' }, { version: 1, filter: [] },
      { version: 1, type: 'x', filter: 'y' }, { version: 1, execute: true }]) expect(() => service.describeCapabilities(query)).toThrow();
    project.currentProjectPath = '';
    expect(() => service.describeCapabilities({ version: 1 })).toThrow();
  });

  it('exports a complete document baseline without saving ABI or exposing metadata in ABS', async () => {
    const original = absJson(nativeState()); const base = await baseline();
    expect(disk.has('project.abi')).toBeFalse(); expect(absJson(nativeState())).toBe(original);
    expect(base.source).not.toContain('@meta'); expect(base.source).not.toContain('deletable');
    const stored = await new AbsBaselineStore(port, scope).loadCommitted();
    expect(stored!.workspace.blocks.blocks[0]['deletable']).toBeFalse();
    expect((stored!.document as any).pages[1].custom).toEqual({ preserved: true });
    expect(editor.prepareProjectCode).not.toHaveBeenCalled();
  });

  const wireBase = async () => {
    disk.set('project.abi', absJson(editor.captureProjectSnapshot().document));
    const tools = new AbsGenerationToolsService(service);
    const exported: any = await tools.execute('abs_projection', { version: 2, requestId: crypto.randomUUID(), expectedAbiHash: await hashAbsText(disk.get('project.abi')!) });
    expect(exported.ok).withContext(JSON.stringify(exported)).toBeTrue();
    const source = exported.abs.replace('TEXT="before"', 'TEXT="wire edit"');
    const request = { version: 2, requestId: crypto.randomUUID(), base: exported.receipt.base,
      candidate: { hash: await hashAbsText(source), bytes: new TextEncoder().encode(source).byteLength } };
    return { tools, exported, source, request };
  };

  it('production wire validates without publishing and applies through the one generation save', async () => {
    const { tools, source, request } = await wireBase(); const original = [...disk];
    const validated: any = await tools.execute('abs_validate', { ...request, abs: source }, source);
    expect(validated.ok).toBeTrue(); expect(validated.receipt.abs).toBeUndefined(); expect([...disk]).toEqual(original);
    expect(roots().getFieldValue('TEXT')).toBe('before'); expect(editor.prepareProjectCode).not.toHaveBeenCalled();
    const applied: any = await tools.execute('abs_apply', { version: 2, requestId: request.requestId, validation: validated.receipt }, source);
    expect(applied.ok).withContext(JSON.stringify(applied)).toBeTrue(); expect(applied.receipt.validation.scope).toBe('complete-generation');
    expect(applied.receipt.output.binding.abiHash).toBe(await hashAbsText(disk.get('project.abi')!));
    expect(applied.receipt.output.binding.mapHash).toBe(await hashAbsText(disk.get('project.abs.map.json')!));
    expect(editor.prepareProjectCode).toHaveBeenCalledTimes(1); expect(project.publishPreparedSaveOutputs).toHaveBeenCalledTimes(1);
    expect(roots().id).toBe('protected'); expect(roots().isDeletable()).toBeFalse();
  });

  it('production wire applies repeated same-type edits as one identity-preserving batch', async () => {
    declare({ type: 'abs_batch_text', message0: '%1', args0: [{ type: 'field_input', name: 'TEXT', text: '' }], output: null });
    for (const [id, value] of [['batch-a', 'first'], ['batch-b', 'second']]) {
      const block = editor.workspace.newBlock('abs_batch_text', id);
      block.setFieldValue(value, 'TEXT'); block.data = id + ':metadata';
    }
    const base = await wireBase(), original = base.exported.abs as string;
    const edits = ['first', 'second'].map(value => {
      const start = original.indexOf(JSON.stringify(value));
      return { start, end: start + JSON.stringify(value).length, text: JSON.stringify(value + ' changed') };
    }).sort((a, b) => a.start - b.start);
    const source = [...edits].reverse().reduce((text, edit) => text.slice(0, edit.start) + edit.text + text.slice(edit.end), original);
    const request = { ...base.request, sourceEdits: [edits], candidate: { hash: await hashAbsText(source), bytes: new TextEncoder().encode(source).byteLength } };
    const before = nativeState(), files = [...disk];
    const validation: any = await base.tools.execute('abs_validate', request, source);
    expect(validation.ok).withContext(JSON.stringify(validation)).toBeTrue();
    expect(nativeState()).toEqual(before); expect([...disk]).toEqual(files);
    const applied: any = await base.tools.execute('abs_apply', { version: 2, requestId: request.requestId, validation: validation.receipt }, source);
    expect(applied.ok).withContext(JSON.stringify(applied)).toBeTrue();
    expect(editor.prepareProjectCode).toHaveBeenCalledTimes(1);
    for (const [id, value] of [['batch-a', 'first'], ['batch-b', 'second']]) {
      const block = editor.workspace.getBlockById(id);
      expect(block.getFieldValue('TEXT')).toBe(value + ' changed'); expect(block.data).toBe(id + ':metadata');
    }
    expect(roots().isDeletable()).toBeFalse();
    const saved = nativeState(); editor.restoreProjectWorkspaceSnapshot(JSON.parse(disk.get('project.abi')!));
    expect(nativeState()).toEqual(saved);
  });

  it('creates and reshapes common branch mutators through validate/apply, preserving generation and protected roots', async () => {
    declare({ type: 'abs_dynamic_number', message0: '%1', args0: [{ type: 'field_number', name: 'NUM', value: 0 }], output: 'Number' });
    declare({ type: 'abs_dynamic_if', message0: '%1 %2', args0: [{ type: 'input_value', name: 'IF0' },
      { type: 'input_statement', name: 'DO0' }], mutator: 'controls_if_mutator', previousStatement: null, nextStatement: null });
    const run = async (base: Awaited<ReturnType<typeof wireBase>>, candidate: string) => {
      const before = nativeState(), files = [...disk];
      const binding = { ...base.request, candidate: { hash: await hashAbsText(candidate), bytes: new TextEncoder().encode(candidate).byteLength } };
      const validation: any = await base.tools.execute('abs_validate', binding, candidate);
      expect(validation.ok).withContext(JSON.stringify(validation)).toBeTrue();
      expect(nativeState()).toEqual(before); expect([...disk]).toEqual(files);
      const result: any = await base.tools.execute('abs_apply', { version: 2, requestId: base.request.requestId, validation: validation.receipt }, candidate);
      expect(result.ok).withContext(JSON.stringify(result)).toBeTrue();
    };
    const first = await wireBase();
    await run(first, first.source + '\nabs_dynamic_if(abs_dynamic_number(1), abs_dynamic_number(2)) @extra:{"elseIfCount":1,"hasElse":true}');
    const id = editor.workspace.getBlocksByType('abs_dynamic_if')[0].id;
    const second = await wireBase();
    await run(second, second.source.replace('"elseIfCount":1', '"elseIfCount":2'));
    expect(editor.workspace.getBlockById(id).getInput('IF2')).toBeTruthy();
    expect(roots().id).toBe('protected'); expect(roots().isDeletable()).toBeFalse();
    const committed = await new AbsBaselineStore(port, scope).loadCommitted();
    expect(committed!.abs).toBe(disk.get('project.abs'));
    expect((committed!.document as any).pages[1].custom).toEqual({ preserved: true });
  });

  it('prepares and commits bundled procedure parameters through the normal generation transaction', async () => {
    renderWorkspace();
    const { tools, source, request } = await wireBase();
    const candidate = source + '\nprocedures_defnoreturn(NAME="work") @extra:{"params":[{"name":"amount"}]}\nprocedures_callnoreturn() @extra:{"name":"work","params":["amount"]}';
    const binding = { ...request, createVariables: [{ name: 'amount' }], candidate: { hash: await hashAbsText(candidate), bytes: new TextEncoder().encode(candidate).byteLength } };
    const before = nativeState(), files = [...disk];
    const validation: any = await tools.execute('abs_validate', binding, candidate);
    expect(validation.ok).withContext(JSON.stringify(validation)).toBeTrue();
    expect(nativeState()).toEqual(before); expect([...disk]).toEqual(files);
    const result: any = await tools.execute('abs_apply', { version: 2, requestId: request.requestId, validation: validation.receipt, chunk: true }, candidate);
    expect(result.ok).withContext(JSON.stringify(result)).toBeTrue();
    expect(editor.workspace.getAllVariables().map(model => model.name)).toEqual(['amount']);
    expect(editor.workspace.getAllBlocks(false).filter(block => block.type.startsWith('procedures_')).length).toBe(2);
    expect(roots().isDeletable()).toBeFalse(); expect(editor.prepareProjectCode).toHaveBeenCalledTimes(1);
  });

  it('rolls back prepared procedure blocks and models when a generator introduces an extra model', async () => {
    const { tools, source, request } = await wireBase();
    const candidate = source + '\nprocedures_defnoreturn(NAME="work")';
    const binding = { ...request, candidate: { hash: await hashAbsText(candidate), bytes: new TextEncoder().encode(candidate).byteLength } };
    const validation: any = await tools.execute('abs_validate', binding, candidate);
    expect(validation.ok).toBeTrue(); const before = nativeState(), files = [...disk];
    editor.prepareProjectCode.and.callFake(async () => { editor.workspace.createVariable('unexpected'); return null; });
    const result: any = await tools.execute('abs_apply', { version: 2, requestId: request.requestId, validation: validation.receipt }, candidate);
    expect(result.ok).toBeFalse(); expect(nativeState()).toEqual(before); expect([...disk]).toEqual(files);
    expect(editor.restoreProjectWorkspaceSnapshot).toHaveBeenCalledTimes(1);
  });

  for (const chunk of [false, true]) it(`creates models and resolves real variable fields atomically (chunk=${chunk})`, async () => {
    if (chunk) renderWorkspace();
    declare({ type: 'abs_native_get', message0: '%1', args0: [{ type: 'field_variable', name: 'VAR', variable: 'default' }],
      extensions: ['contextMenu_variableSetterGetter'], output: null });
    const { tools, request, source } = await wireBase();
    const candidate = source + '\nabs_native_get(VAR="counter")';
    const creation = { ...request, candidate: { hash: await hashAbsText(candidate), bytes: new TextEncoder().encode(candidate).byteLength },
      createVariables: [{ name: 'counter' }] };
    const original = [...disk];
    const validated: any = await tools.execute('abs_validate', creation, candidate);
    expect(validated.ok).withContext(JSON.stringify(validated)).toBeTrue();
    expect(editor.workspace.getAllVariables()).toEqual([]); expect([...disk]).toEqual(original);
    // Same-name generator registration must reuse the prepared model, not manufacture an extra model.
    editor.prepareProjectCode.and.callFake(async () => { editor.workspace.createVariable('counter', ''); return null; });
    const applied: any = await tools.execute('abs_apply', { version: 2, requestId: creation.requestId, validation: validated.receipt, chunk }, candidate);
    expect(applied.ok).withContext(JSON.stringify(applied)).toBeTrue();
    const model = editor.workspace.getVariable('counter', '');
    expect(model.getId()).toBe(`abs-variable:${request.requestId}:0`);
    expect(editor.workspace.getBlocksByType('abs_native_get')[0].getFieldValue('VAR')).toBe(model.getId());
    expect(editor.workspace.getAllVariables().length).toBe(1);
    const committed = await new AbsBaselineStore(port, scope).loadCommitted();
    expect(committed!.workspace['variables']).toEqual(nativeState()['variables']);
    expect(JSON.parse(disk.get('project.abi')!).sharedModel.variables).toEqual(nativeState()['variables']);
    expect(disk.get('project.abs')).not.toContain('@var'); expect(roots().isDeletable()).toBeFalse();
    editor.switchPage('other'); editor.switchPage('main');
    expect(editor.workspace.getVariable('counter').getId()).toBe(model.getId());
    const next = await wireBase();
    const duplicate: any = await next.tools.execute('abs_validate', { ...next.request, createVariables: [{ name: 'COUNTER', type: 'Number' }] }, next.source);
    expect(duplicate.code).toBe('ABS_VARIABLE_EXISTS');
  });

  it('rolls back both new models and blocks when the generator introduces unprepared state', async () => {
    const { tools, request, source } = await wireBase(); const original = nativeState(); const mirrors = [...disk];
    const validated: any = await tools.execute('abs_validate', { ...request, createVariables: [{ name: 'counter' }] }, source);
    expect(validated.ok).toBeTrue();
    editor.prepareProjectCode.and.callFake(async () => { editor.workspace.createVariable('unprepared'); return null; });
    const applied: any = await tools.execute('abs_apply', { version: 2, requestId: request.requestId, validation: validated.receipt }, source);
    expect(applied.ok).toBeFalse(); expect(nativeState()).toEqual(original); expect([...disk]).toEqual(mirrors);
    expect(editor.restoreProjectWorkspaceSnapshot).toHaveBeenCalledTimes(1);
  });

  it('uses definition-order syntax through production validate/apply/export and preserves IDs on the second edit', async () => {
    declare({ type: 'abs_tx_order', message0: '%1 %2 %3', args0: [
      { type: 'field_input', name: 'NAME', text: 'counter' }, { type: 'input_value', name: 'VALUE' },
      { type: 'field_dropdown', name: 'TYPE', options: [['int', 'int']] },
    ], previousStatement: null, nextStatement: null });
    declare({ type: 'abs_tx_number', message0: '%1', args0: [{ type: 'field_number', name: 'NUM', value: 0 }], output: 'Number' });
    const { tools, request, source } = await wireBase();
    const text = source + '\nabs_tx_order("counter", abs_tx_number(7), int)';
    const input = { ...request, candidate: { hash: await hashAbsText(text), bytes: new TextEncoder().encode(text).length } };
    const validated: any = await tools.execute('abs_validate', input, text);
    expect(validated.ok).withContext(JSON.stringify(validated)).toBeTrue();
    const applied: any = await tools.execute('abs_apply', { version: 2, requestId: request.requestId, validation: validated.receipt }, text);
    expect(applied.ok).withContext(JSON.stringify(applied)).toBeTrue();
    const parent = editor.workspace.getBlocksByType('abs_tx_order', false)[0];
    const number = parent.getInputTargetBlock('VALUE');
    const ids = [parent.id, number.id];
    expect(parent.getFieldValue('TYPE')).toBe('int'); expect(number.getFieldValue('NUM')).toBe(7);
    const next = await baseline();
    expect(next.source).toContain('abs_tx_order("counter", abs_tx_number(7), int)');
    expect((await service.applyGeneration(next.source.replace('abs_tx_number(7)', 'abs_tx_number(9)'), next.generation)).publication.status).toBe('COMMITTED');
    expect(editor.workspace.getBlockById(ids[0]).getInputTargetBlock('VALUE').id).toBe(ids[1]);
    expect(editor.workspace.getBlockById(ids[1]).getFieldValue('NUM')).toBe(9);
    expect(roots().isDeletable()).toBeFalse();
    expect((await new AbsBaselineStore(port, scope).loadCommitted())!.map.nodes.some(node => node.blockId === ids[1])).toBeTrue();
  });

  it('rejects malformed model intents before preparing or publishing anything', async () => {
    const { tools, request, source } = await wireBase(); const original = [...disk];
    for (const createVariables of [[], [{ name: 'counter', id: 'supplied' }], [{ name: 'counter' }, { name: 'COUNTER' }]]) {
      expect((await tools.execute('abs_validate', { ...request, createVariables }, source)).ok).toBeFalse();
    }
    expect([...disk]).toEqual(original); expect(editor.workspace.getAllVariables()).toEqual([]);
    expect(editor.prepareProjectCode).not.toHaveBeenCalled();
  });

  it('requires the exact prepared model IDs before apply and never trusts an intent echo alone', async () => {
    const { tools, request, source } = await wireBase(); const mirrors = [...disk];
    const validated: any = await tools.execute('abs_validate', { ...request, createVariables: [{ name: 'counter' }] }, source);
    expect(validated.ok).toBeTrue();
    expect(validated.receipt.preparedVariables).toEqual([{ id: `abs-variable:${request.requestId}:0`, name: 'counter', type: '' }]);
    for (const mutate of [receipt => delete receipt.preparedVariables, receipt => receipt.preparedVariables[0].id = 'changed',
      receipt => receipt.createVariables[0].name = 'changed']) {
      const receipt = structuredClone(validated.receipt); mutate(receipt);
      const result: any = await tools.execute('abs_apply', { version: 2, requestId: request.requestId, validation: receipt }, source);
      expect(result.code).toBe('ABS_REQUEST_INVALID');
    }
    expect([...disk]).toEqual(mirrors); expect(editor.workspace.getAllVariables()).toEqual([]);
    expect(editor.prepareProjectCode).not.toHaveBeenCalled();
  });

  it('rejects legacy wire requests and stale export bytes without writing', async () => {
    const tools = new AbsGenerationToolsService(service);
    expect((await tools.execute('abs_projection', { version: 1, requestId: crypto.randomUUID() })).ok).toBeFalse();
    const result: any = await tools.execute('abs_projection', { version: 2, requestId: crypto.randomUUID(), expectedAbiHash: await hashAbsText('stale') });
    expect(result.code).toBe('ABS_BASELINE_STALE'); expect(disk.size).toBe(0);
  });

  it('requires explicit initialization and retains the exact old ABS recovery input', async () => {
    disk.set('project.abi', absJson(editor.captureProjectSnapshot().document)); disk.set('project.abs', 'old unversioned candidate');
    const tools = new AbsGenerationToolsService(service);
    const request = { version: 2, requestId: crypto.randomUUID(), expectedAbiHash: await hashAbsText(disk.get('project.abi')!) };
    expect((await tools.execute('abs_projection', request) as any).code).toBe('ABS_INITIALIZATION_REQUIRED');
    const initialized: any = await tools.execute('abs_projection', { ...request, initialize: true });
    expect(initialized.ok).toBeTrue();
    expect([...disk.entries()].filter(([key]) => key.startsWith('baselines/')).some(([, text]) => JSON.parse(text).inputAbs === 'old unversioned candidate')).toBeTrue();
  });

  it('custom readonly projection does not advance any generation or mirror', async () => {
    const { tools } = await wireBase(); const original = [...disk];
    const result: any = await tools.execute('abs_projection', { version: 2, requestId: crypto.randomUUID(), expectedAbiHash: await hashAbsText(disk.get('project.abi')!), publish: false });
    expect(result.ok).toBeTrue(); expect(result.receipt.persisted).toBeFalse(); expect([...disk]).toEqual(original);
  });

  it('invalid or changed candidate bindings fail before touching blocks', async () => {
    const { tools, request, source } = await wireBase(); const original = [...disk];
    for (const change of [r => r.base.generation = 'stale', r => r.base.mapHash = 'sha256:' + '0'.repeat(64), r => r.base.scope.pageId = 'other', r => r.candidate.bytes++]) {
      const changed = structuredClone(request); change(changed);
      expect((await tools.execute('abs_validate', changed, source)).ok).toBeFalse();
    }
    expect([...disk]).toEqual(original); expect(roots().getFieldValue('TEXT')).toBe('before');
  });

  it('an edit after validation cannot be saved away by apply', async () => {
    const { tools, request, source } = await wireBase();
    const validated: any = await tools.execute('abs_validate', request, source);
    roots().setFieldValue('user edit after validation', 'TEXT');
    const result: any = await tools.execute('abs_apply', { version: 2, requestId: request.requestId, validation: validated.receipt }, source);
    expect(result.code).toBe('ABS_REVISION_STALE'); expect(roots().getFieldValue('TEXT')).toBe('user edit after validation');
    expect(editor.prepareProjectCode).not.toHaveBeenCalled();
  });

  it('recovery wire inspects and repairs disk without loading or generating blocks', async () => {
    const { tools, request, source } = await wireBase();
    const validated: any = await tools.execute('abs_validate', request, source); failWrite = 'project.abs';
    const applied: any = await tools.execute('abs_apply', { version: 2, requestId: request.requestId, validation: validated.receipt }, source);
    expect(applied.ok).toBeFalse(); expect(applied.publication.status).toBe('MIRROR_PENDING');
    const base = { version: 2, requestId: crypto.randomUUID() };
    const abi = disk.get('project.abi'), current = absJson(nativeState());
    const inspected: any = await tools.execute('abs_recovery', { ...base, action: 'inspect' });
    expect(inspected.pending.abiSaved).toBeTrue(); expect(inspected.receipt.requestId).toBe(base.requestId);
    expect(inspected.requestId).toBeUndefined(); // Top-level requestId belongs to the enclosing IPC transport.
    expect((await tools.execute('abs_recovery', { ...base, action: 'abandon' })).ok).toBeFalse();
    failWrite = undefined;
    const recovered: any = await tools.execute('abs_recovery', { ...base, action: 'recover' });
    expect(recovered.ok).toBeTrue(); expect(recovered.requiresReload).toBeTrue(); expect(disk.get('project.abi')).toBe(abi);
    expect(absJson(nativeState())).toBe(current); expect(editor.prepareProjectCode).toHaveBeenCalledTimes(1); expect(gate.blocked).toBeTrue();
  });

  const inspect = (tools: AbsGenerationToolsService) => tools.execute('abs_recovery', { version: 2, requestId: crypto.randomUUID(), action: 'inspect' }) as Promise<any>;
  const rebind = async (tools: AbsGenerationToolsService, token: string, options = {}) => tools.execute('abs_projection', {
    version: 2, requestId: crypto.randomUUID(), expectedAbiHash: await hashAbsText(disk.get('project.abi')!), rebind: token, ...options,
  }) as Promise<any>;

  it('explicitly rebinds a copied project without saving ABI, changing IDs or accepting its old candidate', async () => {
    const { tools, request, source, exported } = await wireBase();
    const before = [...disk], abi = disk.get('project.abi'), state = absJson(nativeState());
    project.currentProjectPath = 'D:/copied-project';
    await expectAsync(service.exportGeneration()).toBeRejectedWith(jasmine.objectContaining({ code: 'ABS_SCOPE_INVALID' }));
    const diagnosis = await inspect(tools);
    expect([...disk]).toEqual(before); expect(diagnosis.diagnostics.issues).toEqual(['ABS_SCOPE_INVALID']);
    const result = await rebind(tools, diagnosis.diagnostics.rebind.token);
    expect(result.ok).withContext(JSON.stringify(result)).toBeTrue();
    expect(result.receipt.base.scope.projectKey).toBe(project.currentProjectPath);
    expect(result.receipt.base.generation).not.toBe(exported.receipt.base.generation);
    expect(disk.get('project.abi')).toBe(abi); expect(absJson(nativeState())).toBe(state);
    expect(editor.prepareProjectCode).not.toHaveBeenCalled(); expect(project.publishPreparedSaveOutputs).not.toHaveBeenCalled();
    for (const [key, value] of before.filter(([key]) => key.startsWith('baselines/'))) expect(disk.get(key)).toBe(value);
    expect((await tools.execute('abs_validate', request, source) as any).code).toBe('ABS_BASELINE_STALE');
    expect((await inspect(tools)).diagnostics.status).toBe('ready');
  });

  it('switches page scope in both directions through explicit exports without merging either page', async () => {
    const { tools, request, source, exported } = await wireBase(); const abi = disk.get('project.abi');
    editor.switchPage('other');
    const first = await inspect(tools);
    expect(first.diagnostics.rebind.to.pageId).toBe('other');
    const other = await rebind(tools, first.diagnostics.rebind.token);
    expect(other.ok).withContext(JSON.stringify(other)).toBeTrue(); expect(other.receipt.base.scope.pageId).toBe('other');
    expect(editor.workspace.getAllBlocks(false).length).toBe(0); expect(disk.get('project.abi')).toBe(abi);
    expect((await tools.execute('abs_validate', request, source) as any).code).toBe('ABS_BASELINE_STALE');
    editor.switchPage('main');
    expect((await rebind(tools, first.diagnostics.rebind.token)).code).toBe('ABS_REBIND_STALE');
    const second = await inspect(tools), main = await rebind(tools, second.diagnostics.rebind.token);
    expect(main.ok).toBeTrue(); expect(main.abs).toBe(exported.abs); expect(roots().isDeletable()).toBeFalse();
    expect(disk.get('project.abi')).toBe(abi); expect(editor.prepareProjectCode).not.toHaveBeenCalled();
  });

  for (const badMap of [null, '{broken map 中文😀']) it(`repairs a ${badMap === null ? 'missing' : 'corrupt'} public map and preserves replaced bytes`, async () => {
    const { tools } = await wireBase();
    if (badMap === null) disk.delete('project.abs.map.json'); else disk.set('project.abs.map.json', badMap);
    const before = [...disk], diagnosis = await inspect(tools);
    expect([...disk]).toEqual(before); expect(diagnosis.diagnostics.issues).toEqual(['ABS_MAP_INVALID']);
    const result = await rebind(tools, diagnosis.diagnostics.rebind.token);
    expect(result.ok).withContext(JSON.stringify(result)).toBeTrue();
    const record = JSON.parse(disk.get(`baselines/${result.receipt.base.generation}.json`)!);
    expect(record.inputMap).toBe(badMap); expect(record.inputAbs).toBe(before.find(([key]) => key === 'project.abs')![1]);
    expect((await inspect(tools)).diagnostics.status).toBe('ready');
  });

  it('never offers rebinding for an unapplied source even when the map and project scope differ', async () => {
    const { tools, source } = await wireBase();
    project.currentProjectPath = 'D:/copied-project'; disk.set('project.abs', source); disk.set('project.abs.map.json', 'corrupt');
    const before = [...disk], diagnosis = await inspect(tools);
    expect(diagnosis.diagnostics.status).toBe('blocked'); expect(diagnosis.diagnostics.rebind).toBeUndefined();
    expect(diagnosis.diagnostics.issues).toContain('ABS_SOURCE_CONFLICT');
    expect((await rebind(tools, 'sha256:' + '0'.repeat(64))).code).toBe('ABS_REBIND_STALE'); expect([...disk]).toEqual(before);
  });

  it('upgrades a verified previous projection through inspect/rebind without loading or saving ABI', async () => {
    const { tools, exported } = await wireBase();
    const key = `baselines/${exported.receipt.base.generation}.json`;
    const record = JSON.parse(disk.get(key)!);
    // This fixture has no symbol fields/argument order, so preview.3's text was identical.
    record.projection.map.projectionVersion = 'abs-v2.preview.3';
    disk.set(key, absJson(record)); disk.set('project.abs.map.json', absJson(record.projection.map));
    const pointer = JSON.parse(disk.get('committed.json')!); pointer.hash = await hashAbsText(disk.get(key)!);
    disk.set('committed.json', absJson(pointer));
    const originalAbi = disk.get('project.abi'), originalState = absJson(nativeState()), originalRecord = disk.get(key);
    const diagnosis = await inspect(tools);
    expect(diagnosis.diagnostics.issues).toEqual(['ABS_PROJECTION_UPGRADE_REQUIRED']);
    const plain: any = await tools.execute('abs_projection', { version: 2, requestId: crypto.randomUUID(), expectedAbiHash: await hashAbsText(originalAbi!) });
    expect(plain.code).toBe('ABS_PROJECTION_UPGRADE_REQUIRED');
    const upgraded = await rebind(tools, diagnosis.diagnostics.rebind.token);
    expect(upgraded.ok).withContext(JSON.stringify(upgraded)).toBeTrue();
    expect(JSON.parse(disk.get('project.abs.map.json')!).projectionVersion).toBe('abs-v2.preview.4');
    expect(disk.get(key)).toBe(originalRecord); expect(disk.get('project.abi')).toBe(originalAbi);
    expect(absJson(nativeState())).toBe(originalState); expect(editor.prepareProjectCode).not.toHaveBeenCalled();
    expect((await inspect(tools)).diagnostics.status).toBe('ready');
  });

  it('rejects stale inspection tokens after any mirror or target page changes', async () => {
    const { tools } = await wireBase(); project.currentProjectPath = 'D:/copied-project';
    const diagnosis = await inspect(tools);
    for (const key of ['project.abi', 'project.abs', 'project.abs.map.json']) {
      const previous = disk.get(key)!; disk.set(key, previous + ' '); const before = [...disk];
      expect((await rebind(tools, diagnosis.diagnostics.rebind.token)).code).toBe('ABS_REBIND_STALE');
      expect([...disk]).toEqual(before); disk.set(key, previous);
    }
    editor.switchPage('other'); const before = [...disk];
    expect((await rebind(tools, diagnosis.diagnostics.rebind.token)).code).toBe('ABS_REBIND_STALE'); expect([...disk]).toEqual(before);
  });

  it('refuses rebind initialization/custom outputs and corrupt authoritative baselines without writes', async () => {
    const { tools } = await wireBase(); project.currentProjectPath = 'D:/copied-project';
    const diagnosis = await inspect(tools), token = diagnosis.diagnostics.rebind.token, before = [...disk];
    for (const options of [{ initialize: true }, { publish: false }]) {
      expect((await rebind(tools, token, options)).code).toBe('ABS_REBIND_STALE'); expect([...disk]).toEqual(before);
    }
    const pointer = JSON.parse(disk.get('committed.json')!); disk.set(`baselines/${pointer.generation}.json`, '{}');
    const corrupted = [...disk]; expect((await inspect(tools)).code).toBe('ABS_BASELINE_CORRUPT');
    expect((await rebind(tools, token)).code).toBe('ABS_BASELINE_CORRUPT'); expect([...disk]).toEqual(corrupted);
  });

  it('recovers interrupted rebind publication as export-only, retaining original ABI and recovery map', async () => {
    const { tools } = await wireBase(); disk.set('project.abs.map.json', 'damaged');
    const diagnosis = await inspect(tools), abi = disk.get('project.abi'), state = absJson(nativeState());
    failWrite = 'project.abs.map.json';
    const result = await rebind(tools, diagnosis.diagnostics.rebind.token);
    expect(result.ok).toBeFalse(); expect(result.publication.status).toBe('MIRROR_PENDING');
    const pending = await inspect(tools); expect(pending.pending.mode).toBe('export'); expect(pending.diagnostics.rebind).toBeUndefined();
    failWrite = undefined;
    const recovered: any = await tools.execute('abs_recovery', { version: 2, requestId: crypto.randomUUID(), action: 'recover' });
    expect(recovered.ok).toBeTrue(); expect(disk.get('project.abi')).toBe(abi); expect(absJson(nativeState())).toBe(state);
    expect(editor.prepareProjectCode).not.toHaveBeenCalled(); expect((await inspect(tools)).diagnostics.status).toBe('ready');
  });

  for (const chunk of [false, true]) it(`adds a declaration-backed block with sealed defaults and large data (${chunk ? 'chunk' : 'native'})`, async () => {
    if (chunk) renderWorkspace();
    const base = await baseline(), value = '通用新块文本😀'.repeat(6000);
    const result = await service.applyGeneration(base.source + `\nabs_declared_text(TEXT=${JSON.stringify(value)})`, base.generation, { chunk });
    expect(result.publication.status).toBe('COMMITTED');
    const added = editor.workspace.getBlocksByType('abs_declared_text')[0];
    expect(added.getFieldValue('TEXT')).toBe(value); expect(added.getFieldValue('FLAG')).toBe('TRUE');
    expect(roots().id).toBe('protected'); expect(roots().isDeletable()).toBeFalse();
    if (chunk) expect(added.getBoundingRectangle().top).toBeGreaterThan(roots().getBoundingRectangle().bottom);
    expect(disk.get('project.abi')!.length).toBeLessThan(6000);
    const committed = await new AbsBaselineStore(port, scope).loadCommitted();
    expect(committed!.contracts.fields[added.id]['FLAG'].type).toBe('field_checkbox');
  });

  it('validates new fields before native load and never accepts unknown declared fields', async () => {
    const base = await baseline();
    for (const code of ['abs_declared_text(FLAG="invalid")', 'abs_declared_text(UNKNOWN=1)']) {
      await expectAsync(service.applyGeneration(base.source + '\n' + code, base.generation)).toBeRejected();
    }
    expect(editor.restoreProjectWorkspaceSnapshot).not.toHaveBeenCalled(); expect(disk.has('project.abi')).toBeFalse();
  });

  it('binds a new declared variable field to an existing model without adding or renaming models', async () => {
    declare({ type: 'abs_declared_variable', message0: '%1', args0: [{ type: 'field_variable', name: 'VAR', variable: 'kept' }], output: null });
    editor.workspace.getVariableMap().createVariable('kept', '', 'model-keep');
    const base = await baseline();
    await expectAsync(service.applyGeneration(base.source + '\nabs_declared_variable(VAR="missing")', base.generation)).toBeRejected();
    expect(editor.restoreProjectWorkspaceSnapshot).not.toHaveBeenCalled();
    const result = await service.applyGeneration(base.source + '\nabs_declared_variable(VAR="kept")', base.generation);
    expect(result.publication.status).toBe('COMMITTED');
    expect(editor.workspace.getBlocksByType('abs_declared_variable')[0].getFieldValue('VAR')).toBe('model-keep');
    expect(editor.workspace.getAllVariables().map(variable => variable.getId())).toEqual(['model-keep']);
  });

  it('rejects replaced declaration provenance during a resource await before clearing', async () => {
    const base = await baseline();
    (projectDataRuntime.prepareValue as jasmine.Spy).and.callFake(async () => {
      Blockly.Blocks['abs_declared_text'].init = () => {};
    });
    await expectAsync(service.applyGeneration(base.source + '\nabs_declared_text(TEXT="new")', base.generation)).toBeRejected();
    expect(editor.restoreProjectWorkspaceSnapshot).not.toHaveBeenCalled(); expect(roots()).not.toBeNull();
  });

  it('still rejects library-added defaults on a new block instead of relaxing complete readback', async () => {
    const base = await baseline();
    editor.prepareProjectCode.and.callFake(async () => {
      editor.workspace.getBlocksByType('abs_declared_text')[0].setFieldValue('library changed', 'TEXT'); return null;
    });
    await expectAsync(service.applyGeneration(base.source + '\nabs_declared_text()', base.generation))
      .toBeRejectedWith(jasmine.objectContaining({ code: 'ABS_READBACK_MISMATCH' }));
    expect(editor.workspace.getBlocksByType('abs_declared_text')).toEqual([]); expect(roots()).not.toBeNull();
  });

  for (const chunk of [false, true]) it(`preserves real IDs/protection/dormant shadow through ${chunk ? 'chunk' : 'native'} load and same-lock ABI/ABS/map commit`, async () => {
    if (chunk) renderWorkspace();
    const base = await baseline(); const result = await apply(base, { chunk });
    expect(result.publication.status).toBe('COMMITTED'); expect(result.appliedRevision).toBeDefined();
    expect(roots().getFieldValue('TEXT')).toBe('after'); expect(roots().isDeletable()).toBeFalse();
    expect(roots().isMovable()).toBeFalse(); expect(roots().data).toBe('opaque');
    expect(nativeState().blocks.blocks[0].inputs!['VALUE'].shadow!.id).toBe('dormant');
    expect(editor.workspace.getBlockById('child')).not.toBeNull();
    expect(JSON.parse(disk.get('project.abi')!).metadata).toBe('retained');
    expect(project.publishPreparedSaveOutputs).toHaveBeenCalledTimes(1); expect(gate.blocked).toBeFalse();
    expect(await service.inspectRecovery()).toBeNull();
  });

  it('requires explicit initialization and preserves an unversioned source in the immutable record', async () => {
    disk.set('project.abs', 'legacy exact input\r\n');
    await expectAsync(service.exportGeneration()).toBeRejectedWith(jasmine.objectContaining({ code: 'ABS_INITIALIZATION_REQUIRED' }));
    const result = await service.exportGeneration({ initialize: true });
    const record = JSON.parse(disk.get(`baselines/${result.publication.generation}.json`)!);
    expect(record.inputAbs).toBe('legacy exact input\r\n'); expect(disk.has('project.abi')).toBeFalse();
  });

  it('refuses public map edits and stale generations before changing the workspace', async () => {
    const base = await baseline(); const original = absJson(nativeState());
    await expectAsync(service.applyGeneration(base.source, 'old-generation')).toBeRejected();
    disk.set('project.abs.map.json', '{}'); await expectAsync(apply(base)).toBeRejected();
    expect(absJson(nativeState())).toBe(original); expect(editor.restoreProjectWorkspaceSnapshot).not.toHaveBeenCalled();
  });

  it('will not export over an unapplied ABS edit', async () => {
    await baseline(); disk.set('project.abs', 'external edit');
    await expectAsync(service.exportGeneration()).toBeRejectedWith(jasmine.objectContaining({ code: 'ABS_SOURCE_CONFLICT' }));
    expect(disk.get('project.abs')).toBe('external edit');
  });

  it('does not rebaseline a saved ABI that diverges from the live document', async () => {
    const base = await baseline(); disk.set('project.abi', '{"external":true}');
    await expectAsync(service.exportGeneration()).toBeRejectedWith(jasmine.objectContaining({ code: 'ABS_DUAL_EDIT_CONFLICT' }));
    expect(disk.get('project.abs')).toBe(base.source); expect(await service.inspectRecovery()).toBeNull();
    expect(disk.get('project.abi')).toBe('{"external":true}');
  });

  it('allows a normal save of the current document to become the next baseline', async () => {
    const base = await baseline(); roots().setFieldValue('normally saved', 'TEXT');
    const prepared = await project.prepareSave(editor.captureProjectSnapshot().document, () => {});
    disk.set('project.abi', prepared.abiText);
    const result = await service.exportGeneration();
    expect(result.publication.status).toBe('COMMITTED'); expect(result.publication.generation).not.toBe(base.generation);
    expect(disk.get('project.abi')).toBe(prepared.abiText); expect(disk.get('project.abs')).toContain('normally saved');
  });

  it('rejects deletion of any protected type and new/dynamic shapes before native load', async () => {
    const base = await baseline(); const original = absJson(nativeState());
    for (const source of ['# ABS Schema: 2\n', base.source + '\ntext(TEXT="new")']) {
      await expectAsync(service.applyGeneration(source, base.generation)).toBeRejected();
    }
    await expectAsync(service.applyGeneration(base.source.replace('abs_sync_root(', 'other_root('), base.generation)).toBeRejected();
    await expectAsync(service.applyGeneration(base.source.trimEnd() + ' @extra:{"shape":2}\n', base.generation))
      .toBeRejectedWith(jasmine.objectContaining({ code: 'ABS_RUNTIME_SHAPE_UNSUPPORTED' }));
    expect(absJson(nativeState())).toBe(original); expect(editor.restoreProjectWorkspaceSnapshot).not.toHaveBeenCalled();
  });

  it('externalizes an edited large text and validates native readback against its full materialized value', async () => {
    const base = await baseline(); const large = '通用文本😀'.repeat(8000);
    const result = await service.applyGeneration(base.source.replace('TEXT="before"', `TEXT=${JSON.stringify(large)}`), base.generation);
    expect(result.publication.status).toBe('COMMITTED'); expect(roots().getFieldValue('TEXT')).toBe(large);
    expect(disk.get('project.abs')).toContain('$ailyProjectDataValue'); expect(disk.get('project.abi')!.length).toBeLessThan(5000);
  });

  it('a missing resource fails before clearing the existing workspace', async () => {
    const base = await baseline();
    const ref = createAilyProjectDataValue({ $ailyData: { schemaVersion: 1, id: ('sha256:' + '0'.repeat(64)) as `sha256:${string}`,
      codec: 'utf8-v1', logicalType: 'text', storage: 'raw-v1', rawLength: 50000, storedLength: 50000 } });
    await expectAsync(service.applyGeneration(base.source.replace('TEXT="before"', `TEXT=${JSON.stringify(ref)}`), base.generation)).toBeRejected();
    expect(roots().getFieldValue('TEXT')).toBe('before'); expect(editor.restoreProjectWorkspaceSnapshot).not.toHaveBeenCalled();
  });

  it('complete readback rejects a library changing requested fields and restores the full original state', async () => {
    const base = await baseline(); const original = absJson(nativeState());
    editor.prepareProjectCode.and.callFake(async () => { roots().setFieldValue('library changed', 'TEXT'); return null; });
    await expectAsync(apply(base)).toBeRejectedWith(jasmine.objectContaining({ code: 'ABS_READBACK_MISMATCH' }));
    expect(absJson(nativeState())).toBe(original); expect(disk.has('project.abi')).toBeFalse(); expect(gate.blocked).toBeFalse();
    expect(editor.restoreProjectWorkspaceSnapshot.calls.mostRecent().args[2]).toEqual(JSON.parse(original).blocks.blocks.map(block => block.id));
  });

  it('does not allow Generator model additions to bypass complete state verification', async () => {
    const base = await baseline();
    editor.prepareProjectCode.and.callFake(async () => { editor.workspace.getVariableMap().createVariable('unexpected'); return null; });
    await expectAsync(apply(base)).toBeRejectedWith(jasmine.objectContaining({ code: 'ABS_READBACK_MISMATCH' }));
    expect(editor.workspace.getAllVariables()).toEqual([]); expect(roots().getFieldValue('TEXT')).toBe('before');
  });

  it('does not let complete active-workspace readback hide changes to an inactive page', async () => {
    const base = await baseline();
    editor.prepareProjectCode.and.callFake(async () => { editor.mutateOtherPage(); return null; });
    await expectAsync(apply(base)).toBeRejectedWith(jasmine.objectContaining({ code: 'ABS_PROJECT_ENVELOPE_CHANGED' }));
    expect(disk.has('project.abi')).toBeFalse();
  });

  it('external ABI conflict before commit restores memory but never overwrites external bytes', async () => {
    const base = await baseline(); const originalPrepare = project.prepareSave.bind(project);
    spyOn(project, 'prepareSave').and.callFake(async (...args) => { const prepared = await originalPrepare(...args); disk.set('project.abi', '{"external":true}'); return prepared; });
    expect((await apply(base)).publication.status).toBe('CONFLICT');
    expect(roots().getFieldValue('TEXT')).toBe('before'); expect(disk.get('project.abi')).toBe('{"external":true}');
  });

  it('post-ABI mirror failure keeps the applied state, permits disk-only inspection/recovery, and never clears quarantine', async () => {
    const base = await baseline(); failWrite = 'project.abs';
    const result = await apply(base); expect(result.publication.status).toBe('MIRROR_PENDING'); expect(result.requiresReload).toBeTrue();
    expect(roots().getFieldValue('TEXT')).toBe('after'); expect(gate.blocked).toBeTrue();
    const abi = disk.get('project.abi'); expect((await service.inspectRecovery())!.abiSaved).toBeTrue();
    failWrite = undefined;
    expect((await service.recoverGeneration())!.status).toBe('COMMITTED'); expect(disk.get('project.abi')).toBe(abi);
    expect(await service.recoverGeneration()).toBeNull(); expect(gate.blocked).toBeTrue();
    expect(editor.restoreProjectWorkspaceSnapshot).not.toHaveBeenCalled();
  });

  it('an unknown commit acknowledgement never triggers workspace rollback', async () => {
    const base = await baseline(); loseCommitReply = true;
    await expectAsync(apply(base)).toBeRejectedWithError('lost commit acknowledgement');
    expect(roots().getFieldValue('TEXT')).toBe('after'); expect(gate.blocked).toBeTrue();
    expect(editor.restoreProjectWorkspaceSnapshot).not.toHaveBeenCalled();
  });

  it('a definite pre-ABI failure restores memory and can be explicitly abandoned without deleting its baseline', async () => {
    const base = await baseline(); failWrite = 'project.abi';
    const result = await apply(base); expect(result.publication.status).toBe('NOT_COMMITTED');
    expect(roots().getFieldValue('TEXT')).toBe('before'); expect(gate.blocked).toBeFalse();
    expect((await service.inspectRecovery())!.abiSaved).toBeFalse();
    expect((await service.recoverGeneration())!.status).toBe('NOT_COMMITTED');
    await service.abandonGeneration(result.publication.generation);
    expect(await service.inspectRecovery()).toBeNull();
    expect(disk.has(`baselines/${result.publication.generation}.json`)).toBeTrue(); expect(disk.has('project.abi')).toBeFalse();
  });

  it('a failed rollback is reported and quarantined, never automatically retried', async () => {
    const base = await baseline();
    editor.prepareProjectCode.and.callFake(async () => { roots().setFieldValue('changed', 'TEXT'); return null; });
    editor.restoreProjectWorkspaceSnapshot.and.throwError('restore failed');
    await expectAsync(apply(base)).toBeRejectedWith(jasmine.objectContaining({ code: 'ABS_ROLLBACK_FAILED' }));
    expect(gate.blocked).toBeTrue(); expect(editor.restoreProjectWorkspaceSnapshot).toHaveBeenCalledTimes(1);
  });

  it('restores event grouping/undo policy without manufacturing serialized block flags', async () => {
    const base = await baseline(); const oldGroup = Blockly.Events.getGroup(), oldUndo = Blockly.Events.getRecordUndo();
    Blockly.Events.setGroup('caller-group'); Blockly.Events.setRecordUndo(false);
    try {
      await apply(base);
      expect(Blockly.Events.getGroup()).toBe('caller-group'); expect(Blockly.Events.getRecordUndo()).toBeFalse();
      expect(roots().isDeletable()).toBeFalse(); expect(Blockly.Events.isEnabled()).toBeTrue();
    } finally { Blockly.Events.setGroup(oldGroup); Blockly.Events.setRecordUndo(oldUndo); }
  });

  it('post-commit derived output failure is a warning, not a source rollback', async () => {
    const base = await baseline(); (project.publishPreparedSaveOutputs as jasmine.Spy).and.rejectWith(new Error('header disk full'));
    const result = await apply(base);
    expect(result.publication.status).toBe('COMMITTED'); expect(result.warnings.length).toBe(1);
    expect(roots().getFieldValue('TEXT')).toBe('after'); expect(gate.blocked).toBeFalse();
  });

  it('queued work is bound to its original page/project/runtime, not a later activation', async () => {
    const pending = service.exportGeneration(); project.currentProjectPath = 'D:/new-project';
    await expectAsync(pending).toBeRejectedWith(jasmine.objectContaining({ code: 'ABS_CONTEXT_STALE' }));
    expect(disk.size).toBe(0);
  });

  it('an asynchronous preparation edit is retained rather than rolled back as an import', async () => {
    const base = await baseline();
    (projectDataRuntime.prepareValue as jasmine.Spy).and.callFake(async () => { roots().setFieldValue('later edit', 'TEXT'); });
    await expectAsync(apply(base)).toBeRejectedWith(jasmine.objectContaining({ code: 'ABS_REVISION_STALE' }));
    expect(roots().getFieldValue('TEXT')).toBe('later edit'); expect(editor.restoreProjectWorkspaceSnapshot).not.toHaveBeenCalled();
  });

  it('publishes selection context only for committed generations, not preview or uncertain saves', async () => {
    await service.exportGeneration({ publish: false });
    expect(editor.publishAbsContext).not.toHaveBeenCalled();
    const base = await baseline();
    expect(editor.publishAbsContext).toHaveBeenCalledTimes(1);
    failWrite = 'project.abs';
    expect((await apply(base)).requiresReload).toBeTrue();
    expect(editor.publishAbsContext).toHaveBeenCalledTimes(1);
  });

  it('queues direct Agent mutations behind export and rejects stale queued owners', async () => {
    const adapter = new BlocklyEditorAutomationAdapter(project as any, editor);
    let release!: () => void;
    (projectDataRuntime.flushPending as jasmine.Spy).and.returnValue(new Promise<void>(resolve => release = resolve));
    const exporting = service.exportGeneration();
    const mutate = jasmine.createSpy('mutation').and.resolveTo('done');
    const pending = adapter.runWorkspaceOperation(mutate);
    await Promise.resolve(); expect(mutate).not.toHaveBeenCalled();
    release(); await exporting; expect(await pending).toBe('done');
    const stale = adapter.runWorkspaceOperation(mutate); project.currentProjectPath = 'D:/other';
    await expectAsync(stale).toBeRejectedWithError(/stale/);
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('blocks direct workspace access during a lease and invalidates queued board reconfiguration', async () => {
    const adapter = new BlocklyEditorAutomationAdapter(project as any, editor);
    const lease = editor.acquireWorkspaceEditLease();
    expect(() => adapter.getWorkspace()).toThrow();
    lease.release(); expect(adapter.getWorkspace()).toBe(editor.workspace);
    const runtime = new BlocklyGeneratorRuntimeService();
    runtime.activate({ mode: 'arduino', getWorkspace: () => editor.workspace });
    try {
      const mutate = jasmine.createSpy('mutate').and.resolveTo();
      const pending = adapter.runWorkspaceOperation(mutate); runtime.updateBoardConfig({ pins: [99] });
      await expectAsync(pending).toBeRejectedWithError(/stale/); expect(mutate).not.toHaveBeenCalled();
    } finally { runtime.destroy(); }
  });

  for (const mode of ['export', 'apply']) it(`rejects inactive-page edits during ${mode} preparation before loading`, async () => {
    const base = await baseline(), clear = spyOn(editor.workspace, 'clear').and.callThrough();
    (projectDataRuntime.prepareValue as jasmine.Spy).and.callFake(async () => editor.mutateOtherPage());
    await expectAsync(mode === 'export' ? service.exportGeneration() : apply(base))
      .toBeRejectedWith(jasmine.objectContaining({ code: 'ABS_REVISION_STALE' }));
    expect(clear).not.toHaveBeenCalled(); expect(disk.get('project.abs')).toBe(base.source);
    expect(gate.blocked).toBeFalse();
  });

  it('holds queued saves through chunk loading, readback and committed publication', async () => {
    renderWorkspace(); const base = await baseline();
    let queued: Promise<void> | undefined;
    const saving = jasmine.createSpy('queuedSave').and.callFake(async () => {
      expect(roots().getFieldValue('TEXT')).toBe('after');
      expect(disk.get('project.abs')).toContain('TEXT="after"');
    });
    const result = await apply(base, { chunk: true, onProgress: () => {
      queued ??= editor.runProjectOperation(saving);
      expect(saving).not.toHaveBeenCalled();
    } });
    expect(result.publication.status).toBe('COMMITTED');
    expect(queued).toBeDefined(); await queued; expect(saving).toHaveBeenCalledTimes(1);
  });
});
