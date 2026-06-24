function a339_0x2697(){const _0x5b1101=['21cKupxu','45FmPWEK','parkCandidateIds','pick-source','has','child-1','rendererVirtualization:\x20dense\x20low\x20zoom\x20uses\x20tighter\x20parking\x20buffers','src','equal','pinned','dup-child','2338104PSLpwh','child-3','rendererVirtualization:\x20viewport\x20padding\x20命中进入阈值','near','child-2','a-child','drag-child','root','rendererVirtualization:\x20双阈值滞回会分离\x20mount\x20与\x20park\x20候选','4702160Xrsrdr','mountCandidateIds','667326VzCQIU','pick-hover','rendererVirtualization:\x20深层\x20descendants\x20仍会被全部纳入\x20keepAlive','rendererVirtualization:\x20keepAlive\x20会覆盖选中\x20拖拽\x20descendants\x20与\x20pin','141255WgvcYu','2196882QWfaXP','rendererVirtualization:\x20重复\x20child\x20不会重复入队','2569338LpZXzr','1348174BjzwHd','deepEqual','far','dup','dragRoot'];a339_0x2697=function(){return _0x5b1101;};return a339_0x2697();}const a339_0x452ad5=a339_0xf6f8;(function(_0xd5163c,_0x195b8a){const _0x4c3362=a339_0xf6f8,_0x488e31=_0xd5163c();while(!![]){try{const _0x5380ca=-parseInt(_0x4c3362(0x1e5))/0x1+parseInt(_0x4c3362(0x200))/0x2+parseInt(_0x4c3362(0x205))/0x3+-parseInt(_0x4c3362(0x1f5))/0x4+-parseInt(_0x4c3362(0x204))/0x5+parseInt(_0x4c3362(0x1e4))/0x6*(-parseInt(_0x4c3362(0x1ea))/0x7)+parseInt(_0x4c3362(0x1fe))/0x8*(parseInt(_0x4c3362(0x1eb))/0x9);if(_0x5380ca===_0x195b8a)break;else _0x488e31['push'](_0x488e31['shift']());}catch(_0x113072){_0x488e31['push'](_0x488e31['shift']());}}}(a339_0x2697,0xb9593));import{test}from'node:test';function a339_0xf6f8(_0x4be5cc,_0xff36c5){const _0x2697ca=a339_0x2697();return a339_0xf6f8=function(_0xf6f876,_0x33f283){_0xf6f876=_0xf6f876-0x1e3;let _0x4df22e=_0x2697ca[_0xf6f876];return _0x4df22e;},a339_0xf6f8(_0x4be5cc,_0xff36c5);}import a339_0x11b074 from'node:assert/strict';import{buildVirtualizationCandidateSets,collectVirtualKeepAliveNodeIds,isNodeInsideViewportPadding,resolveRendererVirtualizationPadding}from'./rendererVirtualization.js';test(a339_0x452ad5(0x1f7),()=>{const _0x11929f=a339_0x452ad5,_0x249b33=isNodeInsideViewportPadding({'id':'n1','x':0x384,'y':0x0,'width':0xc8,'height':0x78},{'x':0x0,'y':0x0,'zoom':0x1},0x3e8,0x320,0x78),_0x1497ab=isNodeInsideViewportPadding({'id':'n2','x':0x514,'y':0x0,'width':0xc8,'height':0x78},{'x':0x0,'y':0x0,'zoom':0x1},0x3e8,0x320,0x50);a339_0x11b074[_0x11929f(0x1f2)](_0x249b33,!![]),a339_0x11b074[_0x11929f(0x1f2)](_0x1497ab,![]);}),test(a339_0x452ad5(0x203),()=>{const _0x511f70=a339_0x452ad5,_0x2979e6=collectVirtualKeepAliveNodeIds({'selectedNodeIds':['a'],'dragContext':{'isDragging':!![],'targetNodeId':_0x511f70(0x1e9)},'connOverlay':{'srcId':_0x511f70(0x1f1),'hoverId':'hover'},'pickConnectMode':{'sourceNodeId':'pick-source','hoverNodeId':_0x511f70(0x201)},'parentToChildren':{'a':new Set([_0x511f70(0x1fa)]),'dragRoot':new Set([_0x511f70(0x1fb)])},'pinnedNodeIds':new Set([_0x511f70(0x1f3)])});a339_0x11b074[_0x511f70(0x1e6)](new Set(_0x2979e6),new Set(['a',_0x511f70(0x1fa),_0x511f70(0x1e9),_0x511f70(0x1fb),_0x511f70(0x1f1),'hover',_0x511f70(0x1ed),'pick-hover',_0x511f70(0x1f3)]));}),test(a339_0x452ad5(0x1fd),()=>{const _0x2709f9=a339_0x452ad5,_0x19ac39=buildVirtualizationCandidateSets({'nodes':{'near':{'id':_0x2709f9(0x1f8),'x':0x4b0,'y':0x0,'width':0xc8,'height':0x78},'far':{'id':'far','x':0x7d0,'y':0x0,'width':0xc8,'height':0x78},'pinned':{'id':_0x2709f9(0x1f3),'x':0xfa0,'y':0x0,'width':0xc8,'height':0x78}},'viewport':{'x':0x0,'y':0x0,'zoom':0x1},'containerWidth':0x3e8,'containerHeight':0x320,'pinnedNodeIds':new Set([_0x2709f9(0x1f3)]),'mountPadding':0x258,'parkPadding':0x384});a339_0x11b074['equal'](_0x19ac39[_0x2709f9(0x1ff)][_0x2709f9(0x1ee)]('near'),!![]),a339_0x11b074['equal'](_0x19ac39['parkCandidateIds'][_0x2709f9(0x1ee)]('near'),![]),a339_0x11b074[_0x2709f9(0x1f2)](_0x19ac39[_0x2709f9(0x1ff)][_0x2709f9(0x1ee)](_0x2709f9(0x1e7)),![]),a339_0x11b074[_0x2709f9(0x1f2)](_0x19ac39[_0x2709f9(0x1ec)][_0x2709f9(0x1ee)](_0x2709f9(0x1e7)),!![]),a339_0x11b074[_0x2709f9(0x1f2)](_0x19ac39[_0x2709f9(0x1ff)][_0x2709f9(0x1ee)](_0x2709f9(0x1f3)),!![]),a339_0x11b074[_0x2709f9(0x1f2)](_0x19ac39[_0x2709f9(0x1ec)][_0x2709f9(0x1ee)](_0x2709f9(0x1f3)),![]);}),test(a339_0x452ad5(0x202),()=>{const _0xdf4410=a339_0x452ad5,_0x5795cf=collectVirtualKeepAliveNodeIds({'selectedNodeIds':[_0xdf4410(0x1fc)],'parentToChildren':{'root':new Set([_0xdf4410(0x1ef)]),'child-1':[_0xdf4410(0x1f9)],'child-2':(function*(){const _0x5cb228=_0xdf4410;yield _0x5cb228(0x1f6);}())}});a339_0x11b074['deepEqual'](new Set(_0x5795cf),new Set(['root','child-1',_0xdf4410(0x1f9),_0xdf4410(0x1f6)]));}),test(a339_0x452ad5(0x1e3),()=>{const _0xc997e3=a339_0x452ad5,_0x534b4d=collectVirtualKeepAliveNodeIds({'selectedNodeIds':[_0xc997e3(0x1fc)],'parentToChildren':{'root':[_0xc997e3(0x1e8),_0xc997e3(0x1e8),_0xc997e3(0x1f4)],'dup':[_0xc997e3(0x1f4)],'dup-child':[]}});a339_0x11b074[_0xc997e3(0x1e6)](new Set(_0x534b4d),new Set([_0xc997e3(0x1fc),'dup',_0xc997e3(0x1f4)]));}),test(a339_0x452ad5(0x1f0),()=>{const _0x9069a3=a339_0x452ad5;a339_0x11b074[_0x9069a3(0x1e6)](resolveRendererVirtualizationPadding({'viewport':{'x':0x0,'y':0x0,'zoom':0.28},'nodeCount':0x9c}),{'mountPadding':0x140,'parkPadding':0x208}),a339_0x11b074[_0x9069a3(0x1e6)](resolveRendererVirtualizationPadding({'viewport':{'x':0x0,'y':0x0,'zoom':0.4},'nodeCount':0x64}),{'mountPadding':0x1a4,'parkPadding':0x28a}),a339_0x11b074[_0x9069a3(0x1e6)](resolveRendererVirtualizationPadding({'viewport':{'x':0x0,'y':0x0,'zoom':0.4},'nodeCount':0x14}),{'mountPadding':0x258,'parkPadding':0x384});});

