import { assertNoOversizedInlineValues, collectProjectDataPayloads } from '@domain/project/public-api';
import { AbsFieldDefinition, normalizeAbsSerializedField, resolveAbsFieldValue } from './abs-field-values';
import { absJson, fingerprintAbsNodes, indexAbsAbi, indexAbsSyntax, validateAbsProjection } from './abs-identity-map';
import { assertAbsProtectedBlocks } from './abs-import-policy';
import { AbsSyntaxOptions, parseAbsSyntax } from './abs-syntax';
import { AbsAbiBlock, AbsAbiWorkspace, AbsProjection, AbsProjectionContracts, AbsSourceRange, AbsSyntaxNode, AbsSyncError, getAbsFieldDefinition } from './abs-state';
import { AbsSymbols } from './abs-symbols';
import { getAbsProcedureReferences } from './abs-procedures';
import type { AbsBlockShapeContract } from './abs-declarative-contracts';
import { AbsVariableCreationIntent, prepareAbsVariableCreations } from './abs-variable-intents';
import { absSyntaxOptions } from './abs-syntax-contracts';
import { prepareAbsStructuralSyntax } from './abs-structural-syntax';
import { absDeclarationRequestId, prepareAbsDeclarationIntents } from './abs-declaration-intents';
import type { VariableDeclarationContract } from '../../../editors/blockly-editor/services/blockly-variable-declaration-contract';
import type { AbsNativeBinding } from './abs-native-binding';
import { adoptAbsNativeDefaults } from './abs-native-defaults';
import { traceAbsSourceEdits, type AbsSourceEdits } from './abs-edit-provenance';

export interface AbsReconcileOptions extends AbsSyntaxOptions {
  /** Exact text-edit provenance, replayed against the immutable generation. */
  sourceEdits?: AbsSourceEdits;
  /** Pure definitions captured for this runtime session, never a global Blockly lookup. */
  fieldDefinition?: (blockType: string, fieldName: string, blockId?: string) => AbsFieldDefinition | undefined;
  newId?: (node: AbsSyntaxNode) => string;
  /** Internal native evidence for this exact source, never supplied by the Agent. */
  nativeBinding?: AbsNativeBinding;
  variableCreation?: AbsVariableCreationIntent;
  declaration?: (type: string) => VariableDeclarationContract | undefined;
  /** Host-owned prepared shape for new IDs, never inferred from another instance. */
  blockContract?: (type: string, extraState?: unknown, fields?: Readonly<Record<string, unknown>>) => AbsBlockShapeContract | undefined;
  /** Pure host adapter; may prepare only this detached block, never live state. */
  prepareBlock?: (block: AbsAbiBlock, previous: AbsAbiBlock | undefined, workspace: AbsAbiWorkspace, contracts: AbsProjectionContracts) => void;
  /** Captured pure adapter coverage, not permission to omit final native ABI verification. */
  hostPrepared?: (type: string) => boolean;
}
export interface AbsReconcileResult {
  workspace: AbsAbiWorkspace;
  retained: string[];
  added: string[];
  removed: string[];
}

export interface AbsLiteralBinding extends AbsSourceRange { jsonPointer: string }
/** Unprepared payloads: may contain large inline values. Never load/save this draft directly. */
export interface AbsReconcileDraft extends AbsReconcileResult {
  identities: Array<{ start: number; id: string }>;
  literals: AbsLiteralBinding[];
  /** Newly adopted native defaults have no source literals, including nested payloads. */
  implicitBlockIds?: string[];
  /** Known baseline protocols plus explicit field definitions used for this candidate; not complete runtime coverage. */
  contracts: AbsProjectionContracts;
}

/** Strict pure entrypoint. Only the resource coordinator may consume the unprepared draft. */
export async function reconcileAbs(
  baseline: AbsProjection, editedAbs: string, options: AbsReconcileOptions = {},
): Promise<AbsReconcileResult> {
  const { literals, implicitBlockIds, contracts, identities, ...result } = await reconcileAbsDraft(baseline, editedAbs, options);
  assertNoOversizedInlineValues(result.workspace);
  return result;
}

/**
 * Deterministic merge against a host-owned baseline. Ambiguity is a result, not a
 * reason to recreate identities. Persistence/runtime validation live outside it.
 */
