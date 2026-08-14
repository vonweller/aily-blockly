import * as Blockly from 'blockly';
import 'blockly/blocks';
import { PythonGenerator as BlocklyPythonGenerator } from 'blockly/python';
import { MicroPythonGenerator } from './micropython';

function withWorkspace<T>(testBody: (workspace: Blockly.Workspace) => T): T {
  const workspace = new Blockly.Workspace();
  try {
    return testBody(workspace);
  } finally {
    workspace.dispose();
  }
}

describe('MicroPythonGenerator standard Blockly support', () => {
  it('generates CyberCAM-style print with a standard text value', () => {
    const generator = new MicroPythonGenerator();
    const previousBlockDefinition = Blockly.Blocks['cybercam_print'];
    Blockly.Blocks['cybercam_print'] = {
      init() {
        this.appendValueInput('VALUE');
        this.setPreviousStatement(true);
        this.setNextStatement(true);
      },
    };
    generator.forBlock['cybercam_print'] = (block, activeGenerator) =>
      `print(${activeGenerator.valueToCode(block, 'VALUE', 0) || "''"})\n`;

    let code: string;
    try {
      code = withWorkspace((workspace) => {
        const printBlock = workspace.newBlock('cybercam_print');
        const textBlock = workspace.newBlock('text');
        textBlock.setFieldValue('666666', 'TEXT');
        printBlock.getInput('VALUE')!.connection!.connect(textBlock.outputConnection!);

        return generator.workspaceToCode(workspace);
      });
    } finally {
      if (previousBlockDefinition) {
        Blockly.Blocks['cybercam_print'] = previousBlockDefinition;
      } else {
        delete Blockly.Blocks['cybercam_print'];
      }
    }

    expect(code).toContain("print('666666')");
  });

  it('keeps the standard math import outside the generated main loop', () => {
    const generator = new MicroPythonGenerator();

    const code = withWorkspace((workspace) => {
      const sqrtBlock = workspace.newBlock('math_single');
      sqrtBlock.setFieldValue('ROOT', 'OP');
      const numberBlock = workspace.newBlock('math_number');
      numberBlock.setFieldValue(9, 'NUM');
      sqrtBlock.getInput('NUM')!.connection!.connect(numberBlock.outputConnection!);

      return generator.workspaceToCode(workspace);
    });

    expect(code).toContain('math.sqrt(9)');
    expect(code).toContain('import math');
    expect(code.indexOf('import math')).toBeLessThan(code.indexOf('while True:'));
  });

  it('renames variables that conflict with standard Python generator imports', () => {
    const generator = new MicroPythonGenerator();

    const code = withWorkspace((workspace) => {
      const variable = workspace.createVariable('math');
      const setBlock = workspace.newBlock('variables_set');
      setBlock.setFieldValue(variable.getId(), 'VAR');
      const assignedNumber = workspace.newBlock('math_number');
      assignedNumber.setFieldValue(1, 'NUM');
      setBlock.getInput('VALUE')!.connection!.connect(assignedNumber.outputConnection!);

      const printBlock = workspace.newBlock('text_print');
      const sqrtBlock = workspace.newBlock('math_single');
      sqrtBlock.setFieldValue('ROOT', 'OP');
      const sqrtNumber = workspace.newBlock('math_number');
      sqrtNumber.setFieldValue(9, 'NUM');
      sqrtBlock.getInput('NUM')!.connection!.connect(sqrtNumber.outputConnection!);
      printBlock.getInput('TEXT')!.connection!.connect(sqrtBlock.outputConnection!);
      setBlock.nextConnection!.connect(printBlock.previousConnection!);

      return generator.workspaceToCode(workspace);
    });

    expect(code).toContain('import math');
    expect(code).not.toMatch(/^math =/m);
    expect(code).toMatch(/^math\d+ = None$/m);
    expect(code).toMatch(/^\s+math\d+ = 1$/m);
    expect(code).toContain('print(math.sqrt(9))');
  });

  it('generates standard number and boolean literals through workspaceToCode', () => {
    const generator = new MicroPythonGenerator();

    const numberCode = withWorkspace((workspace) => {
      const numberBlock = workspace.newBlock('math_number');
      numberBlock.setFieldValue(42, 'NUM');
      return generator.workspaceToCode(workspace);
    });
    const booleanCode = withWorkspace((workspace) => {
      const booleanBlock = workspace.newBlock('logic_boolean');
      booleanBlock.setFieldValue('TRUE', 'BOOL');
      return generator.workspaceToCode(workspace);
    });

    expect(numberCode).toMatch(/^\s+42$/m);
    expect(booleanCode).toMatch(/^\s+True$/m);
  });

  it('keeps standard helper and variable definitions outside the main loop', () => {
    const generator = new MicroPythonGenerator();

    const code = withWorkspace((workspace) => {
      const variable = workspace.createVariable('answer');
      const variableBlock = workspace.newBlock('variables_get');
      variableBlock.setFieldValue(variable.getId(), 'VAR');

      const promptBlock = workspace.newBlock('text_prompt');
      promptBlock.setFieldValue('TEXT', 'TYPE');
      promptBlock.setFieldValue('Question?', 'TEXT');

      return generator.workspaceToCode(workspace);
    });

    expect(code).toContain('answer = None');
    expect(code).toContain('def text_prompt');
    expect(code.indexOf('answer = None')).toBeLessThan(code.indexOf('while True:'));
    expect(code.indexOf('def text_prompt')).toBeLessThan(code.indexOf('while True:'));
  });

  it('keeps the standard executable body in the main loop without relying on parent body formatting', () => {
    const generator = new MicroPythonGenerator();
    const parentFinish = BlocklyPythonGenerator.prototype.finish;
    spyOn(BlocklyPythonGenerator.prototype, 'finish').and.callFake(function (
      this: BlocklyPythonGenerator,
      code: string,
    ) {
      const standardPreamble = parentFinish.call(this, '');
      return code
        ? `${standardPreamble}${code.trimEnd()}\n# parent-finalized\n`
        : standardPreamble;
    });

    const code = withWorkspace((workspace) => {
      const printBlock = workspace.newBlock('text_print');
      const sqrtBlock = workspace.newBlock('math_single');
      sqrtBlock.setFieldValue('ROOT', 'OP');
      const numberBlock = workspace.newBlock('math_number');
      numberBlock.setFieldValue(9, 'NUM');
      sqrtBlock.getInput('NUM')!.connection!.connect(numberBlock.outputConnection!);
      printBlock.getInput('TEXT')!.connection!.connect(sqrtBlock.outputConnection!);

      return generator.workspaceToCode(workspace);
    });

    expect(code).toContain('import math');
    expect(code).toContain(
      '    while True:\n' +
      '        print(math.sqrt(9))',
    );
    expect(code).not.toContain('# parent-finalized');
  });

  it('does not retain a standard preamble across consecutive generations', () => {
    const generator = new MicroPythonGenerator();

    const firstCode = withWorkspace((workspace) => {
      const sqrtBlock = workspace.newBlock('math_single');
      sqrtBlock.setFieldValue('ROOT', 'OP');
      const numberBlock = workspace.newBlock('math_number');
      numberBlock.setFieldValue(9, 'NUM');
      sqrtBlock.getInput('NUM')!.connection!.connect(numberBlock.outputConnection!);

      return generator.workspaceToCode(workspace);
    });
    const secondCode = withWorkspace((workspace) => {
      const textBlock = workspace.newBlock('text');
      textBlock.setFieldValue('fresh', 'TEXT');

      return generator.workspaceToCode(workspace);
    });

    expect(firstCode).toContain('import math');
    expect(secondCode).not.toContain('import math');
    expect(secondCode).not.toContain('math.sqrt');
    expect(secondCode).toContain(
      '    while True:\n' +
      "        'fresh'",
    );
  });

  it('combines a standard preamble with custom setup, loop, and cleanup semantics', () => {
    const generator = new MicroPythonGenerator();

    const code = withWorkspace((workspace) => {
      const printBlock = workspace.newBlock('text_print');
      const sqrtBlock = workspace.newBlock('math_single');
      sqrtBlock.setFieldValue('ROOT', 'OP');
      const numberBlock = workspace.newBlock('math_number');
      numberBlock.setFieldValue(9, 'NUM');
      sqrtBlock.getInput('NUM')!.connection!.connect(numberBlock.outputConnection!);
      printBlock.getInput('TEXT')!.connection!.connect(sqrtBlock.outputConnection!);

      generator.init(workspace);
      const standardBody = generator.blockToCode(printBlock) as string;
      generator.addSetup('device', 'device = open_device()');
      generator.addLoop('tick', 'tick()');
      generator.addCleanup('device', 'device.close()');

      return generator.finish(standardBody);
    });

    const importIndex = code.indexOf('import math');
    const setupIndex = code.indexOf('    device = open_device()');
    const whileIndex = code.indexOf('    while True:');
    const customLoopIndex = code.indexOf('        tick()');
    const standardBodyIndex = code.indexOf('        print(math.sqrt(9))');
    const finallyIndex = code.indexOf('finally:');
    const cleanupIndex = code.indexOf('        device.close()');

    expect(importIndex).toBeGreaterThanOrEqual(0);
    expect(importIndex).toBeLessThan(setupIndex);
    expect(setupIndex).toBeLessThan(whileIndex);
    expect(whileIndex).toBeLessThan(customLoopIndex);
    expect(customLoopIndex).toBeLessThan(standardBodyIndex);
    expect(standardBodyIndex).toBeLessThan(finallyIndex);
    expect(finallyIndex).toBeLessThan(cleanupIndex);
  });
});

