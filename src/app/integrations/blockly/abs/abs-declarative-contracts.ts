import { AbsFieldDefinition, normalizeAbsSerializedField, readAbsFieldToken, resolveAbsFieldValue } from './abs-field-values';
import { AbsAbiBlock, AbsSyncError } from './abs-state';
import { absJson } from './abs-identity-map';
import type { DeclarativeBlockSnapshot } from '../../../editors/blockly-editor/services/blockly-declarative-block-catalog';
import type { AbsProcedureStateContract } from './abs-procedures';
import type { AbsArgumentDefinition } from './abs-syntax';
import { parseBlockDefinition } from './block-definition.model';

/** Complete persisted shape for a new block. Dynamic adapters must supply the same
 * explicit contract; runtime defaults are not permission to ignore extra state.
 */
export interface AbsBlockShapeContract {
  fields: Record<string, AbsFieldDefinition>;
  defaults: Record<string, unknown>;
  inputs: Record<string, 'value' | 'statement'>;
  output: boolean;
  previous: boolean;
  next: boolean;
  argumentOrder?: readonly AbsArgumentDefinition[];
  /** Exact prepared serializer output, supplied only by a trusted dynamic adapter. */
  extraState?: unknown;
  procedure?: AbsProcedureStateContract;
}

/** Pure, deliberately bounded JSON semantics. Extensions/mutators/custom field
 * factories require a host adapter; never execute their callbacks to discover state.
 */
export function compileAbsDeclarativeContract(json: Record<string, any>, supportsUiExtension: (name: string) => boolean = () => false): AbsBlockShapeContract | undefined {
  const extensions = json?.['extensions'];
  if (!json || typeof json['type'] !== 'string' || Object.hasOwn(json, 'mutator')
    || extensions !== undefined && (!Array.isArray(extensions) || extensions.some(name => typeof name !== 'string' || !supportsUiExtension(name)))
    || Object.keys(json).some(key => ['extraState', 'data', 'deletable', 'movable', 'editable', 'collapsed'].includes(key))) return undefined;
  const fields: AbsBlockShapeContract['fields'] = Object.create(null), defaults = Object.create(null), inputs = Object.create(null);
  const names = new Set<string>();
  for (const key of Object.keys(json).filter(key => /^args\d+$/.test(key))) {
    if (!Array.isArray(json[key])) return undefined;
    for (const arg of json[key]) {
      if (!arg || typeof arg.type !== 'string') return undefined;
      if (['input_dummy', 'input_end_row', 'field_label', 'field_image'].includes(arg.type)) continue;
      if (typeof arg.name !== 'string' || !arg.name || names.has(arg.name)) return undefined;
      names.add(arg.name);
      if (arg.type === 'input_value' || arg.type === 'input_statement') {
        inputs[arg.name] = arg.type === 'input_value' ? 'value' : 'statement'; continue;
      }
      const field: AbsFieldDefinition = { type: arg.type };
      let value: unknown;
      switch (arg.type) {
        case 'field_input': case 'field_label_serializable':
          if (arg.text !== undefined && typeof arg.text !== 'string') return undefined;
          value = arg.text ?? ''; break;
        case 'field_number':
          for (const name of ['min', 'max', 'precision'] as const) {
            if (arg[name] !== undefined) {
              if (typeof arg[name] !== 'number' || !Number.isFinite(arg[name])) return undefined;
              field[name] = arg[name];
            }
          }
          value = arg.value ?? 0; break;
        case 'field_checkbox': value = arg.checked ?? false; break;
        case 'field_dropdown':
          if (!Array.isArray(arg.options) || !arg.options.length
            || arg.options.some(option => !Array.isArray(option) || option.length !== 2 || typeof option[1] !== 'string')) return undefined;
          field.options = arg.options.map(option => [null, option[1]]);
          value = arg.options[0][1]; break;
        case 'field_variable':
          if (arg.variableTypes !== undefined && (!Array.isArray(arg.variableTypes) || arg.variableTypes.some(type => typeof type !== 'string'))) return undefined;
          field.symbol = { kind: 'variable', storage: 'variable-state', ...(arg.variableTypes ? { allowedTypes: arg.variableTypes } : {}) };
          // A variable must resolve an explicit existing model, never auto-create a default.
          fields[arg.name] = field; continue;
        default: return undefined;
      }
      if (typeof value === 'string' && value.includes('%{')) return undefined;
      try { defaults[arg.name] = normalizeAbsSerializedField(resolveAbsFieldValue(readAbsFieldToken(absJson(value)), field), field); }
      catch { return undefined; } // Invalid/clamped defaults are not a verified shape.
      fields[arg.name] = field;
    }
  }
  // Reuse the existing ABS definition parser's original order. This compiler only
  // validates persisted shape/defaults; it must not invent another parameter order.
  const argumentOrder = parseBlockDefinition(json, '')!.argsOrder.filter(argument =>
    Object.hasOwn(argument.kind === 'field' ? fields : inputs, argument.name));
  return { fields, defaults, inputs, argumentOrder, output: Object.hasOwn(json, 'output'),
    previous: Object.hasOwn(json, 'previousStatement'), next: Object.hasOwn(json, 'nextStatement') };
}

export function captureAbsDeclarativeContracts(snapshot: DeclarativeBlockSnapshot) {
  const cache = new Map<string, AbsBlockShapeContract | undefined>();
  return {
    assertCurrent: snapshot.assertCurrent,
    get: (type: string, extraState?: unknown) => {
      snapshot.assertCurrent();
      if (extraState !== undefined && extraState !== null) return undefined;
      if (!cache.has(type)) {
        const json = snapshot.get(type);
        cache.set(type, json ? compileAbsDeclarativeContract(json, snapshot.supportsUiExtension) : undefined);
      }
      return cache.get(type);
    },
  };
}

export function assertAbsDeclaredBlockShape(block: AbsAbiBlock, contract: AbsBlockShapeContract): void {
  const fail = (detail: string): never => { throw new AbsSyncError('ABS_RUNTIME_SHAPE_UNSUPPORTED', `${block.type}: ${detail}`, undefined, [block.id]); };
  if (absJson(block.extraState ?? null) !== absJson(contract.extraState ?? null)) fail('Unverified extraState.');
  if (absJson(Object.keys(block.fields ?? {}).sort()) !== absJson(Object.keys(contract.fields).sort())) fail('Fields differ from the prepared shape.');
  for (const name of Object.keys(block.inputs ?? {})) if (!Object.hasOwn(contract.inputs, name)) fail(`Unknown input ${name}.`);
  if (block.next && !contract.next) fail('Block has no next connection.');
}
