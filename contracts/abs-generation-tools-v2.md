# ABS generation tools v2

The live host is the sole identity reconciler and generation publisher. No v1 wire fallback, automatic pre-save/rebase, or timeout replay is permitted. Disk storage remains governed by abs-generation-storage-v1.md.

## Binding

`base = { generation, scope: { projectKey, pageId }, abiHash, absHash, mapHash }`

Hashes are `sha256:<64 lowercase hex>`: ABI and map use exact saved UTF-8 bytes, absHash identifies the original exported ABS. The candidate may be edited on disk; its independent `{ hash, bytes }` binds the actual supplied source. Public map data is checked again against the host's immutable committed baseline, not treated as authority.

## Operations

| Live operation | Request | Result |
| --- | --- | --- |
| abs_projection | version=2, requestId, expectedAbiHash, optional initialize/publish/rebind | Canonical ABS plus generation-projection receipt. publish=false is a readonly artifact, not a new editable baseline. Explicit rebind echoes its inspection token in the receipt. Export never saves ABI. |
| abs_validate | version=2, requestId, base, candidate, exactly one abs/absPath, optional createVariables | prepared-generation receipt with workspaceRevision and exact creation intents; no block loading or mirror publication. Immutable payload preparation is allowed. |
| abs_apply | version=2, matching requestId, validation receipt, exactly one abs/absPath, optional chunk | Rechecks candidate/baseline/revision, merges and reads back fully; only COMMITTED returns complete-generation receipt and output evidence. No second ordinary save. |
| abs_recovery | version=2, requestId, action=inspect/recover/abandon; generation required for abandon | Request/action-bound disk diagnosis/recovery result and requiresReload. Inspect includes mirror hashes, current/baseline scope, issues, status and optional rebind token. No ABS replay or workspace-clean assertion. |

Output evidence is `{ binding, absBytes }` for the new generation. Agent verifies actual ABI/ABS/map bytes and the published map's generation/scope after acknowledgement. Incomplete/mismatched acknowledgement never becomes an inferred success or triggers a replay.

All tool request IDs, including recovery's `{ version, requestId, action }`, are nested inside `receipt`. The enclosing IPC owns its separate top-level requestId and may replace it during routing.

## User tools

- abs_export returns generation; initialize=true explicitly establishes the first baseline from trusted current state and preserves old unversioned ABS in recovery input.
- abs_validate, abs_apply and abs_import require the generation associated with the source being edited. abs_import uses the same live merge, not headless reconstruction.
- project_save and blocks_tidy request fresh generation projection after their host mutation. Projection failure does not roll back the earlier save/layout.
- project_recover exposes the three explicit disk actions. Reopen when required; recovery alone does not certify application of the failed candidate.

## Ordinary declaration-driven model preparation

The public language remains ABS Schema 2: parameters follow original argsN order with fields/value inputs interleaved; a variable field takes `$name`, while a value input normally uses `variables_get($name)`. The retained bare `$name` value fallback normalizes to one getter before identity matching. Coordinates, IDs and protection state remain outside ABS. The single Agent syntax reference is `packages/aily-agent/src/skills/aily-blockly-project/references/abs-syntax.md` in aily-lex-pro.

When current capability discovery includes `declaration:{nameField,nativeType,owner:{type,input}}`, an ordinary new declaration directly in the reported global body prepares its model before references are resolved. The current audited variable_define contract uses VAR, native type `""` and owner arduino_global/ARDUINO_GLOBAL. Its TYPE dropdown remains a C++ type, not the native model type. No ordinary createVariables list, @var or model ID is required.

The source, live handler/helpers, declaration/owner shapes and runtime scope must be attested; a block name or arbitrary text field is not a declaration capability. The pure preparation pass runs after identity matching and before reference resolution. It prepares missing models only for new declarations, preserves existing identities/opaque data, and rejects duplicate storage declarations, case/type conflicts, lost retained models and implicit renames. An unproved new local/advanced/object scope is not inferred. Existing special names and untouched non-global declarations are preserved.

