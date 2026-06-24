import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getPerfProbeSnapshot,
  recordCanvasPanSample,
  recordEdgeRedrawSample,
  recordMinimapUpdateSample,
  recordRenderFrameSample,
  resetPerfProbeData,
  setPerfProbeEnabled,
} from './perfProbe.js';

function installPerfProbeDomStubs({ resources = [], mediaElements = [] } = {}) {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousPerformance = globalThis.performance;

  const document = {
    querySelectorAll(selector) {
      if (selector === 'img, video, audio, source, image') return mediaElements;
      return [];
    },
  };
  const performance = {
    now: () => 1000,
    getEntriesByType(type) {
      if (type === 'resource') return resources;
      return [];
    },
  };

  globalThis.document = document;
  globalThis.performance = performance;
  globalThis.window = {
    location: { href: 'http://127.0.0.1/' },
    document,
    performance,
    __perfProbeEnabled: true,
  };

  return () => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;

    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;

    if (previousPerformance === undefined) delete globalThis.performance;
    else globalThis.performance = previousPerformance;
  };
}

test('perfProbe: snapshot exposes canvas capacity fields', () => {
  const restore = installPerfProbeDomStubs();
  try {
    setPerfProbeEnabled(true);
    resetPerfProbeData();

    recordCanvasPanSample({
      durationMs: 12,
      moveCount: 4,
      committed: true,
      nodeCount: 500,
      edgeCount: 240,
      mountedNodeCount: 96,
      minimapPreviewCount: 3,
      finalX: 10,
      finalY: -20,
      finalZoom: 0.75,
    });
    recordRenderFrameSample({
      mode: 'viewport',
      durationMs: 18,
      nodeCount: 500,
      edgeCount: 240,
      mountedNodeCount: 96,
      parkedNodeCount: 404,
    });
    recordEdgeRedrawSample('visible', 8, {
      edgeCount: 240,
      visibleEdgeCount: 42,
      updatedCount: 12,
      skippedInvisibleCount: 198,
    });
    recordMinimapUpdateSample('viewport', 3, {
      nodeCount: 500,
      dotCount: 500,
      viewportOnly: true,
    });

    const snapshot = getPerfProbeSnapshot();

    assert.equal(snapshot.canvasPanSamples.at(-1).nodeCount, 500);
    assert.equal(snapshot.canvasPanSamples.at(-1).edgeCount, 240);
    assert.equal(snapshot.canvasPanSamples.at(-1).mountedNodeCount, 96);
    assert.equal(snapshot.renderFrameSamples.at(-1).nodeCount, 500);
    assert.equal(snapshot.renderFrameSamples.at(-1).mountedNodeCount, 96);
    assert.equal(snapshot.renderFrameSamples.at(-1).parkedNodeCount, 404);
    assert.equal(snapshot.edgeRedrawSamples.at(-1).edgeCount, 240);
    assert.equal(snapshot.edgeRedrawSamples.at(-1).visibleEdgeCount, 42);
    assert.equal(snapshot.minimapUpdateSamples.at(-1).dotCount, 500);
  } finally {
    restore();
  }
});

test('perfProbe: snapshot exposes static and DOM media capacity fields', () => {
  const restore = installPerfProbeDomStubs({
    resources: [
      {
        name: '/output/gen-video.mp4',
        initiatorType: 'video',
        transferSize: 0,
        encodedBodySize: 2048,
        decodedBodySize: 4096,
        duration: 7,
      },
      {
        name: '/data/assets/derived/thumb.webp',
        initiatorType: 'img',
        transferSize: 512,
        encodedBodySize: 1024,
        decodedBodySize: 2048,
        duration: 4,
      },
    ],
    mediaElements: [
      {
        tagName: 'IMG',
        currentSrc: '/output/preview.png',
      },
      {
        tagName: 'VIDEO',
        currentSrc: '/data/uploads/movie.webm',
      },
    ],
  });
  try {
    setPerfProbeEnabled(true);
    resetPerfProbeData();

    const summary = getPerfProbeSnapshot().staticMediaResourceSummary;

    assert.equal(summary.resourceCount, 2);
    assert.equal(summary.staticMediaCount, 3);
    assert.equal(summary.derivedMediaCount, 1);
    assert.equal(summary.cacheableVideoCount, 2);
    assert.equal(summary.domMediaElementCount, 1);
    assert.equal(summary.transferSize, 512);
    assert.equal(summary.encodedBodySize, 3072);
    assert.equal(summary.decodedBodySize, 6144);
  } finally {
    restore();
  }
});