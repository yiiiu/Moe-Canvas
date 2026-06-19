import test from 'node:test';
import assert from 'node:assert/strict';
import { processInputImages } from './imageUploadApi.js';

async function readUploadedFileText(body) {
  for (const [key, value] of body.entries()) {
    if (key === 'file' && value && typeof value.text === 'function') {
      return await value.text();
    }
  }
  return '';
}

test('imageUploadApi: 源节点 localPath 对象会按本地图片路径上传', async () => {
  const originalFetch = globalThis.fetch;
  const fetchedUrls = [];
  globalThis.fetch = async (url, options = {}) => {
    const normalizedUrl = String(url || '');
    fetchedUrls.push(normalizedUrl);
    if (normalizedUrl === '/data/uploads/upload_j5uy9r_【哲风壁纸】动漫-女孩-美女.jpg') {
      return new Response(new Blob(['local-image'], { type: 'image/jpeg' }), { status: 200 });
    }
    if (normalizedUrl === 'https://telegra.ph/upload') {
      assert.equal(await readUploadedFileText(options.body), 'local-image');
      return new Response(JSON.stringify([{ src: '/local-image.png' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch: ${normalizedUrl}`);
  };

  try {
    const result = await processInputImages([
      { localPath: 'data/uploads/upload_j5uy9r_【哲风壁纸】动漫-女孩-美女.jpg' },
    ], '', { compress: false });

    assert.deepEqual(result, ['https://telegra.ph/local-image.png']);
    assert.equal(fetchedUrls[0], '/data/uploads/upload_j5uy9r_【哲风壁纸】动漫-女孩-美女.jpg');
  } finally {
    globalThis.fetch = originalFetch;
  }
});