Derived IDs use the immutable generation plus exact candidate source, through the existing model preparation layer. Validate and apply derive the same table without new wire fields. Source/generation binding and full runtime readback remain mandatory. Agreeing explicit transition intents are reused; conflicting native types fail. Native loading or generation that still introduces extra models remains an error, never an excuse to relax readback.

## Advanced explicit native variable creation

User tools abs_validate/abs_apply/abs_import retain optional `createVariables:[{name, type?}]` (1–128 records, strings at most 256 characters) for advanced supported protocols, including procedure/FUNC/parameter models. Ordinary globals use declaration-driven preparation instead. This is a tool argument, never an ABS directive. Names must be nonblank, without leading/trailing whitespace or control characters. Native Blockly `type` defaults to `""`; it is not the C++ declaration type. Supply actual declaration blocks where generated storage is required. Existing names (case-insensitive across types), supplied IDs and rename/delete operations are rejected.

The host deterministically prepares IDs from the wire requestId and record index against a detached candidate model table, after validating the unchanged baseline. Native loading, exact model/readback verification and the existing generation save commit models and blocks together. A validation alone creates no live models. The receipt includes both exact intents and host-produced `preparedVariables:[{id,name,type}]`; an old host echoing unknown input fields is not capability evidence. Agent rejects missing/altered/unexpected intents or prepared identities, then checks that the byte-verified saved ABI actually contains those models. Agent's application internally prepares a new request; standalone validate is a dry run, not a reserved model ID. Reapply does not replay creation; subsequent edits omit the list and use their new generation.

Other populated pages still require current reference coverage for shared model changes. Unknown serializers or generator-created extra models remain errors with the existing rollback/quarantine policy. This is not an object-lifetime or dynamic-procedure contract.

## Host-bundled legacy procedures

The registered +/- definitions and native legacy callers have an additional host adapter, without new wire fields. Definitions use NAME and optional `@extra:{"params":[{"name":"amount"}]}`; native parameter models must already exist or be requested with createVariables. The host supplies parameter model references and UI argId fields, preserving surviving identities. Callers explicitly name the same signature in extraState and use ARG<n> inputs. Existing exported native IDs/derived fields are retained; callers cannot fabricate or rebind them. Removal of a parameter never deletes shared models.

New/reshaped blocks are accepted only while the bundled registration and its dependency callbacks are intact. The candidate's exact prepared serializer state and fields must survive full native readback. Definitions are classified as shared before loading; another page's calls are not implicitly rewritten. Other serializer protocols require separate audited adapters. No @meta, secondary model publication or headless fallback is introduced.

## Audited typed library custom functions

`library-custom-functions-v1` covers custom_function_def, custom_function_call_advance and custom_function_call_return_advance only when the current host attests the loaded generator source, runtime registrations and declaration catalog. Unknown source revisions stay preserve-only. This is independent from the bundled legacy protocol; names, package versions and similar-looking extraState are not permission.

Definitions use FUNC_NAME/RETURN_TYPE, STACK and optional RETURN. Calls use a FUNC_NAME variable field and INPUT<n>. Both express typed signatures as `@extra:{"params":[{"name":"amount","type":"int"}]}`. The FUNC model and ordinary parameter models must exist or be explicit createVariables intents; native model type is not the C++ parameter type. Host preparation derives function/parameter IDs, counts and parameter UI fields without invoking library callbacks. Existing exported identities are preserved; function renaming or retargeting is rejected. Parameter removal does not delete models. Value calls require a non-void definition; statement calls may discard the result. Signatures must match within this protocol, and cross-page changes retain the shared-contract gate.

The library registry is derived from the loaded workspace, not a fourth persisted mirror. After native loading and rollback the host rebuilds only this lookup and the committed function-name cache in the existing project Realm, without invoking library initialization or creating/deleting models. Full model/serializer readback remains mandatory; unexpected generator-created models still trigger rollback or quarantine according to the commit boundary.

Ordinary reopen and live snapshot capture also prepare the lookup before serializing callers, using only the audited definition serializer. This covers delayed library listener attachment clearing the registry; readiness does not depend on a later FinishedLoading timer. Normal snapshots preserve the committed-name checkpoint of in-progress UI edits. This existing-instance serialization step does not execute callbacks during detached candidate preparation or capability discovery.

