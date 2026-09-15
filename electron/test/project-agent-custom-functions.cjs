const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mirrors = project => ['project.abi', 'project.abs', 'project.abs.map.json'].map(name => fs.readFileSync(path.join(project, name)));
const changeSignature = (abs, edit) => abs.split('\n').map(line => {
  if (!/custom_function_(def|call_advance)\(/.test(line)) return line;
  // The fixture has one custom extraState per line; the call may be inline
  // inside arduino_setup(...), so its closing parenthesis is not JSON.
  return line.replace(/ @extra:(\{.*\})/, (_, state) => ' @extra:' + JSON.stringify(edit(JSON.parse(state))));
}).join('\n');

async function runCustomFunctions(project, load, call, history) {
  const { createTools } = await load('tools/create-tools.js');
  const tools = createTools(project, history, { allowsApprovedExternalPath: () => false }, []);
  const read = tools.find(tool => tool.name === 'read'), write = tools.find(tool => tool.name === 'write');
  const rounds = []; let identity;
  for (let round = 0; round < 3; round++) {
    const exported = await call('abs_export', { initialize: round === 0 }); assert.equal(exported.ok, true, JSON.stringify(exported));
    const candidate = round === 0 ? exported.abs.replace('arduino_setup()', 'arduino_setup()\n    @ARDUINO_SETUP:\n        custom_function_call_advance(FUNC_NAME="abs_custom")')
      + '\ncustom_function_def(FUNC_NAME="abs_custom", RETURN_TYPE="int", RETURN=math_number(NUM=1))'
      : round === 1 ? changeSignature(exported.abs, state => ({ ...state, params: [{ name: 'amount', type: 'int' }] }))
        .replace('custom_function_call_advance(FUNC_NAME="abs_custom")', 'custom_function_call_advance(FUNC_NAME="abs_custom", INPUT0=math_number(NUM=7))')
      : changeSignature(exported.abs, state => ({ ...state, params: [{ name: 'amount', type: 'float' }] })).replace('NUM=7', 'NUM=9')
        .replace('RETURN=math_number(NUM=1)', 'RETURN=variables_get(VAR="amount")');
    assert.notEqual(candidate, exported.abs);
    const createVariables = round === 0 ? [{ name: 'abs_custom', type: 'FUNC' }] : round === 1 ? [{ name: 'amount' }] : undefined;
    await read.execute('read-custom-' + round, { path: 'project.abs' }, undefined, undefined, {});
    await write.execute('write-custom-' + round, { path: 'project.abs', content: candidate }, undefined, undefined, {});
    const before = mirrors(project);
    const validation = await call('abs_validate', { generation: exported.generation, absPath: 'project.abs', createVariables });
    assert.equal(validation.ok, true, JSON.stringify(validation)); assert.deepEqual(mirrors(project), before);
    const applied = await call(round === 2 ? 'abs_import' : 'abs_apply', { generation: exported.generation, absPath: 'project.abs', createVariables, chunk: round === 1 });
    assert.equal(applied.ok, true, JSON.stringify(applied));
    const doc = JSON.parse(fs.readFileSync(path.join(project, 'project.abi'), 'utf8'));
    assert.equal(doc.sharedModel.procedureBlocks.length, 1);
    const definition = doc.sharedModel.procedureBlocks[0];
    if (round === 0) identity = definition.id; else assert.equal(definition.id, identity);
    rounds.push({ validation: validation.receipt, applied: applied.receipt });
  }
  const saved = await call('project_save'); assert.equal(saved.ok, true, JSON.stringify(saved));
  const exported = await call('abs_export'); assert.equal(exported.ok, true, JSON.stringify(exported));
  const before = mirrors(project);
  const bad = exported.abs.replace(/"funcVarId":"[^"]+"/, '"funcVarId":"forged"');
  assert.notEqual(bad, exported.abs);
  const rejected = await call('abs_apply', { generation: exported.generation, abs: bad });
  assert.equal(rejected.code, 'ABS_CUSTOM_FUNCTION_INVALID'); assert.deepEqual(mirrors(project), before);
  return { definitionId: identity, rounds, rejected: rejected.code, saved: saved.projectionReceipt };
}
async function rejectCustomCrossPage(project, call) {
  const exported = await call('abs_export'); assert.equal(exported.ok, true, JSON.stringify(exported));
  const before = mirrors(project), candidate = changeSignature(exported.abs, state => ({ ...state, params: [{ name: 'other_amount', type: 'float' }] }));
  const result = await call('abs_apply', { generation: exported.generation, abs: candidate, createVariables: [{ name: 'other_amount' }] });
  assert.equal(result.code, 'ABS_SHARED_CONTRACT_REQUIRED', JSON.stringify(result)); assert.deepEqual(mirrors(project), before);
  return { rejected: result.code };
}
async function rejectCustomRuntimeMutation(project, call) {
  const exported = await call('abs_export', { initialize: !!process.env.AILY_ABS_CUSTOM_FIXTURE }); assert.equal(exported.ok, true, JSON.stringify(exported));
  // Change derived registry content too: merely changing a literal would not
  // prove that rollback restores the old typed call signature.
  const before = mirrors(project), candidate = changeSignature(exported.abs,
    state => ({ ...state, params: [{ name: 'amount', type: 'int' }] })).replace('NUM=9', 'NUM=11');
  assert.notEqual(candidate, exported.abs);
  const result = await call('abs_apply', { generation: exported.generation, abs: candidate });
  assert.equal(result.code, 'ABS_READBACK_MISMATCH', JSON.stringify(result)); assert.deepEqual(mirrors(project), before);
  const recovery = await call('project_recover', { action: 'inspect' }); assert.equal(recovery.pending, null);
  const restored = await call('abs_export'); assert.equal(restored.ok, true, JSON.stringify(restored));
  assert.equal(restored.abs, exported.abs);
  return { rejected: result.code, restored: restored.receipt };
}
module.exports = { runCustomFunctions, rejectCustomCrossPage, rejectCustomRuntimeMutation };
