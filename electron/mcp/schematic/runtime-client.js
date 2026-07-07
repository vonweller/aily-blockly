class SchematicRuntimeClient {
  constructor(rendererBridge) {
    this.rendererBridge = rendererBridge;
  }

  async invoke(method, args = {}, options = {}) {
    return this.rendererBridge.request({
      namespace: 'schematic',
      method,
      args,
      targetProjectPath: options.targetProjectPath,
      timeoutMs: options.timeoutMs,
    });
  }
}

module.exports = {
  SchematicRuntimeClient,
};