## Readonly host shape capability discovery

`blockly-live-operation` operation `abs_capabilities` accepts `{version:1,type?}` or `{version:1,filter?}`. `type` and `filter` are mutually exclusive strings of at most 256 characters. It returns `{ok:true,operation,project,capabilities:{version:1,scope:{projectKey,pageId},runtimeRevision,blocks}}`. No generation is created or reserved. This separate versioned advice protocol is not a validation or apply receipt.

Each block has type/library and one level:

- `create`, contract `declarative-v1`: verified fixed shape with field constraints/input kinds/connections, without potentially large default values. New instances remain subject to normal model/reference/connection and full-readback checks; dynamic extraState changes are not authorized.
- `reshape`, contract `bundled-procedures-v1`: only the verified native procedure role/return contract described above. Parameter and cross-page constraints still apply.
- `reshape`, contract `library-custom-functions-v1`: `customFunction:{kind,parameterTypes}` describes an audited definition, statement-call or value-call and its allowed C++ parameter types. It does not expose host-owned model identities or authorize a different serializer.
- `preserve-only`, reason `no-prepared-shape-contract`: no permission to create/reshape this type. Existing field edits may still validate against their exact exported instance contracts; unchanged state must survive the normal transaction.
- `unavailable`, reason `not-registered`: no current host registration.

Agent `block_info` / `blocks_list` expose this separately from argument metadata. Offline, old, failed or malformed hosts produce `unknown`, not inferred support. Agent verifies the reply's project, scope, version, finite runtime revision, requested type, unique entries and supported contracts. There is no cache across project/page/runtime changes and no fallback probe workspace. Fixed-shape metadata comes from the same proven declarations as preparation; library-only signatures are labeled documentation. Runtime-only dynamic blocks can be listed without inventing argument signatures. Discovery guarantees neither a generator handler nor successful code generation, compilation or device execution.

Fixed shapes may include `argumentOrder:[{name,kind}]`, covering each persisted field/input exactly once. Agent checks kinds, coverage and uniqueness, and preserves the original interleaving in signatures; it must not reconstruct fields-first order. Without proven order, expose constraints but omit a positional signature. Optional `declaration` additionally describes the separately attested model effect above; a create-level shape alone does not prove that effect. These additive advice fields do not change wire version 2 or map schema 1.

The operation is synchronous, uses the current editor-owned declaration/bundled registration snapshot, and asserts project/page/Generator revision/Project Data session before and after. It executes no block constructor, serializer or generator, acquires no file writer and publishes no mirrors. Existing generation-bound preparation/application remain the only write authority.

## Explicit scope/map rebinding

After a project copy, page switch, or public-map corruption, inspect first. `diagnostics.status="rebind-required"` and `diagnostics.rebind={token,from,to}` are issued only for an intact authoritative baseline, no pending journal, saved ABI present and unchanged baseline ABS. The token hashes exact mirror bytes (null differs from empty), committed pointer hash and destination scope. It is not candidate-application authority or a claim that the workspace is saved.

Call abs_export with that token as rebind after confirming the intended repair. Do not combine initialize or a custom output. Host rechecks the token, workspace/disk divergence, queue/lease/runtime context and the committed pointer before staging a new export generation. It retains exact replaced map bytes in inputMap plus existing inputAbs and all old immutable baselines. Normal generation publication/recovery handles interruption. No block load, ABI save or code generation occurs during rebind. The receipt echoes rebind; Agent verifies it and the actual three-file output.

Begin subsequent edits from the new ABS/generation. Do not substitute it on an old candidate. Unapplied ABS edits, copied pending journals, missing/corrupt authoritative baselines and orphan maps remain blocked. No automatic token acquisition, retry, rebase or journal deletion is allowed. Source/page identity changes during inspection or publication reject stale work.

Current support covers preserved existing state and declaration-backed new shapes. Unknown dynamic/model/serializer contracts fail explicitly. General corrupt-ABI reconstruction, full recovery UI, history navigation and resource GC are not implied by this wire protocol.
