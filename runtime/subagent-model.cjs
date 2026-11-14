'use strict';

// Provider IDs are scoped to the service selected by the parent conversation.
// Keep catalogue identities until the local runtime builds the provider request.
function resolveSubagentModel(request, parent, child, catalog) {
  const parentId = parent?.selectedModels?.[0]?.modelId ?? parent?.modelName;
  const childId = child?.selectedModels?.[0]?.modelId ?? child?.modelName;
  const requested = request.modelId;
  const inherited = request.resumeAgentId && catalog[childId] ? childId : parentId;
  let modelId = requested;
  if (!requested || requested === 'default') modelId = inherited;
  else if (catalog[parentId] && !catalog[requested]) {
    const serviceId = catalog[parentId].serviceId;
    modelId = Object.keys(catalog).find(name => catalog[name].serviceId === serviceId && catalog[name].modelId === requested) ?? requested;
  }
  if (!catalog[modelId]) return request;
  const selection = modelId === childId && request.resumeAgentId ? child : parent;
  const parameters = selection?.selectedModels?.find(model => model.modelId === modelId)?.parameters;
  return { ...request, modelId, modelParameters: request.modelParameters?.length ? request.modelParameters : parameters };
}

module.exports = { resolveSubagentModel };