export async function reconcileAbsDraft(
  baseline: AbsProjection,
  editedAbs: string,
  options: AbsReconcileOptions = {},
): Promise<AbsReconcileDraft> {
  // Detach before awaiting; mutable caller state cannot race baseline validation.
  baseline = JSON.parse(absJson(baseline));
  const variableCreation = options.variableCreation ? JSON.parse(absJson(options.variableCreation)) : undefined;
  const nativeBinding = options.nativeBinding ? structuredClone(options.nativeBinding) : undefined;
  const sourceEdits = options.sourceEdits ? structuredClone(options.sourceEdits) : undefined;
  if (nativeBinding && nativeBinding.source !== editedAbs) throw new AbsSyncError('ABS_NATIVE_BINDING_STALE', 'Native binding belongs to different ABS bytes.');
  await validateAbsProjection(baseline);
  const candidate: AbsAbiWorkspace = JSON.parse(absJson(baseline.workspace));
  prepareAbsVariableCreations(candidate, variableCreation);
  if (editedAbs === baseline.abs && !sourceEdits) {
    return { workspace: candidate, literals: [], identities: [], contracts: baseline.contracts,
      added: [], removed: [], retained: [...indexAbsAbi(baseline.workspace).keys()] };
  }
  const syntax = absSyntaxOptions(baseline.workspace, baseline.contracts, {
    ...options,
    prepareExtraState: node => {
      const prepared = options.prepareExtraState?.(node);
      if (prepared !== undefined) return prepared;
      const shape = options.blockContract?.(node.type);
      return prepareAbsStructuralSyntax(node, shape?.mutation, shape?.argumentOrder);
    },
  });
  const original = parseAbsSyntax(baseline.abs, absSyntaxOptions(baseline.workspace, baseline.contracts));
  const edited = nativeBinding?.syntax ?? parseAbsSyntax(editedAbs, syntax);
  const nativeInstances = new Map(nativeBinding?.instances.map(instance => [instance.start, instance]));
  const hostCalls = new Map(nativeBinding?.hostCalls?.map(call => [call.start, call]));
  if (nativeBinding && (nativeInstances.size !== nativeBinding.instances.length
    || hostCalls.size !== (nativeBinding.hostCalls?.length ?? 0)
    || nativeInstances.size + hostCalls.size !== indexAbsSyntax(edited).length
    || indexAbsSyntax(edited).some(({ node }) => {
      const hosted = hostCalls.get(node.start), native = nativeInstances.get(node.start);
      return hosted ? !!native || hosted.type !== node.type || !options.prepareBlock || !options.hostPrepared?.(node.type)
        : !native || native.type !== node.type;
    }))) throw new AbsSyncError('ABS_NATIVE_BINDING_INVALID', 'Each call requires native evidence or a captured host preparation adapter.');
  const subtreeFingerprints = new Map<AbsSyntaxNode, string>();
  for (const roots of [original, edited]) {
    const entries = indexAbsSyntax(roots);
    const fingerprints = await fingerprintAbsNodes(entries);
    entries.forEach(entry => subtreeFingerprints.set(entry.node, fingerprints.get(entry.path)!));
  }
  const bindings = new Map(baseline.map.nodes.map(binding => [binding.astPath, binding.blockId]));
  const originalIds = new Map(indexAbsSyntax(original).map(entry => [entry.node, bindings.get(entry.path)!]));
  const abiBlocks = indexAbsAbi(baseline.workspace);
  const matches = new Map<AbsSyntaxNode, AbsSyntaxNode>();
  const traced = traceAbsSourceEdits(baseline.abs, editedAbs, original, edited, sourceEdits);
  const used = new Set<AbsSyntaxNode>();
  const match = (before: AbsSyntaxNode, after: AbsSyntaxNode) => {
    if (used.has(before) || matches.has(after)) throw new AbsSyncError('ABS_IDENTITY_AMBIGUOUS', 'Identity matched more than once.', after);
    matches.set(after, before);
    used.add(before);
  };
  const signatureCache = new Map<AbsSyntaxNode, string>();
  const signature = (node: AbsSyntaxNode): string => {
    if (!signatureCache.has(node)) {
      signatureCache.set(node, absJson({
        type: node.type,
        fields: Object.fromEntries(Object.entries(node.fields).map(([key, value]) => [key, value.value])),
        disabled: node.disabled,
        ...(Object.hasOwn(node, 'extraState') ? { extraState: node.extraState } : {}),
        inputs: Object.fromEntries(Object.keys(node.inputs).sort().map(name => [name,
          node.inputs[name] ? subtreeFingerprints.get(node.inputs[name]!) : null,
        ])),
      }));
    }
    return signatureCache.get(node)!;
  };
  const chain = (node: AbsSyntaxNode | undefined | null): AbsSyntaxNode[] => {
    const result: AbsSyntaxNode[] = [];
    for (let current = node; current; current = current.next) result.push(current);
    return result;
  };
  const matchGroup = (before: AbsSyntaxNode[], after: AbsSyntaxNode[]) => {
    // A text edit can retain a call token without retaining any of its values.
    // Keep ownership scoped: source tracking is not authorization for a move.
    for (const node of after) {
      const previous = traced.get(node);
      if (previous && !before.includes(previous)) throw new AbsSyncError('ABS_IDENTITY_AMBIGUOUS',
        'Recorded text edits moved a call across owners; an explicit move intent is required.', node, [originalIds.get(previous)!]);
      if (previous) match(previous, node);
    }
    const pendingBefore = before.filter(node => !used.has(node));
    const pendingAfter = after.filter(node => !matches.has(node));
    // Identical sequences in an already confirmed owner/input have positional
    // identity. Changed repeated sequences do not: deleting either is possible.
    if (pendingBefore.length === pendingAfter.length && pendingBefore.every((node, i) => signature(node) === signature(pendingAfter[i]))) {
      pendingBefore.forEach((node, i) => match(node, pendingAfter[i]));
    } else {
      const group = (nodes: AbsSyntaxNode[], key: (node: AbsSyntaxNode) => string) => {
        const result = new Map<string, AbsSyntaxNode[]>();
        nodes.forEach(node => {
          const value = key(node);
          const members = result.get(value);
          if (members) members.push(node);
          else result.set(value, [node]);
        });
        return result;
      };
      // Type groups are bounded by confirmed ownership; arbitrary global matching
      // would attach UI/protection metadata to an unrelated same-type block.
      const oldTypes = group(pendingBefore, node => node.type);
      const newTypes = group(pendingAfter, node => node.type);
      for (const [type, newNodes] of newTypes) {
        const oldNodes = oldTypes.get(type) ?? [];
        if (oldNodes.length === 1 && newNodes.length === 1) {
          match(oldNodes[0], newNodes[0]);
          continue;
        }
        if (!oldNodes.length) continue;
        const oldSignatures = group(oldNodes, signature);
        const newSignatures = group(newNodes, signature);
        for (const [key, nodes] of newSignatures) {
          const previous = oldSignatures.get(key) ?? [];
          if (nodes.length === 1 && previous.length === 1) match(previous[0], nodes[0]);
        }
        const remainingOld = oldNodes.filter(node => !used.has(node));
        const remainingNew = newNodes.filter(node => !matches.has(node));
        if (remainingOld.length === 1 && remainingNew.length === 1) {
          match(remainingOld[0], remainingNew[0]);
        } else if (remainingOld.length && remainingNew.length) {
          throw new AbsSyncError('ABS_IDENTITY_AMBIGUOUS', 'Repeated changed calls lack unambiguous text-edit or content identity evidence.',
            remainingNew[0], remainingOld.map(node => originalIds.get(node)!));
        }
      }
    }
    for (const afterNode of after) {
      const beforeNode = matches.get(afterNode);
      if (!beforeNode) continue;
      for (const name of new Set([...Object.keys(beforeNode.inputs), ...Object.keys(afterNode.inputs)])) {
        matchGroup(chain(beforeNode.inputs[name]), chain(afterNode.inputs[name]));
      }
    }
  };
  matchGroup(original, edited);
  // Root-level next is not part of the roots array and needs its own owner group.
  for (const root of edited) {
    const before = matches.get(root);
    if (before) matchGroup(chain(before.next), chain(root.next));
  }

  // An unmatched same-type node elsewhere might be a move, not a deletion/new
  // block. Defer cross-owner moves to explicit host operations rather than guess.
  const oldEntries = indexAbsSyntax(original);
  const newEntries = indexAbsSyntax(edited);
  const unmatchedByType = new Map<string, AbsSyntaxNode[]>();
  for (const { node } of oldEntries) {
    if (used.has(node)) continue;
    const members = unmatchedByType.get(node.type);
    if (members) members.push(node);
    else unmatchedByType.set(node.type, [node]);
  }
  for (const { node } of newEntries) {
    if (!matches.has(node) && unmatchedByType.has(node.type)) {
      throw new AbsSyncError('ABS_IDENTITY_AMBIGUOUS', 'Potential cross-owner move requires explicit identity.', node,
        unmatchedByType.get(node.type)!.map(old => originalIds.get(old)!));
    }
  }

  const contracts = baseline.contracts;
  if (options.declaration) {
    const requestId = await absDeclarationRequestId(baseline.map.generation, editedAbs);
    prepareAbsDeclarationIntents(edited, candidate, node => {
      const old = matches.get(node);
      return old ? abiBlocks.get(originalIds.get(old)!) : undefined;
    }, options.declaration, requestId);
  }
  const symbols = new AbsSymbols(candidate, baseline.document, baseline.contracts);
  const ids = new Set(abiBlocks.keys());
  const added: string[] = [];
  const retained: string[] = [];
  const sources = new Map<string, AbsSyntaxNode>();
  const defaultIds = new Set<string>();
  const build = (node: AbsSyntaxNode, root: boolean): AbsAbiBlock => {
    const matched = matches.get(node);
    const previous = matched ? abiBlocks.get(originalIds.get(matched)!)! : undefined;
    const id = previous?.id ?? (options.newId ?? (() => crypto.randomUUID()))(node);
    if (!previous && (!id || ids.has(id))) throw new AbsSyncError('ABS_DUPLICATE_ID', 'New block ID is not unique.', node, [id]);
    ids.add(id);
    sources.set(id, node);
    (previous ? retained : added).push(id);
    const nativeInstance = nativeInstances.get(node.start);
    if (nativeBinding && !nativeInstance && !hostCalls.has(node.start)) throw new AbsSyncError('ABS_NATIVE_BINDING_INVALID', 'Native instance does not match this call.', node);
    const block: AbsAbiBlock = previous ? JSON.parse(absJson(previous)) : { ...structuredClone(nativeInstance?.seed), type: node.type, id };
    if (node.disabled !== (matched?.disabled ?? false)) {
      throw new AbsSyncError('ABS_STATE_EDIT_REQUIRES_HOST', 'Change disabled state through an explicit host operation.', node, [id]);
    }
    const declaredShape = options.blockContract?.(node.type, node.extraState, Object.fromEntries(Object.entries(node.fields).map(([name, token]) => [name, token.value])));
    const preparedShape = nativeInstance?.shape ?? (!previous || declaredShape?.mutation || declaredShape?.fieldShape ? declaredShape : undefined);
    // Only a per-call native execution can remove fields after a configuration change.
    // Retained fields keep their opaque persisted state unless explicitly edited below.
    block.fields = { ...(preparedShape?.defaults ?? {}), ...Object.fromEntries(Object.entries(block.fields ?? {})
      .filter(([name]) => !nativeInstance || Object.hasOwn(nativeInstance.shape.fields, name))) };
    if (preparedShape) setJsonMember(contracts.fields, id, JSON.parse(absJson(preparedShape.fields)));
    if (preparedShape?.argumentOrder) setJsonMember(contracts.syntax ??= Object.create(null), id, preparedShape.argumentOrder);
    if (preparedShape?.fieldShape) setJsonMember(contracts.selectors ??= Object.create(null), id, [...new Set(preparedShape.fieldShape.map(rule => rule.field))]);
    if (nativeInstance && contracts.selectors) delete contracts.selectors[id];
    for (const [name, token] of Object.entries(node.fields)) {
      // Formatting or another field's edit cannot rewrite an unchanged persisted value.
      const originalToken = matched?.fields[name];
      try {
        const definition = preparedShape?.fields[name] ?? options.fieldDefinition?.(node.type, name, previous?.id)
          ?? (previous ? getAbsFieldDefinition(baseline.contracts, previous.id, name) : undefined);
        if (token.reference && definition?.symbol?.kind !== 'variable') throw new Error('$ references require a variable field.');
        if (originalToken && absJson(token.value) === absJson(originalToken.value)) continue;
        if (definition) {
          if (!Object.hasOwn(contracts.fields, id)) setJsonMember(contracts.fields, id, {});
          setJsonMember(contracts.fields[id], name, JSON.parse(absJson(definition)));
        }
        const value = definition?.symbol
          ? symbols.resolve(token, definition.symbol, previous?.fields?.[name])
          : resolveAbsFieldValue(token, definition);
        setJsonMember(block.fields, name, definition?.type === 'field_checkbox' ? normalizeAbsSerializedField(value, definition) : value);
      } catch (error) {
        throw new AbsSyncError(error instanceof AbsSyncError ? error.code : 'ABS_FIELD_INVALID', `${node.type}.${name}: ${String(error)}`, node, [id]);
      }
    }
    if (Object.hasOwn(node, 'extraState')) block.extraState = node.extraState;
    // Native execution already verified the hydrated explicit extraState. Keep
    // its source envelope here; shape equality belongs after materialization.
    if (nativeInstance ? !Object.hasOwn(node, 'extraState') : preparedShape?.mutation || preparedShape?.fieldShape) {
      if (preparedShape.extraState === undefined) delete block.extraState;
      else block.extraState = preparedShape.extraState;
    }
    options.prepareBlock?.(block, previous, candidate, contracts);
    const defaultInputs = previous ? new Set<string>() : adoptAbsNativeDefaults(nativeBinding, node, block, { ids, contracts, added, defaultIds });
    const inputs = { ...block.inputs };
    for (const name of new Set([...Object.keys(inputs), ...Object.keys(node.inputs)])) {
      if (defaultInputs.has(name)) continue;
      const originalInput = Object.hasOwn(inputs, name) ? inputs[name] : undefined;
      const child = node.inputs[name];
      if (preparedShape && !Object.hasOwn(preparedShape.inputs, name) && !child) {
        // An explicit, proven shape change removes the slot itself, including its
        // dormant shadow. Ordinary disconnection must still preserve that shadow.
        delete inputs[name]; continue;
      }
      if (child) {
        const next = build(child, false);
        // A visible shadow stays a shadow only while its original identity remains.
        if (!originalInput?.block && originalInput?.shadow?.id === next.id) setJsonMember(inputs, name, { ...originalInput, shadow: next });
        else setJsonMember(inputs, name, { ...originalInput, block: next });
      } else if (originalInput?.block && originalInput.shadow) {
        const { block: removed, ...fallback } = originalInput;
        setJsonMember(inputs, name, fallback);
      } else if (originalInput?.shadow) {
        // Removing a visible shadow is not a reliable instruction to delete a
        // default connection: require a shape/state operation instead.
        throw new AbsSyncError('ABS_CONNECTION_EDIT_REQUIRES_HOST', 'Cannot silently remove a fallback shadow.', node, [id]);
      } else if (!originalInput || originalInput.block || !Object.hasOwn(node.inputs, name)) delete inputs[name];
    }
    if (Object.keys(inputs).length) block.inputs = inputs;
    else delete block.inputs;
    if (node.next) block.next = { ...block.next, block: build(node.next, false) };
    else delete block.next;
    if (!root) { delete block['x']; delete block['y']; }
    else if (!previous) { block['x'] = 30; block['y'] = 30 + added.length * 100; }
    if (!Object.keys(block.fields).length && !previous?.fields) delete block.fields;
    return block;
  };
  candidate.blocks.blocks = edited.map(node => build(node, true));
  assertAbsProtectedBlocks(baseline.workspace, candidate);
  getAbsProcedureReferences(candidate, baseline.contracts.procedures);
  const afterIds = indexAbsAbi(candidate);
  // Use the same payload traversal as resource externalization: no second ABI graph walker.
  const literals: AbsLiteralBinding[] = [];
  for (const payload of collectProjectDataPayloads(candidate)) {
    const node = sources.get(payload.blockId ?? '');
    const range = payload.fieldName !== undefined ? node?.fieldRanges[payload.fieldName]
      : payload.key === 'extraState' ? node?.extraRange : undefined;
    if (range) literals.push({ ...range, jsonPointer: payload.jsonPointer });
  }
  return { workspace: candidate, literals, ...(defaultIds.size ? { implicitBlockIds: [...defaultIds] } : {}), contracts, identities: [...sources].map(([id, node]) => ({ start: node.start, id })),
    added, retained, removed: [...abiBlocks.keys()].filter(id => !afterIds.has(id)) };
}

function setJsonMember(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
}
