const CONNECTION_COLORS = {
  power: '#EF4444',
  gnd: '#000000',
  i2c: '#8B5CF6',
  spi: '#EC4899',
  uart: '#F59E0B',
  digital: '#3B82F6',
  gpio: '#3B82F6',
  analog: '#10B981',
  pwm: '#06B6D4',
  other: '#9CA3AF',
};

function isValidConnectionType(type) {
  return Object.prototype.hasOwnProperty.call(CONNECTION_COLORS, type);
}

const PROTOCOL_FLOW_RULES = {
  power: { default: { direction: 'forward', half: false, animationPattern: 'flow-static' } },
  gnd: { default: { direction: 'forward', half: false, animationPattern: 'flow-static' } },
  i2c: {
    pinPatterns: [
      { pattern: /^SDA$/i, flow: { direction: 'bidirectional', half: true, animationPattern: 'flow-half-duplex' } },
      { pattern: /^SCL$/i, flow: { direction: 'forward', half: false, animationPattern: 'flow-forward' } },
    ],
    default: { direction: 'bidirectional', half: true, animationPattern: 'flow-half-duplex' },
  },
  spi: {
    pinPatterns: [
      { pattern: /^MISO$/i, flow: { direction: 'backward', half: false, animationPattern: 'flow-backward' } },
      { pattern: /^(MOSI|SCK|SCLK|CS|SS|CE)$/i, flow: { direction: 'forward', half: false, animationPattern: 'flow-forward' } },
    ],
    default: { direction: 'forward', half: false, animationPattern: 'flow-forward' },
  },
  uart: {
    pinPatterns: [
      { pattern: /^TX$/i, matchSide: 'from', flow: { direction: 'forward', half: false, animationPattern: 'flow-forward' } },
      { pattern: /^RX$/i, matchSide: 'from', flow: { direction: 'backward', half: false, animationPattern: 'flow-backward' } },
    ],
    default: { direction: 'forward', half: false, animationPattern: 'flow-forward' },
  },
  digital: {
    pinPatterns: [
      { pattern: /^(IN|BTN|BUTTON|IRQ|INT|ALERT|READY|BUSY|DETECT)$/i, matchSide: 'to', flow: { direction: 'backward', half: false, animationPattern: 'flow-backward' } },
      { pattern: /^(OUT|LED|EN|ENABLE|RST|RESET|TRIG|TRIGGER)$/i, matchSide: 'to', flow: { direction: 'forward', half: false, animationPattern: 'flow-forward' } },
      { pattern: /^(DATA|IO|SIG|SIGNAL|DQ|DOUT)$/i, flow: { direction: 'bidirectional', half: true, animationPattern: 'flow-half-duplex' } },
    ],
    default: { direction: 'forward', half: false, animationPattern: 'flow-forward' },
  },
  gpio: {
    pinPatterns: [
      { pattern: /^(IN|BTN|BUTTON|IRQ|INT|DETECT)$/i, matchSide: 'to', flow: { direction: 'backward', half: false, animationPattern: 'flow-backward' } },
      { pattern: /^(DATA|IO|SIG|DQ)$/i, flow: { direction: 'bidirectional', half: true, animationPattern: 'flow-half-duplex' } },
    ],
    default: { direction: 'forward', half: false, animationPattern: 'flow-forward' },
  },
  analog: { default: { direction: 'backward', half: false, animationPattern: 'flow-backward' } },
  pwm: { default: { direction: 'forward', half: false, animationPattern: 'flow-forward' } },
  other: { default: { direction: 'forward', half: false, animationPattern: 'none' } },
};

function inferDataFlow(type, fromPin, toPin, arrow = '->') {
  if (arrow === '<->') {
    const rules = PROTOCOL_FLOW_RULES[type];
    const defaultFlow = rules?.default || PROTOCOL_FLOW_RULES.other.default;
    return {
      direction: 'bidirectional',
      half: defaultFlow.half,
      animationPattern: defaultFlow.half ? 'flow-half-duplex' : 'flow-bidirectional',
    };
  }
  if (arrow === '<-') {
    return { direction: 'backward', half: false, animationPattern: 'flow-backward' };
  }
  const rules = PROTOCOL_FLOW_RULES[type];
  if (!rules) {
    return PROTOCOL_FLOW_RULES.other.default;
  }
  if (rules.pinPatterns) {
    for (const rule of rules.pinPatterns) {
      const side = rule.matchSide || 'either';
      const matchFrom = (side === 'from' || side === 'either') && rule.pattern.test(fromPin);
      const matchTo = (side === 'to' || side === 'either') && rule.pattern.test(toPin);
      if (matchFrom || matchTo) {
        return { ...rule.flow };
      }
    }
  }
  return { ...rules.default };
}