function createVirtualizationBoundaryNodes(count) {
  const nodes = {};
  for (let index = 0; index < count; index += 1) {
    nodes[`node-${index}`] = {
      id: `node-${index}`,
      x: index * 180,
      y: 0,
      width: 120,
      height: 80,
    };
  }
  return nodes;
}

test('rendererVirtualization: 300/500/1000 低缩放大节点数继续使用最紧 mount buffer', () => {
  for (const nodeCount of [300, 500, 1000]) {
    a339_0x11b074.deepEqual(
      resolveRendererVirtualizationPadding({
        viewport: { x: 0, y: 0, zoom: 0.28 },
        nodeCount,
      }),
      { mountPadding: 320, parkPadding: 520 },
    );
  }
});

test('rendererVirtualization: 大节点数低缩放仍保留交互相关节点 keepAlive', () => {
  const nodes = createVirtualizationBoundaryNodes(500);
  Object.assign(nodes, {
    selected: { id: 'selected', x: 20000, y: 0, width: 120, height: 80 },
    selectedChild: { id: 'selectedChild', x: 20200, y: 0, width: 120, height: 80 },
    dragging: { id: 'dragging', x: 20400, y: 0, width: 120, height: 80 },
    dragChild: { id: 'dragChild', x: 20600, y: 0, width: 120, height: 80 },
    src: { id: 'src', x: 20800, y: 0, width: 120, height: 80 },
    hover: { id: 'hover', x: 21000, y: 0, width: 120, height: 80 },
    pinned: { id: 'pinned', x: 21200, y: 0, width: 120, height: 80 },
  });

  const result = buildVirtualizationCandidateSets({
    nodes,
    viewport: { x: 0, y: 0, zoom: 0.28 },
    containerWidth: 1000,
    containerHeight: 800,
    selectedNodeIds: ['selected'],
    dragContext: { isDragging: true, targetNodeId: 'dragging' },
    connOverlay: { srcId: 'src', hoverId: 'hover' },
    parentToChildren: {
      selected: ['selectedChild'],
      dragging: ['dragChild'],
    },
    pinnedNodeIds: new Set(['pinned']),
  });

  for (const id of ['selected', 'selectedChild', 'dragging', 'dragChild', 'src', 'hover', 'pinned']) {
    a339_0x11b074.equal(result.keepAliveNodeIds.has(id), true);
    a339_0x11b074.equal(result.mountCandidateIds.has(id), true);
    a339_0x11b074.equal(result.parkCandidateIds.has(id), false);
  }
});

test('rendererVirtualization: 大节点数低缩放同屏外节点进入 park 候选', () => {
  const nodes = createVirtualizationBoundaryNodes(130);
  nodes.near = { id: 'near', x: 5200, y: 0, width: 120, height: 80 };
  nodes.far = { id: 'far', x: 10000, y: 0, width: 120, height: 80 };

  const result = buildVirtualizationCandidateSets({
    nodes,
    viewport: { x: 0, y: 0, zoom: 0.28 },
    containerWidth: 1000,
    containerHeight: 800,
  });

  a339_0x11b074.equal(result.mountCandidateIds.has('near'), false);
  a339_0x11b074.equal(result.parkCandidateIds.has('near'), false);
  a339_0x11b074.equal(result.mountCandidateIds.has('far'), false);
  a339_0x11b074.equal(result.parkCandidateIds.has('far'), true);
});