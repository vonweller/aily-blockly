const fs = require('fs');
const path = require('path');

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

function createAwsService(projectContext, pinmapService) {
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

  const USE_REGEX = /^USE\s+([\w\-:]+)(?:\s+AS\s+(\w+))?(?:\s+"([^"]*)")?$/i;
  const ASSIGN_REGEX = /^ASSIGN\s+(\w+)\.(\w+)\s+AS\s+(\w+)\s+@(\w+)(?::(\d+))?$/i;
  const CONNECT_REGEX = /^CONNECT\s+(\w+)\.([\w\d]+)\s*(<->|<-|->)\s*(\w+)\.([\w\d]+)\s+@(\w+)(?::(\d+))?(?:\s+"([^"]*)")?$/i;

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
      return { ...PROTOCOL_FLOW_RULES.other.default };
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
        if (!Object.prototype.hasOwnProperty.call(CONNECTION_COLORS, type)) {
          result.warnings.push({ line: lineNumber, message: `未知的连接类型 "${type}"，将使用 "other"`, code: 'UNKNOWN_STATEMENT' });
        }
        result.assigns.push({ ref, pin, role, type, bus: bus ? parseInt(bus, 10) : undefined, line: lineNumber });
        continue;
      }

      const connectMatch = line.match(CONNECT_REGEX);
      if (connectMatch) {
        const [, fromRef, fromPin, arrow, toRef, toPin, type, bus, note] = connectMatch;
        result.connections.push({
          fromRef,
          fromPin,
          toRef,
          toPin,
          type: Object.prototype.hasOwnProperty.call(CONNECTION_COLORS, type) ? type : 'other',
          bus: bus ? parseInt(bus, 10) : undefined,
          note,
          arrow,
          line: lineNumber,
        });
        continue;
      }

      result.warnings.push({ line: lineNumber, message: `无法识别的语句: "${line}"`, code: 'UNKNOWN_STATEMENT' });
    }

    const validRefs = new Set(['board', ...result.uses.map((item) => item.alias)]);
    for (const conn of result.connections) {
      if (!validRefs.has(conn.fromRef)) {
        result.errors.push({ line: conn.line, message: `连线引用了未声明的组件 "${conn.fromRef}"，请先使用 USE 声明`, code: 'UNKNOWN_REF', source: `${conn.fromRef}.${conn.fromPin}` });
      }
      if (!validRefs.has(conn.toRef)) {
        result.errors.push({ line: conn.line, message: `连线引用了未声明的组件 "${conn.toRef}"，请先使用 USE 声明`, code: 'UNKNOWN_REF', source: `${conn.toRef}.${conn.toPin}` });
      }
    }

    return result;
  }

  function hasErrors(result) {
    return Array.isArray(result?.errors) && result.errors.length > 0;
  }

  function formatErrors(result) {
    if (!result?.errors?.length) {
      return '';
    }
    const lines = ['## AWS 解析错误\n'];
    for (const error of result.errors) {
      lines.push(`- **行 ${error.line}**: ${error.message}`);
      if (error.source) {
        lines.push(`  源码: \`${error.source}\``);
      }
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

  function validateConnectionGraph(data) {
    const results = [];
    const { connections = [], components = [] } = data || {};

    for (const conn of connections) {
      const fromIsGnd = conn.from.function === 'GND' || conn.type === 'gnd';
      const toIsPower = /VCC|3V3|5V/.test(conn.to.function) || conn.type === 'power';
      const fromIsPower = /VCC|3V3|5V/.test(conn.from.function) || conn.type === 'power';
      const toIsGnd = conn.to.function === 'GND' || conn.type === 'gnd';
      if ((fromIsGnd && toIsPower) || (fromIsPower && toIsGnd)) {
        results.push({ ruleId: 'vcc_to_gnd', level: 'error', message: `连线 ${conn.id}: GND 直连 VCC/电源，会导致短路` });
      }
    }

    for (const conn of connections) {
      if (conn.type === 'uart') {
        if (conn.from.function === 'TX' && conn.to.function === 'TX') {
          results.push({ ruleId: 'uart_crossover', level: 'error', message: `连线 ${conn.id}: UART TX 应连接到 RX，不应 TX→TX` });
        }
        if (conn.from.function === 'RX' && conn.to.function === 'RX') {
          results.push({ ruleId: 'uart_crossover', level: 'error', message: `连线 ${conn.id}: UART RX 应连接到 TX，不应 RX→RX` });
        }
      }
    }

    const pinUsage = new Map();
    for (const conn of connections) {
      const fromKey = `${conn.from.ref}.${conn.from.pinId}`;
      const toKey = `${conn.to.ref}.${conn.to.pinId}`;
      if (!pinUsage.has(fromKey)) pinUsage.set(fromKey, []);
      if (!pinUsage.has(toKey)) pinUsage.set(toKey, []);
      pinUsage.get(fromKey).push(conn.id);
      pinUsage.get(toKey).push(conn.id);
    }
    for (const [pin, connIds] of pinUsage.entries()) {
      if (connIds.length > 1) {
        const connTypes = connIds.map((id) => connections.find((item) => item.id === id)?.type);
        const allBus = connTypes.every((type) => type === 'i2c' || type === 'spi');
        if (!allBus) {
          results.push({ ruleId: 'pin_conflict', level: 'warning', message: `引脚 ${pin} 被多条连线使用: ${connIds.join(', ')}` });
        }
      }
    }

    const refs = new Set();
    for (const conn of connections) {
      refs.add(conn.from.ref);
      refs.add(conn.to.ref);
    }
    const boardRef = components.length > 0 ? components[0].refId : '';
    for (const ref of refs) {
      if (ref === boardRef) continue;
      const hasPower = connections.some((conn) => (conn.to.ref === ref && conn.type === 'power') || (conn.from.ref === ref && conn.type === 'power'));
      const hasGnd = connections.some((conn) => (conn.to.ref === ref && conn.type === 'gnd') || (conn.from.ref === ref && conn.type === 'gnd'));
      if (!hasPower) results.push({ ruleId: 'missing_power', level: 'warning', message: `组件 ${ref} 缺少电源连接` });
      if (!hasGnd) results.push({ ruleId: 'missing_power', level: 'warning', message: `组件 ${ref} 缺少接地连接` });
    }

    return results;
  }

  function getConnectionGraphPath(projectPath) {
    const basePath = projectContext.resolveProjectPath(projectPath) || projectContext.readCurrentProjectPath();
    return path.join(basePath, 'connection_output.json');
  }

  function getConnectionGraph(projectPath) {
    try {
      const filePath = getConnectionGraphPath(projectPath);
      return fs.existsSync(filePath) ? projectContext.readJsonFile(filePath) : null;
    } catch (_error) {
      return null;
    }
  }

  function hasConnectionGraph(projectPath) {
    return fs.existsSync(getConnectionGraphPath(projectPath));
  }

  function getAWSFilePath(projectPath) {
    const basePath = projectContext.resolveProjectPath(projectPath) || projectContext.readCurrentProjectPath();
    return path.join(basePath, 'connection.aws');
  }

  function getJSONFilePath(projectPath) {
    return getConnectionGraphPath(projectPath);
  }

  function saveAWSFile(awsContent, projectPath) {
    try {
      fs.writeFileSync(getAWSFilePath(projectPath), String(awsContent || ''));
      return true;
    } catch (_error) {
      return false;
    }
  }

  function readAWSFile(projectPath) {
    try {
      const filePath = getAWSFilePath(projectPath);
      return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
    } catch (_error) {
      return null;
    }
  }

  function hasAWSFile(projectPath) {
    return fs.existsSync(getAWSFilePath(projectPath));
  }

  function saveJSONFile(data, projectPath) {
    try {
      fs.writeFileSync(getJSONFilePath(projectPath), JSON.stringify(data, null, 2));
      return true;
    } catch (_error) {
      return false;
    }
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

### ASSIGN - 引脚重映射
\`\`\`
ASSIGN <组件.引脚> AS <角色> @<类型>:<总线号>
\`\`\`
`.trim();

  return {
    CONNECTION_COLORS,
    AWS_SYNTAX_REFERENCE,
    inferDataFlow,
    parseAWS,
    hasErrors,
    formatErrors,
    resolvePin,
    generatePinmapSummary,
    validateConnectionGraph,
    getConnectionGraphPath,
    getConnectionGraph,
    hasConnectionGraph,
    getAWSFilePath,
    getJSONFilePath,
    saveAWSFile,
    readAWSFile,
    hasAWSFile,
    saveJSONFile,
  };
}

module.exports = {
  createAwsService,
};
