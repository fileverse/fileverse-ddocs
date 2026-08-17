import { describe, expect, it } from 'vitest';
import {
  COLLAB_PRESENCE_COLORS,
  assignSessionColors,
} from './presence';

describe('assignSessionColors', () => {
  it('exhausts the palette and keeps colors stable for the session', () => {
    const colors = new Map<string, string>();
    const collaborators = Array.from({ length: 9 }, (_, index) => ({
      clientId: String(index),
      name: `Person ${index}`,
      color: '#random',
      isEns: '',
    }));

    assignSessionColors(collaborators, colors);
    expect(new Set(collaborators.slice(0, 8).map(({ color }) => color)).size).toBe(
      COLLAB_PRESENCE_COLORS.length,
    );
    expect(collaborators[8].color).toBe(collaborators[0].color);

    assignSessionColors(collaborators.reverse(), colors);
    expect(collaborators.find(({ name }) => name === 'Person 0')?.color).toBe(
      COLLAB_PRESENCE_COLORS[0],
    );
  });

  it('releases departed colors before assigning duplicates', () => {
    const colors = new Map<string, string>();
    const history = Array.from({ length: 12 }, (_, index) => ({
      clientId: String(index),
      name: `Person ${index}`,
      color: '#random',
      isEns: '',
    }));
    assignSessionColors(history, colors);

    const active = [...history.slice(0, 5), ...history.slice(8)].map((user) => ({
      ...user,
    }));
    assignSessionColors(active, colors);

    expect(colors.size).toBe(9);
    expect(new Set(active.map(({ color }) => color)).size).toBe(8);
  });
});
