import { assertNoOversizedInlineValues, collectProjectDataPayloads } from '@domain/project/public-api';
import { AbsFieldDefinition, normalizeAbsSerializedField, resolveAbsFieldValue } from './abs-field-values';
import { absJson, fingerprintAbsNodes, hashAbsText, indexAbsAbi, indexAbsSyntax, validateAbsProjection } from './abs-identity-map';
import { assertAbsProtectedBlocks } from './abs-import-policy';
import { AbsSyntaxOptions, parseAbsSyntax } from './abs-syntax';
import { AbsAbiBlock, AbsAbiWorkspace, AbsProjection, AbsProjectionContracts, AbsSourceRange, AbsSyntaxNode, AbsSyncError, getAbsFieldDefinition } from './abs-state';
import { AbsSymbols } from './abs-symbols';
import { getAbsProcedureReferences } from './abs-procedures';
import type { AbsBlockShapeContract } from './abs-declarative-contracts';
import { AbsVariableCreationIntent, prepareAbsVariableCreations } from './abs-variable-intents';
import { absSyntaxOptions } from './abs-syntax-contracts';
import { prepareAbsDeclarationIntents } from './abs-declaration-intents';
import type { VariableDeclarationContract } from '../../../editors/blockly-editor/services/blockly-variable-declaration-contract';

export interface AbsReconcileOptions extends AbsSyntaxOptions {
  /** Pure definitions captured for this runtime session, never a global Blockly lookup. */
  fieldDefinition?: (blockType: string, fieldName: string, blockId?: string) => AbsFieldDefinition | undefined;
  newId?: () => string;
  variableCreation?: AbsVariableCreationIntent;
  declaration?: (type: string) => VariableDeclarationContract | undefined;
  /** Host-owned prepared shape for new IDs, never inferred from another instance. */
  blockContract?: (type: string, extraState?: unknown) => AbsBlockShapeContract | undefined;
  /** Pure host adapter; may prepare only this detached block, never live state. */
  prepareBlock?: (block: AbsAbiBlock, previous: AbsAbiBlock | undefined, workspace: AbsAbiWorkspace, contracts: AbsProjectionContracts) => void;
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
  literals: AbsLiteralBinding[];
  /** Known baseline protocols plus explicit field definitions used for this candidate; not complete runtime coverage. */
  contracts: AbsProjectionContracts;
}

/** Strict pure entrypoint. Only the resource coordinator may consume the unprepared draft. */
export async function reconcileAbs(
  baseline: AbsProjection, editedAbs: string, options: AbsReconcileOptions = {},
): Promise<AbsReconcileResult> {
  const { literals, contracts, ...result } = await reconcileAbsDraft(baseline, editedAbs, options);
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
  await validateAbsProjection(baseline);
  const candidate: AbsAbiWorkspace = JSON.parse(absJson(baseline.workspace));
  prepareAbsVariableCreations(candidate, variableCreation);
  if (editedAbs === baseline.abs) {
    return { workspace: candidate, literals: [], contracts: baseline.contracts,
      added: [], removed: [], retained: [...indexAbsAbi(baseline.workspace).keys()] };
  }
  const syntax = absSyntaxOptions(baseline.workspace, baseline.contracts, options);
  const original = parseAbsSyntax(baseline.abs, absSyntaxOptions(baseline.workspace, baseline.contracts));
  const edited = parseAbsSyntax(editedAbs, syntax);
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
    // Identical sequences in an already confirmed owner/input have positional
    // identity. Changed repeated sequences do not: deleting either is possible.
    if (before.length === after.length && before.every((node, i) => signature(node) === signature(after[i]))) {
      before.forEach((node, i) => match(node, after[i]));
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
      const oldTypes = group(before, node => node.type);
      const newTypes = group(after, node => node.type);
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
          throw new AbsSyncError('ABS_IDENTITY_AMBIGUOUS', 'Repeated blocks require an explicit host node operation.',
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
    const requestId = (await hashAbsText(baseline.map.generation + '\n' + editedAbs)).slice('sha256:'.length);
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
  const build = (node: AbsSyntaxNode, root: boolean): AbsAbiBlock => {
    const matched = matches.get(node);
    const previous = matched ? abiBlocks.get(originalIds.get(matched)!)! : undefined;
    const id = previous?.id ?? (options.newId ?? (() => crypto.randomUUID()))();
    if (!previous && (!id || ids.has(id))) throw new AbsSyncError('ABS_DUPLICATE_ID', 'New block ID is not unique.', node, [id]);
    ids.add(id);
    sources.set(id, node);
    (previous ? retained : added).push(id);
    const block: AbsAbiBlock = previous ? JSON.parse(absJson(previous)) : { type: node.type, id };
    if (node.disabled !== (matched?.disabled ?? false)) {
      throw new AbsSyncError('ABS_STATE_EDIT_REQUIRES_HOST', 'Change disabled state through an explicit host operation.', node, [id]);
    }
    const preparedShape = previous ? undefined : options.blockContract?.(node.type, node.extraState);
    block.fields = { ...(preparedShape?.defaults ?? {}), ...block.fields };
    if (preparedShape) setJsonMember(contracts.fields, id, JSON.parse(absJson(preparedShape.fields)));
    if (preparedShape?.argumentOrder) setJsonMember(contracts.syntax ??= Object.create(null), id, preparedShape.argumentOrder);
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
    options.prepareBlock?.(block, previous, candidate, contracts);
    const inputs = { ...block.inputs };
    for (const name of new Set([...Object.keys(inputs), ...Object.keys(node.inputs)])) {
      const originalInput = Object.hasOwn(inputs, name) ? inputs[name] : undefined;
      const child = node.inputs[name];
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
      } else if (!originalInput || !Object.hasOwn(node.inputs, name)) delete inputs[name];
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
  return { workspace: candidate, literals, contracts, added, retained, removed: [...abiBlocks.keys()].filter(id => !afterIds.has(id)) };
}

function setJsonMember(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
}
