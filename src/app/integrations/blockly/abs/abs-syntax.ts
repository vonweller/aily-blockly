import { readAbsJsonToken, readAbsSingleQuotedToken } from '@shared/public-api';
import { AbsFieldDefinition, readAbsFieldToken } from './abs-field-values';
import { ABS_SCHEMA_HEADER, AbsSyntaxNode, AbsSyncError } from './abs-state';
import type { BlockMeta } from './block-definition.model';

/** One definition-bound grammar. No block-name guesses, identities or workspace effects. */
export type AbsArgumentDefinition = BlockMeta['argsOrder'][number];
export interface AbsSyntaxOptions {
  /** Complete, unambiguous argument order captured by the host; absent means named-only. */
  argumentOrder?: (blockType: string) => readonly AbsArgumentDefinition[] | undefined;
  fieldDefinition?: (blockType: string, fieldName: string) => AbsFieldDefinition | undefined;
}
export function parseAbsSyntax(source: string, options: AbsSyntaxOptions = {}): AbsSyntaxNode[] {
  if (!source.split(/\r?\n/).some(line => line.trim() === ABS_SCHEMA_HEADER)) {
    throw new AbsSyncError('ABS_SCHEMA_UNSUPPORTED', 'Expected ABS Schema: 2.');
  }
  return new AbsSyntaxReader(source, options).read();
}

class AbsSyntaxReader {
  private offset = 0;
  private depth = 0;
  private blockDepth = 0;
  private nodes = 0;
  constructor(private readonly source: string, private readonly options: AbsSyntaxOptions) {}

  read(): AbsSyntaxNode[] {
    const roots: AbsSyntaxNode[] = [];
    while (this.skipLines()) {
      if (this.indent() !== 0) this.fail('Root blocks must not be indented.');
      roots.push(this.block(0));
    }
    return roots;
  }

