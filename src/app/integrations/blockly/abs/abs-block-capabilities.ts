import type { DeclarativeBlockSnapshot } from '../../../editors/blockly-editor/services/blockly-declarative-block-catalog';
import { captureAbsDeclarativeContracts } from './abs-declarative-contracts';
import { captureAbsCustomFunctions } from './abs-custom-functions';
import { captureAbsVariableDeclarations } from './abs-declaration-intents';

/** Discovery is advice, never an apply receipt. No instance, serializer or generator callbacks. */
export function describeAbsBlockCapability(snapshot: DeclarativeBlockSnapshot, type: string) {
  snapshot.assertCurrent();
  if (!snapshot.registered(type)) return { type, level: 'unavailable' as const, reason: 'not-registered' };
  const customFunction = captureAbsCustomFunctions(snapshot).describe(type)?.protocol;
  if (customFunction) return { type, level: 'reshape' as const, contract: 'library-custom-functions-v1', customFunction };
  const procedure = snapshot.procedure?.(type);
  if (procedure) return { type, level: 'reshape' as const, contract: 'bundled-procedures-v1', procedure };
  const shapes = captureAbsDeclarativeContracts(snapshot);
  const shape = shapes.get(type);
  if (!shape) return { type, level: 'preserve-only' as const, reason: 'no-prepared-shape-contract' };
  // Defaults can contain large payloads; discovery needs field constraints and connection kinds only.
  const { defaults, ...constraints } = shape;
  const declaration = captureAbsVariableDeclarations(snapshot, shapes.get)(type);
  return { type, level: 'create' as const, contract: 'declarative-v1', shape: constraints, ...(declaration ? { declaration } : {}) };
}
