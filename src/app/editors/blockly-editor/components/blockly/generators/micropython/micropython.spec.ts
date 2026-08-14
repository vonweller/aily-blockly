import * as Blockly from 'blockly';
import { MicroPythonGenerator } from './micropython';

describe('MicroPythonGenerator cleanup lifecycle', () => {
  it('initializes and records cleanup code by key', () => {
    const generator = new MicroPythonGenerator();
    generator.init(new Blockly.Workspace());

    expect(Object.getPrototypeOf(generator.codeDict['cleanups'])).toBeNull();

    generator.addCleanup('camera', 'camera.release()');

    expect(generator.codeDict['cleanups']['camera']).toBe('camera.release()');
  });

  it('runs registered cleanup in a finally block after setup and loop code', () => {
    const generator = new MicroPythonGenerator();
    generator.init(new Blockly.Workspace());
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
    const generator = new MicroPythonGenerator();
    generator.init(new Blockly.Workspace());
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
    const generator = new MicroPythonGenerator();
    generator.init(new Blockly.Workspace());
    generator.addLoop('tick', 'tick()');
    generator.addCleanup('empty', '   ');

    const code = generator.finish('');

    expect(code).not.toContain('finally:');
  });

  it('preserves the exact legacy code-only output when cleanup is empty', () => {
    const generator = new MicroPythonGenerator();
    generator.init(new Blockly.Workspace());
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
    const generator = new MicroPythonGenerator();
    generator.init(new Blockly.Workspace());
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
    const generator = new MicroPythonGenerator();
    generator.init(new Blockly.Workspace());
    generator.addCleanup('10', 'cleanup_ten()');
    generator.addCleanup('2', 'cleanup_two()');
    generator.addCleanup('1', 'cleanup_one()');

    const code = generator.finish('');

    expect(code.indexOf('cleanup_one()')).toBeLessThan(code.indexOf('cleanup_two()'));
    expect(code.indexOf('cleanup_two()')).toBeLessThan(code.indexOf('cleanup_ten()'));
  });

  it('preserves relative indentation in a non-empty multiline cleanup', () => {
    const generator = new MicroPythonGenerator();
    generator.init(new Blockly.Workspace());
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
    const generator = new MicroPythonGenerator();
    generator.init(new Blockly.Workspace());
    generator.addCleanup('resource', 'original_cleanup()');
    generator.addCleanup('resource', 'ignored_cleanup()');
    generator.addCleanup('resource', 'replacement_cleanup()', true);

    const code = generator.finish('');

    expect(code).not.toContain('original_cleanup()');
    expect(code).not.toContain('ignored_cleanup()');
    expect(code.match(/replacement_cleanup\(\)/g)?.length).toBe(1);
  });

  it('resets cleanup registrations on every init', () => {
    const generator = new MicroPythonGenerator();
    generator.init(new Blockly.Workspace());
    generator.addCleanup('resource', 'resource.close()');

    generator.init(new Blockly.Workspace());

    expect(Object.keys(generator.codeDict['cleanups'])).toEqual([]);
    expect(generator.finish('')).toBe('');
  });

  it('wraps code-only programs when cleanup is registered', () => {
    const generator = new MicroPythonGenerator();
    generator.init(new Blockly.Workspace());
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
