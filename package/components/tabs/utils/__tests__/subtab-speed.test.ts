import { describe, expect, it } from 'vitest';
import { getTabsYdocNodes, getTabListFromNodes } from '../tab-utils';
import { createSubtabInDoc } from '../tab-operations';
import { makeDoc } from './subtab-test-helpers';

// Budget from the tech plan: 300 tabs, three levels, tree built in under 5 ms.
describe('speed', () => {
  it('builds a 300-tab tree well within budget', () => {
    const doc = makeDoc(1);
    const nodes = getTabsYdocNodes(doc);
    doc.transact(() => {
      for (let i = 0; i < 100; i++) {
        nodes.order.push([`t${i}`]);
        nodes.nameById.set(`t${i}`, `Tab ${i}`);
        nodes.emojiById.set(`t${i}`, null);
      }
    });
    for (let i = 0; i < 100; i++) {
      createSubtabInDoc(doc, `t${i}`, `s${i}`, false);
      createSubtabInDoc(doc, `s${i}`, `g${i}`, false);
    }
    expect(getTabListFromNodes(nodes)).toHaveLength(300);

    const runs = 50;
    const startedAt = performance.now();
    for (let i = 0; i < runs; i++) getTabListFromNodes(nodes);
    const perBuildMs = (performance.now() - startedAt) / runs;
    console.info(`300-tab tree build: ${perBuildMs.toFixed(3)} ms`);
    expect(perBuildMs).toBeLessThan(5);
  });
});
