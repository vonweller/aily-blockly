function createRuntimeAdapter(runtimeClient) {
  async function getGeneratedCppCode(targetProjectPath) {
    try {
      const response = await runtimeClient.invoke('get_generated_cpp_code', {}, { targetProjectPath });
      if (response?.ok === true && typeof response?.result?.cppCode === 'string') {
        return response.result.cppCode;
      }
    } catch (_error) {
      // ignore
    }
    return '';
  }

  async function previewSchematicComponents(payload, targetProjectPath) {
    return runtimeClient.invoke('preview_schematic_components', payload, { targetProjectPath });
  }

  async function notifySchematicSaved(payload, targetProjectPath) {
    return runtimeClient.invoke('notify_schematic_saved', payload, { targetProjectPath });
  }

  return {
    getGeneratedCppCode,
    previewSchematicComponents,
    notifySchematicSaved,
  };
}

module.exports = {
  createRuntimeAdapter,
};
