const definition = {
  name: 'generate_pinmap',
  description: '为缺少引脚配置的组件准备生成素材。',
  input_schema: {
    type: 'object',
    properties: {
      pinmapId: { type: 'string' },
      referenceSource: { type: 'string', enum: ['readme', 'example', 'auto'], default: 'auto' },
      path: { type: 'string' },
      projectPath: { type: 'string' },
    },
    required: ['pinmapId'],
  },
};

function createHandler(services) {
  return async function generatePinmap(args = {}) {
    const pinmapId = typeof args.pinmapId === 'string' ? args.pinmapId.trim() : '';
    if (!pinmapId) {
      return { is_error: true, content: '缺少必需参数 pinmapId。请提供目标组件的完整标识符，如 "lib-servo:sg90:default"。' };
    }
    const packagesBasePath = services.projectContext.resolvePackagesBasePath(args.path || args.projectPath || '');
    if (!packagesBasePath) {
      return { is_error: true, content: '当前没有打开的项目，无法定位组件包。' };
    }
    const ref = services.catalogService.parsePinmapId(pinmapId);
    const variantInfo = services.pinmapService.findVariantInfo(pinmapId, packagesBasePath);
    const libraryInfo = services.pinmapService.getLibraryInfo(pinmapId, packagesBasePath);
    const protocol = variantInfo?.protocol || 'other';
    const template = services.pinmapService.getPinmapTemplate(protocol);
    return {
      is_error: false,
      content: JSON.stringify({
        targetPinmapId: pinmapId,
        parsedRef: ref,
        variantInfo: variantInfo ? {
          name: variantInfo.name,
          protocol: variantInfo.protocol,
          manufacturer: variantInfo.manufacturer,
          voltage: variantInfo.voltage,
          note: variantInfo.note,
        } : undefined,
        readme: libraryInfo.readme,
        exampleCode: libraryInfo.exampleCode,
        pinmapTemplate: template,
        instructions: `根据 pinmapTemplate 结构和 readme 信息生成 pinmap 配置。\n\n## 关键规则\n\n1. **id**: 使用 "component_${ref.modelId}_${ref.variantId}"\n2. **尺寸计算**:\n   - height = max(左侧引脚数, 右侧引脚数) × 20 + 40\n   - width = 根据引脚名称长度调整，通常 120-200，名称长则增大\n3. **引脚位置**:\n   - y 值: 首个 y≈32，间距 20\n   - 左侧引脚: x≈10, labelX≈-20, labelAnchor="right"\n   - 右侧引脚: x≈width-15, labelX≈width+12, labelAnchor="left"\n   - labelY = y - 7\n4. **images.url**: 使用可渲染图片的 base64（如 data:image/png;base64,...）\n5. **images**: 必须保留 images 字段\n\n## 保存\n\n生成后调用：save_pinmap(pinmapId="${pinmapId}", pinmapConfig={JSON})`,
      }, null, 2),
    };
  };
}

module.exports = {
  definition,
  createHandler,
};
