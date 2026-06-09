export const GRSAI_IMAGE_RESULT_PATHS = Object.freeze([
  'data.result.images[].url',
  'result.images[].url',
  'data[].url',
  'data[].image',
  'results[].url',
  'results[].imageUrl',
  'url',
  'imageUrl',
  'image_url',
  'data.imageUrl',
  'data.image_url',
  'data.image',
  'data.result',
  'data.result.url',
  'data.result.imageUrl',
  'data.result.image_url',
  'data.result.image',
  'data.result.output',
  'data.result.outputUrl',
  'data.result.output_url',
  'data.result.resultUrl',
  'data.result.result_url',
  'data.output',
  'data.output.url',
  'data.output.imageUrl',
  'data.output.image_url',
  'data.output.image',
  'data.output.urls',
  'data.output.imageUrls',
  'data.output.image_urls',
  'data.urls',
  'data.imageUrls',
  'data.image_urls',
  'data.outputUrl',
  'data.output_url',
  'data.resultUrl',
  'data.result_url',
  'output',
  'output.url',
  'output.imageUrl',
  'output.image_url',
  'output.image',
  'output.urls',
  'output.imageUrls',
  'output.image_urls',
  'outputUrl',
  'output_url',
  'resultUrl',
  'result_url',
  'urls',
  'imageUrls',
  'image_urls',
]);

export function mergeGrsaiImageResponseMapping(responseMapping = {}) {
  const mapping = responseMapping && typeof responseMapping === 'object' ? responseMapping : {};
  const existingPaths = Array.isArray(mapping.resultPaths)
    ? mapping.resultPaths
    : mapping.resultPaths
      ? [mapping.resultPaths]
      : [];

  return {
    ...mapping,
    resultPaths: Array.from(new Set([
      ...existingPaths.map((path) => String(path || '').trim()).filter(Boolean),
      ...GRSAI_IMAGE_RESULT_PATHS,
    ])),
  };
}