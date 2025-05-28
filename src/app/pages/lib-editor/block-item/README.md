# BlockItemComponent 使用说明

## 概述
`BlockItemComponent` 是一个用于显示单个 Blockly block 的 Angular 组件。它可以根据提供的 block 定义 JSON 来渲染和显示对应的 block。

## 功能特性
- ✅ 支持任意 Blockly block 定义的显示
- ✅ 只读模式和交互模式
- ✅ 自定义主题和渲染器
- ✅ 错误处理和显示
- ✅ 自动居中显示 block
- ✅ 点击事件支持
- ✅ 响应式设计

## 输入属性 (Inputs)

| 属性名 | 类型 | 默认值 | 描述 |
|--------|------|--------|------|
| `blockDefinition` | `any` | - | **必需**。单个 block 的定义 JSON |
| `readOnly` | `boolean` | `true` | 是否为只读模式 |
| `theme` | `string` | `'zelos'` | Blockly 主题 |
| `renderer` | `string` | `'zelos'` | Blockly 渲染器 |
| `showError` | `boolean` | `false` | 是否显示错误信息 |

## 输出事件 (Outputs)

| 事件名 | 参数类型 | 描述 |
|--------|----------|------|
| `blockClicked` | `any` | 当 block 被点击时触发 |
| `blockError` | `string` | 当 block 创建失败时触发，参数为错误消息 |

## 公共方法

| 方法名 | 返回值 | 描述 |
|--------|--------|------|
| `refresh()` | `void` | 刷新显示，重新创建 block |
| `getBlock()` | `Blockly.Block \| null` | 获取当前的 block 实例 |
| `hasError` | `boolean` | 是否有错误 (getter) |
| `error` | `string` | 错误消息 (getter) |

## 使用示例

### 基本用法
```html
<app-block-item 
  [blockDefinition]="myBlockDef"
  [readOnly]="true">
</app-block-item>
```

### 完整配置
```html
<app-block-item 
  [blockDefinition]="blockDef"
  [readOnly]="false"
  [theme]="'classic'"
  [renderer]="'thrasos'"
  [showError]="true"
  (blockClicked)="onBlockClicked($event)"
  (blockError)="onBlockError($event)">
</app-block-item>
```

### TypeScript 代码示例
```typescript
export class MyComponent {
  // 简单文本 block 定义
  blockDef = {
    "type": "text",
    "message0": "文本 %1",
    "args0": [
      {
        "type": "field_input",
        "name": "TEXT",
        "text": "hello"
      }
    ],
    "output": "String",
    "colour": 160,
    "tooltip": "返回一个文本字符串",
    "helpUrl": ""
  };

  onBlockClicked(block: any) {
    console.log('Block 被点击:', block);
  }

  onBlockError(error: string) {
    console.error('Block 错误:', error);
  }
}
```

## Block 定义 JSON 格式

Block 定义应遵循 Blockly 的标准格式：

```typescript
interface BlockDefinition {
  type: string;           // Block 类型名称（必需）
  message0?: string;      // 主要显示消息
  args0?: Array<any>;     // 参数数组
  output?: string;        // 输出类型
  previousStatement?: any; // 前置连接
  nextStatement?: any;    // 后置连接
  colour?: number;        // 颜色
  tooltip?: string;       // 提示文本
  helpUrl?: string;       // 帮助链接
  // ... 其他 Blockly 属性
}
```

## 样式定制

组件提供了以下 CSS 类用于样式定制：

- `.block-item-container` - 主容器
- `.blockPreview` - Block 预览区域
- `.blockPreview.error` - 错误状态的预览区域
- `.error-message` - 错误消息容器

### 自定义样式示例
```scss
app-block-item {
  .blockPreview {
    height: 80px; // 自定义高度
    border-radius: 8px; // 自定义圆角
  }
  
  .error-message {
    background-color: #your-color; // 自定义错误背景色
  }
}
```

## 注意事项

1. **Block 定义验证**：确保提供的 `blockDefinition` 包含有效的 `type` 属性
2. **媒体路径**：确认 Blockly 媒体资源路径正确设置（默认为 `assets/blockly/media/`）
3. **性能考虑**：在列表中使用大量 `BlockItemComponent` 时，建议使用虚拟滚动
4. **错误处理**：建议启用 `showError` 属性以便调试 block 定义问题

## 常见问题

### Q: Block 没有显示？
A: 检查 `blockDefinition` 是否包含有效的 `type` 属性，以及 Blockly 媒体资源是否正确加载。

### Q: 如何自定义 Block 尺寸？
A: 通过 CSS 调整 `.blockPreview` 的 `height` 和 `width` 属性。

### Q: 支持哪些 Blockly 主题？
A: 支持所有 Blockly 官方主题，如 'classic', 'modern', 'deuteranopia', 'tritanopia', 'zelos' 等。
