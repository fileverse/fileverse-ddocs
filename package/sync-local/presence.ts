import { IDocCollabUsers } from '../types';

export interface AwarenessIdentity {
  name: string;
  color: string;
  isEns: string | boolean;
}

export const PLACEHOLDER_COLOR = '#9CA3AF';
export const COLLAB_PRESENCE_COLORS = [
  '#30bced',
  '#6eeb83',
  '#fa69d1',
  '#ecd444',
  '#ee6352',
  '#db3041',
  '#0ad7f2',
  '#1bff39',
] as const;

// socketId (a sibling awareness field) → identity, keeping only states that carry both.
// Typed without `any` (the package enforces @typescript-eslint/no-explicit-any); the raw
// awareness state is `Record<string, unknown>` and narrowed here.
export function buildIdentityMap(
  states: Map<number, Record<string, unknown>>,
): Map<string, AwarenessIdentity> {
  const map = new Map<string, AwarenessIdentity>();
  states.forEach((state) => {
    const sid = state?.socketId;
    const user = state?.user as
      | { name?: string; color?: string; isEns?: string | boolean }
      | undefined;
    if (typeof sid === 'string' && user) {
      map.set(sid, {
        name: user.name ?? '',
        color: user.color ?? PLACEHOLDER_COLOR,
        isEns: user.isEns ?? '',
      });
    }
  });
  return map;
}

// Authoritative set = roomMembers. Attach identity; unmatched sockets become placeholders.
// Identified-first, then stable by socketId, so real people fill the visible avatar slots
// and a not-yet-identified socket only affects the count / +N overflow.
export function mergePresence(
  roomMembers: string[],
  identityBySocketId: Map<string, AwarenessIdentity>,
): IDocCollabUsers[] {
  const roster: IDocCollabUsers[] = roomMembers.map((socketId) => {
    const identity = identityBySocketId.get(socketId);
    if (identity) {
      return {
        clientId: socketId,
        name: identity.name,
        color: identity.color,
        isEns: identity.isEns as string,
        isPlaceholder: false,
      };
    }
    return {
      clientId: socketId,
      name: '',
      color: PLACEHOLDER_COLOR,
      isEns: '',
      isPlaceholder: true,
    };
  });

  roster.sort((a, b) => {
    if (!!a.isPlaceholder !== !!b.isPlaceholder)
      return a.isPlaceholder ? 1 : -1;
    return String(a.clientId).localeCompare(String(b.clientId));
  });
  // One avatar per person, not per socket: the same user in two tabs holds two
  // sockets broadcasting the same identity name. Placeholders (identity not yet
  // known) stay per-socket so unidentified joins are never undercounted.
  const seenNames = new Set<string>();
  return roster.filter((entry) => {
    if (entry.isPlaceholder || !entry.name) return true;
    if (seenNames.has(entry.name)) return false;
    seenNames.add(entry.name);
    return true;
  });
}

export function assignSessionColors(
  collaborators: IDocCollabUsers[],
  colorByName: Map<string, string>,
): IDocCollabUsers[] {
  const activeNames = new Set(
    collaborators
      .filter(({ isPlaceholder, name }) => !isPlaceholder && name)
      .map(({ name }) => name),
  );
  colorByName.forEach((_, name) => {
    if (!activeNames.has(name)) colorByName.delete(name);
  });

  const usedColors = new Set<string>();
  collaborators.forEach((collaborator) => {
    if (collaborator.isPlaceholder || !collaborator.name) return;
    let color = colorByName.get(collaborator.name);
    if (!color || usedColors.has(color)) {
      color =
        COLLAB_PRESENCE_COLORS.find((candidate) => !usedColors.has(candidate)) ??
        color ??
        COLLAB_PRESENCE_COLORS[
          colorByName.size % COLLAB_PRESENCE_COLORS.length
        ];
      colorByName.set(collaborator.name, color);
    }
    usedColors.add(color);
    collaborator.color = color;
  });
  return collaborators;
}

// Used to check if the collaborator list has changed.
// Color is left out because saving a new color runs this check again.
// This prevents the collaborator list from updating twice.
// Cursor colors are updated separately in use-tab-editor.
export function identitySignature(
  roomMembers: string[],
  identityBySocketId: Map<string, AwarenessIdentity>,
): string {
  return roomMembers
    .slice()
    .sort()
    .map((sid) => {
      const id = identityBySocketId.get(sid);
      return id ? `${sid}:${id.name}:${id.isEns}` : `${sid}:?`;
    })
    .join('|');
}