describe('MicroPythonGenerator cleanup lifecycle', () => {
  const workspaces: Blockly.Workspace[] = [];

  function createWorkspace(): Blockly.Workspace {
    const workspace = new Blockly.Workspace();
    workspaces.push(workspace);
    return workspace;
  }

  function createInitializedGenerator(): MicroPythonGenerator {
    const generator = new MicroPythonGenerator();
    generator.init(createWorkspace());
    return generator;
  }

  afterEach(() => {
    for (const workspace of workspaces.splice(0)) workspace.dispose();
  });

  it('initializes and records cleanup code by key', () => {
    const generator = createInitializedGenerator();

    expect(Object.getPrototypeOf(generator.codeDict['cleanups'])).toBeNull();

    generator.addCleanup('camera', 'camera.release()');

    expect(generator.codeDict['cleanups']['camera']).toBe('camera.release()');
  });

  it('runs registered cleanup in a finally block after setup and loop code', () => {
    const generator = createInitializedGenerator();
    generator.addSetup('camera', 'camera = open_camera()');
    generator.addLoop('frame', 'show(camera.read())');
    generator.addCleanup('camera', 'camera.release()');

    const code = generator.finish('');

    expect(code).toContain(
      'try:\n' +
      '    # 初始化\n' +
      '    camera = open_camera()\n' +
      '    # 主循环\n' +
      '    while True:\n' +
      '        show(camera.read())',
    );
    expect(code).toContain(
      'except KeyboardInterrupt:\n' +
      '    print("程序已停止")\n' +
      'finally:\n' +
      '    try:\n' +
      '        camera.release()\n' +
      '    except Exception:\n' +
      '        pass',
    );
  });

  it('cleans in reverse registration order and isolates each cleanup failure', () => {
    const generator = createInitializedGenerator();
    generator.addSetup('resources', 'first = open_first()\nsecond = open_second()');
    generator.addCleanup('first', 'first.close()');
    generator.addCleanup('second', 'second.close()');

    const code = generator.finish('');

    expect(code).toContain('try:\n    # 初始化\n    first = open_first()\n    second = open_second()');
    expect(code).toContain(
      'finally:\n' +
      '    try:\n' +
      '        second.close()\n' +
      '    except Exception:\n' +
      '        pass\n' +
      '    try:\n' +
      '        first.close()\n' +
      '    except Exception:\n' +
      '        pass',
    );
    expect(code).not.toContain('while True:');
  });

  it('does not emit a finally block when no non-empty cleanup is registered', () => {
    const generator = createInitializedGenerator();
    generator.addLoop('tick', 'tick()');
    generator.addCleanup('empty', '   ');

    const code = generator.finish('');

    expect(code).not.toContain('finally:');
  });

  it('preserves the exact legacy code-only output when cleanup is empty', () => {
    const generator = createInitializedGenerator();
    generator.addCleanup('empty', '   ');

    expect(generator.finish('print(1)')).toBe(
      '# 主循环\n' +
      'try:\n' +
      '    while True:\n' +
      '        print(1)' +
      'except KeyboardInterrupt:\n' +
      '    print("程序已停止")',
    );
  });

  it('preserves the exact legacy setup and loop output without cleanup', () => {
    const generator = createInitializedGenerator();
    generator.addSetup('setup', 'setup()');
    generator.addLoop('loop', 'loop()');

    expect(generator.finish('')).toBe(
      '# 初始化\n' +
      'setup()\n\n' +
      '# 主循环\n' +
      'try:\n' +
      '    while True:\n' +
      '        loop()\n' +
      'except KeyboardInterrupt:\n' +
      '    print("程序已停止")',
    );
  });

  it('cleans integer-like tags in strict reverse registration order', () => {
    const generator = createInitializedGenerator();
    generator.addCleanup('10', 'cleanup_ten()');
    generator.addCleanup('2', 'cleanup_two()');
    generator.addCleanup('1', 'cleanup_one()');

    const code = generator.finish('');

    expect(code.indexOf('cleanup_one()')).toBeLessThan(code.indexOf('cleanup_two()'));
    expect(code.indexOf('cleanup_two()')).toBeLessThan(code.indexOf('cleanup_ten()'));
  });

  it('preserves relative indentation in a non-empty multiline cleanup', () => {
    const generator = createInitializedGenerator();
    generator.addCleanup(
      'resource',
      '    if resource:\n' +
      '        resource.close()',
    );

    const code = generator.finish('');

    expect(code).toContain(
      '    try:\n' +
      '            if resource:\n' +
      '                resource.close()\n' +
      '    except Exception:',
    );
  });

  it('deduplicates cleanup keys and only replaces code when overwrite is true', () => {
    const generator = createInitializedGenerator();
    generator.addCleanup('resource', 'original_cleanup()');
    generator.addCleanup('resource', 'ignored_cleanup()');
    generator.addCleanup('resource', 'replacement_cleanup()', true);

    const code = generator.finish('');

    expect(code).not.toContain('original_cleanup()');
    expect(code).not.toContain('ignored_cleanup()');
    expect(code.match(/replacement_cleanup\(\)/g)?.length).toBe(1);
  });

  it('resets cleanup registrations on every init', () => {
    const generator = createInitializedGenerator();
    generator.addCleanup('resource', 'resource.close()');

    generator.init(createWorkspace());

    expect(Object.keys(generator.codeDict['cleanups'])).toEqual([]);
    expect(generator.finish('')).toBe('');
  });

  it('wraps code-only programs when cleanup is registered', () => {
    const generator = createInitializedGenerator();
    generator.addCleanup('resource', 'resource.close()');

    expect(generator.finish('print(1)')).toBe(
      'try:\n' +
      '    # 主循环\n' +
      '    while True:\n' +
      '        print(1)\n' +
      'except KeyboardInterrupt:\n' +
      '    print("程序已停止")\n' +
      'finally:\n' +
      '    try:\n' +
      '        resource.close()\n' +
      '    except Exception:\n' +
      '        pass\n',
    );
  });
});
