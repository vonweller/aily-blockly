const SCHEMATIC_TOOL_DEFINITIONS = [
  {
    name: 'generate_schematic',
    description: '生成硬件接线图的核心工具，返回引脚摘要与 AWS 编写依据。',
    input_schema: {
      type: 'object',
      properties: {
        pinmapIds: {
          type: 'array',
          items: {
            oneOf: [
              { type: 'string' },
              {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  alias: { type: 'string' },
                  label: { type: 'string' },
                },
                required: ['id'],
              },
            ],
          },
        },
        components: {
          type: 'array',
          items: { type: 'string' },
        },
        requirements: {
          type: 'string',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_pinmap_summary',
    description: '获取当前项目的引脚摘要信息。',
    input_schema: {
      type: 'object',
      properties: {
        pinmapIds: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      required: [],
    },
  },
  {
    name: 'get_component_catalog',
    description: '获取当前项目的组件目录，包括开发板、硬件库和软件库。',
    input_schema: {
      type: 'object',
      properties: {
        libraryFilter: { type: 'string' },
        includeNeedsGeneration: { type: 'boolean', default: true },
        includeBoards: { type: 'boolean', default: true },
      },
      required: [],
    },
  },
  {
    name: 'get_project_context',
    description: '获取组件目录和当前生成的 C++ 代码。',
    input_schema: {
      type: 'object',
      properties: {
        includeNeedsGeneration: { type: 'boolean', default: true },
      },
      required: [],
    },
  },
  {
    name: 'validate_schematic',
    description: '验证 AWS 接线图并保存，这是接线工作流的最终步骤。',
    input_schema: {
      type: 'object',
      properties: {
        aws: { type: 'string' },
      },
      required: [],
    },
  },
  {
    name: 'get_current_schematic',
    description: '读取当前项目已保存的连线图完整内容。',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'generate_pinmap',
    description: '为缺少引脚配置的组件准备生成素材。',
    input_schema: {
      type: 'object',
      properties: {
        pinmapId: { type: 'string' },
        referenceSource: {
          type: 'string',
          enum: ['readme', 'example', 'auto'],
          default: 'auto',
        },
      },
      required: ['pinmapId'],
    },
  },
  {
    name: 'save_pinmap',
    description: '保存生成的 pinmap JSON 到库目录，并更新 catalog 状态。',
    input_schema: {
      type: 'object',
      properties: {
        pinmapId: { type: 'string' },
        pinmapConfig: { type: 'object' },
      },
      required: ['pinmapId', 'pinmapConfig'],
    },
  },
];

module.exports = {
  SCHEMATIC_TOOL_DEFINITIONS,
};