const USE_REGEX = /^USE\s+([\w\-:]+)(?:\s+AS\s+(\w+))?(?:\s+"([^"]*)")?$/i;
const ASSIGN_REGEX = /^ASSIGN\s+(\w+)\.(\w+)\s+AS\s+(\w+)\s+@(\w+)(?::(\d+))?$/i;
const CONNECT_REGEX = /^CONNECT\s+(\w+)\.([\w\d]+)\s*(<->|<-|->)\s*(\w+)\.([\w\d]+)\s+@(\w+)(?::(\d+))?(?:\s+"([^"]*)")?$/i;

function generateDefaultAlias(pinmapId) {
  const parts = String(pinmapId || '').split(':');
  return parts.length >= 2 ? parts[1] : parts[0];
}

function parseAWS(aws) {
  const result = { uses: [], assigns: [], connections: [], comments: [], warnings: [], errors: [] };
  const usedAliases = new Set();
  const lines = String(aws || '').split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const lineNumber = i + 1;
    const line = lines[i].trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      result.comments.push(line.slice(1).trim());
      continue;
    }

    const useMatch = line.match(USE_REGEX);
    if (useMatch) {
      const [, pinmapId, alias, label] = useMatch;
      const resolvedAlias = alias || generateDefaultAlias(pinmapId);
      if (usedAliases.has(resolvedAlias)) {
        result.warnings.push({ line: lineNumber, message: `别名 "${resolvedAlias}" 已被使用，可能导致冲突`, code: 'DUPLICATE_ALIAS' });
      }
      usedAliases.add(resolvedAlias);
      result.uses.push({ pinmapId, alias: resolvedAlias, label, line: lineNumber });
      continue;
    }

    const assignMatch = line.match(ASSIGN_REGEX);
    if (assignMatch) {
      const [, ref, pin, role, type, bus] = assignMatch;
      if (!isValidConnectionType(type)) {
        result.warnings.push({ line: lineNumber, message: `未知的连接类型 "${type}"，将使用 "other"`, code: 'UNKNOWN_STATEMENT' });
      }
      result.assigns.push({ ref, pin, role, type, bus: bus ? parseInt(bus, 10) : undefined, line: lineNumber });
      continue;
    }

    const connectMatch = line.match(CONNECT_REGEX);
    if (connectMatch) {
      const [, fromRef, fromPin, arrow, toRef, toPin, type, bus, note] = connectMatch;
      if (!isValidConnectionType(type)) {
        result.warnings.push({ line: lineNumber, message: `未知的连接类型 "${type}"，将使用 "other"`, code: 'UNKNOWN_STATEMENT' });
      }
      result.connections.push({
        fromRef,
        fromPin,
        toRef,
        toPin,
        type: isValidConnectionType(type) ? type : 'other',
        bus: bus ? parseInt(bus, 10) : undefined,
        note,
        arrow,
        line: lineNumber,
      });
      continue;
    }

    result.warnings.push({ line: lineNumber, message: `无法识别的语句: "${line}"`, code: 'UNKNOWN_STATEMENT' });
  }

  const validRefs = new Set(['board', ...result.uses.map((u) => u.alias)]);
  for (const conn of result.connections) {
    if (!validRefs.has(conn.fromRef)) {
      result.errors.push({ line: conn.line, message: `连线引用了未声明的组件 "${conn.fromRef}"，请先使用 USE 声明`, code: 'UNKNOWN_REF', source: `${conn.fromRef}.${conn.fromPin}` });
    }
    if (!validRefs.has(conn.toRef)) {
      result.errors.push({ line: conn.line, message: `连线引用了未声明的组件 "${conn.toRef}"，请先使用 USE 声明`, code: 'UNKNOWN_REF', source: `${conn.toRef}.${conn.toPin}` });
    }
  }

  for (const assign of result.assigns) {
    if (!validRefs.has(assign.ref)) {
      result.errors.push({ line: assign.line, message: `ASSIGN 引用了未声明的组件 "${assign.ref}"`, code: 'UNKNOWN_REF', source: `${assign.ref}.${assign.pin}` });
    }
  }

  return result;
}