  private block(indent: number): AbsSyntaxNode {
    if (++this.blockDepth > 128) this.fail('ABS block nesting exceeds parsing limits.');
    this.offset += indent;
    const node = this.expression();
    this.endLine();
    while (this.skipLines() && this.indent() > indent) {
      const sectionIndent = this.indent();
      if (sectionIndent !== indent + 4) this.fail('Block bodies use four-space indentation.');
      if (this.source[this.offset + sectionIndent] !== '@') {
        const slots = this.options.argumentOrder?.(node.type)?.filter(argument => argument.kind === 'statementInput');
        if (slots?.length !== 1) this.fail('An implicit body requires exactly one known statement input; use @NAME:.');
        const name = slots[0].name;
        if (Object.hasOwn(node.inputs, name) || Object.hasOwn(node.fields, name)) this.fail(`Duplicate input ${name}.`);
        node.inputs[name] = this.chain(sectionIndent, true);
        node.end = this.offset;
        continue;
      }
      this.offset += sectionIndent;
      this.expect('@');
      const name = this.argumentName();
      this.space();
      this.expect(':');
      this.space();
      const argument = this.options.argumentOrder?.(node.type)?.find(argument => argument.name === name);
      if (argument?.kind === 'field') this.fail(`Argument ${name} is a field, not an input.`);
      let child: AbsSyntaxNode | null = null;
      if (this.offset < this.source.length && !/[\r\n#]/.test(this.source[this.offset])) {
        if (argument?.kind !== 'valueInput') this.fail('An inline section requires a known value input.');
        child = this.valueInput();
        this.endLine();
      } else {
        this.endLine();
        if (this.skipLines() && this.indent() > sectionIndent) {
          if (this.indent() !== sectionIndent + 4) this.fail('Input bodies use four-space indentation.');
          child = this.chain(sectionIndent + 4, argument?.kind !== 'valueInput');
        }
      }
      if (name === 'next') {
        if (node.next || !child) this.fail('Duplicate or empty @next.');
        node.next = child;
      } else {
        if (Object.hasOwn(node.inputs, name) || Object.hasOwn(node.fields, name)) this.fail(`Duplicate input ${name}.`);
        node.inputs[name] = child;
      }
      node.end = this.offset;
    }
    this.blockDepth--;
    return node;
  }

  private chain(indent: number, statements: boolean): AbsSyntaxNode {
    const head = this.block(indent);
    let tail = head;
    while (this.skipLines() && this.indent() === indent && this.source[this.offset + indent] !== '@') {
      if (!statements) this.fail('A value input accepts one block, not a statement chain.');
      if (tail.next) this.fail('A chain cannot have both an explicit and implicit next.');
      tail.next = this.block(indent);
      tail = tail.next;
    }
    return head;
  }

  private valueInput(): AbsSyntaxNode | null {
    if (/^[\w]+\s*\(/.test(this.source.slice(this.offset))) return this.expression();
    const start = this.offset;
    this.literalEnd();
    const token = readAbsFieldToken(this.source.slice(start, this.offset));
    if (token.value === null) return null;
    if (!token.reference) this.fail('A value input requires a block expression.');
    const getter = this.options.argumentOrder?.('variables_get');
    if (getter?.length !== 1 || getter[0].name !== 'VAR' || getter[0].kind !== 'field'
      || this.options.fieldDefinition?.('variables_get', 'VAR')?.symbol?.kind !== 'variable') {
      this.fail('Bare variable value input requires the host variables_get contract; use variables_get($name).');
    }
    if (++this.nodes > 100000) this.fail('ABS structure exceeds parsing limits.');
    return { type: 'variables_get', fields: { VAR: token }, fieldRanges: { VAR: { start, end: this.offset } },
      inputs: Object.create(null), disabled: false, start, end: this.offset };
  }

  private expression(): AbsSyntaxNode {
    if (++this.depth > 128 || ++this.nodes > 100000) this.fail('ABS structure exceeds parsing limits.');
    const node: AbsSyntaxNode = {
      type: '', fields: Object.create(null), fieldRanges: Object.create(null), inputs: Object.create(null),
      disabled: false, start: this.offset, end: this.offset,
    };
    node.type = this.name();
    this.space();
    this.expect('(');
    this.space(true);
    const order = this.options.argumentOrder?.(node.type);
    const positional = order?.filter(argument => argument.kind !== 'statementInput');
    const argumentsByName = order ? new Map(order.map(argument => [argument.name, argument])) : undefined;
    let positionalIndex = 0;
    let sawNamed = false;
    while (this.source[this.offset] !== ')') {
      let name: string;
      const quotedName = this.source[this.offset] === '"' ? readAbsJsonToken(this.source, this.offset) : undefined;
      if (/^[A-Za-z_]\w*\s*=/.test(this.source.slice(this.offset))
        || (quotedName && /^\s*=/.test(this.source.slice(quotedName.end)))) {
        sawNamed = true;
        name = this.argumentName();
        this.space(true);
        this.expect('=');
        this.space(true);
      } else {
        if (sawNamed) this.fail('Positional arguments must precede named arguments.');
        if (!order || argumentsByName!.size !== order.length) this.fail('Positional arguments require a complete, unambiguous definition.');
        const argument = positional![positionalIndex++];
        if (!argument) this.fail('No positional field/value input is available; use a named section for statements.');
        name = argument.name;
      }
      const argument = argumentsByName?.get(name);
      if (Object.hasOwn(node.fields, name) || Object.hasOwn(node.inputs, name)) this.fail(`Duplicate argument ${name}.`);
      if (argument?.kind === 'valueInput') {
        node.inputs[name] = this.valueInput();
      } else if (/^[\w]+\s*\(/.test(this.source.slice(this.offset))) {
        if (argument) this.fail(`Argument ${name} is not a value input.`);
        node.inputs[name] = this.expression();
      } else {
        const start = this.offset;
        this.literalEnd();
        try {
          const token = readAbsFieldToken(this.source.slice(start, this.offset));
          if (argument && argument.kind !== 'field') this.fail(`Argument ${name} requires a block input.`);
          else {
            node.fields[name] = token;
            node.fieldRanges[name] = { start, end: this.offset };
          }
        }
        catch (error) { this.fail(String(error)); }
      }
      this.space(true);
      if (this.source[this.offset] !== ',') break;
      this.offset++;
      this.space(true);
      if (this.source[this.offset] === ')') this.fail('Trailing comma.');
    }
    this.expect(')');
    this.space();
    while (this.source[this.offset] === '@') {
      this.offset++;
      const annotation = this.name();
      if (annotation === 'disabled') {
        if (node.disabled) this.fail('Duplicate @disabled.');
        node.disabled = true;
      } else if (annotation === 'extra') {
        if (Object.hasOwn(node, 'extraState')) this.fail('Duplicate @extra.');
        this.expect(':');
        this.space();
        const start = this.offset;
        this.literalEnd();
        try { node.extraState = JSON.parse(this.source.slice(start, this.offset)); }
        catch { this.fail('Invalid @extra JSON.'); }
        node.extraRange = { start, end: this.offset };
      } else this.fail(`Unsupported annotation @${annotation}.`);
      this.space();
    }
    node.end = this.offset;
    this.depth--;
    return node;
  }

  private literalEnd(): void {
    const char = this.source[this.offset];
    if (char === '$' && this.source[this.offset + 1] === '"') {
      try { this.offset = readAbsJsonToken(this.source, this.offset + 1).end; }
      catch (error) { this.fail(String(error)); }
    } else if (char === "'") {
      try { this.offset = readAbsSingleQuotedToken(this.source, this.offset).end; }
      catch (error) { this.fail(String(error)); }
    } else if (char === '"' || char === '{' || char === '[') {
      try { this.offset = readAbsJsonToken(this.source, this.offset).end; }
      catch (error) { this.fail(String(error)); }
    } else {
      const match = /^[^\s,()@#]+/.exec(this.source.slice(this.offset));
      if (!match) this.fail('Expected a field value.');
      this.offset += match[0].length;
    }
  }

  private argumentName(): string {
    if (this.source[this.offset] !== '"') return this.name();
    const token = readAbsJsonToken(this.source, this.offset);
    const value = JSON.parse(this.source.slice(this.offset, token.end));
    this.offset = token.end;
    return value;
  }

  private name(): string {
    const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.source.slice(this.offset));
    if (!match) this.fail('Expected an identifier.');
    this.offset += match[0].length;
    return match[0];
  }
  private expect(char: string): void {
    if (this.source[this.offset] !== char) this.fail(`Expected ${char}.`);
    this.offset++;
  }
  private space(multiline = false): void {
    while (this.offset < this.source.length && (multiline ? /\s/ : /[ \t]/).test(this.source[this.offset])) this.offset++;
  }
  private endLine(): void {
    this.space();
    if (this.source[this.offset] === '#') {
      while (this.offset < this.source.length && this.source[this.offset] !== '\n') this.offset++;
    }
    if (this.source[this.offset] === '\r') this.offset++;
    if (this.source[this.offset] === '\n') this.offset++;
    else if (this.offset < this.source.length) this.fail('Unexpected trailing input.');
  }
  private skipLines(): boolean {
    while (this.offset < this.source.length) {
      const end = this.source.indexOf('\n', this.offset);
      const text = this.source.slice(this.offset, end < 0 ? this.source.length : end).trim();
      if (text && !text.startsWith('#')) return true;
      this.offset = end < 0 ? this.source.length : end + 1;
    }
    return false;
  }
  private indent(): number {
    const indent = /^[ \t]*/.exec(this.source.slice(this.offset))![0];
    if (indent.includes('\t')) this.fail('Use spaces for block indentation.');
    return indent.length;
  }
  private fail(message: string): never {
    throw new AbsSyncError('ABS_SYNTAX_INVALID', message, { start: this.offset, end: this.offset + 1 });
  }
}