function hasErrors(result) {
  return Array.isArray(result?.errors) && result.errors.length > 0;
}

function formatErrors(result) {
  if (!result?.errors?.length) return '';
  const lines = ['## AWS 解析错误\n'];
  for (const error of result.errors) {
    lines.push(`- **行 ${error.line}**: ${error.message}`);
    if (error.source) lines.push(`  源码: \`${error.source}\``);
  }
  return lines.join('\n');
}

function resolvePin(config, pinOrFunc) {
  const searchName = String(pinOrFunc || '').toUpperCase();
  for (const pin of config.pins || []) {
    if (pin.visible === false || pin.disabled) continue;
    for (const fn of pin.functions || []) {
      if (fn.visible === false || fn.disabled) continue;
      if (String(fn.name || '').trim().toUpperCase() === searchName) {
        return { pinId: pin.id, functionName: String(fn.name || '').trim() };
      }
    }
  }
  for (const pin of config.pins || []) {
    if (pin.visible === false || pin.disabled) continue;
    for (const fn of pin.functions || []) {
      if (fn.visible === false || fn.disabled) continue;
      const fnName = String(fn.name || '').trim();
      if (fnName.toUpperCase() === searchName && ['digital', 'gpio', 'analog'].includes(fn.type)) {
        return { pinId: pin.id, functionName: fnName };
      }
    }
  }
  for (const pin of config.pins || []) {
    if (pin.visible === false || pin.disabled) continue;
    for (const fn of pin.functions || []) {
      if (fn.visible === false || fn.disabled) continue;
      const fnName = String(fn.name || '').trim();
      const fnUpper = fnName.toUpperCase();
      if (fnUpper.endsWith(searchName) || searchName.endsWith(fnUpper)) {
        return { pinId: pin.id, functionName: fnName };
      }
    }
  }
  return null;
}

function findPrimaryFunction(functions) {
  const priorities = ['power', 'gnd', 'i2c', 'spi', 'uart', 'digital', 'gpio', 'analog', 'pwm'];
  for (const priority of priorities) {
    const found = functions.find((item) => item.type === priority);
    if (found) return found;
  }
  return functions[0];
}

function generatePinmapSummary(summary, alias, pinmapId) {
  const lines = [`# COMPONENT: ${pinmapId} (${alias})`];
  for (const pin of summary.pins || []) {
    if (!pin.functions?.length) continue;
    const primaryFunc = findPrimaryFunction(pin.functions);
    const funcList = pin.functions.map((fn) => {
      if (fn.name === primaryFunc.name) return fn.name;
      if (fn.type !== primaryFunc.type) return `${fn.name}/${fn.type}`;
      return fn.name;
    }).join(', ');
    lines.push(`${primaryFunc.name}: ${funcList}`);
  }
  return lines.join('\n');
}

const AWS_SYNTAX_REFERENCE = `
## AWS (Aily Wiring Syntax) 语法参考

### 预定义别名
- \`board\` - 开发板（自动可用，无需声明）

### USE - 声明外部组件
\`\`\`
USE <pinmapId> AS <别名> "显示名"
\`\`\`

### CONNECT - 创建连线
\`\`\`
CONNECT <组件.引脚> -> <组件.引脚> @<类型>
CONNECT <组件.引脚> <- <组件.引脚> @<类型>
CONNECT <组件.引脚> <-> <组件.引脚> @<类型>
CONNECT <组件.引脚> -> <组件.引脚> @<类型>:<总线号> "备注"
\`\`\`
类型: power, gnd, i2c, spi, uart, digital, gpio, analog, pwm

### ASSIGN - 引脚重映射
\`\`\`
ASSIGN <组件.引脚> AS <角色> @<类型>:<总线号>
\`\`\`
`.trim();

module.exports = {
  CONNECTION_COLORS,
  AWS_SYNTAX_REFERENCE,
  inferDataFlow,
  parseAWS,
  hasErrors,
  formatErrors,
  resolvePin,
  generatePinmapSummary,
};
