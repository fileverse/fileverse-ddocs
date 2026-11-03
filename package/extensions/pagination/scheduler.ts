import type { Transaction } from '@tiptap/pm/state';
import {
  AddMarkStep,
  RemoveMarkStep,
  ReplaceStep,
  type Step,
} from '@tiptap/pm/transform';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Spacer } from './place';

const DEBOUNCE_MS = 300;
export const MAX_WAIT_MS = 1000;
export const SETTLE_CAP = 4;

export function createSettleGuard(cap = SETTLE_CAP) {
  let history: string[] = [];
  return {
    next(signature: string): 'continue' | 'stop' {
      const twoAgo = history[history.length - 2];
      history.push(signature);
      if (twoAgo === signature) return 'stop';
      return history.length >= cap ? 'stop' : 'continue';
    },
    // True when `signature` is the one from two passes ago (oscillation).
    repeats(signature: string): boolean {
      return history[history.length - 2] === signature;
    },
    reset() {
      history = [];
    },
  };
}

function stepRange(step: Step): [number, number] | null {
  if (step instanceof ReplaceStep) {
    const { slice } = step;
    if (slice.openStart || slice.openEnd) return null;
    let inline = true;
    slice.content.forEach((n) => {
      if (!n.isInline) inline = false;
    });
    if (!inline) return null;
    return [step.from, step.to];
  }
  if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) {
    return [step.from, step.to];
  }
  return null;
}

/**
 * True when every step is an inline edit inside one and the same textblock
 * that holds no inText spacer. Spacer positions refer to the doc before `trs`.
 * Transactions without steps are ignored; no doc changes at all returns true.
 */
export function editStaysInOneTextblock(
  trs: readonly Transaction[],
  spacers: Spacer[],
): boolean {
  let blockStart: number | null = null;
  for (const tr of trs) {
    for (let i = 0; i < tr.steps.length; i++) {
      const range = stepRange(tr.steps[i]);
      if (!range) return false;
      const doc: PMNode = tr.docs[i];
      const $from = doc.resolve(range[0]);
      const $to = doc.resolve(range[1]);
      if (!$from.parent.isTextblock || $from.start() !== $to.start()) {
        return false;
      }
      if (blockStart === null) {
        const end = $from.end();
        const start = $from.start();
        if (
          spacers.some(
            (s) => s.kind === 'inText' && s.pos >= start && s.pos <= end,
          )
        ) {
          return false;
        }
      } else if ($from.start() !== blockStart) {
        return false;
      }
      blockStart = tr.mapping.maps[i].map($from.start(), -1);
    }
  }
  return true;
}

type Deps = {
  run(): void;
  isComposing(): boolean;
  raf?: (cb: () => void) => number;
  cancelRaf?: (id: number) => void;
};

export class PassScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private frame: number | null = null;
  private deferred = false;
  private deadline: number | null = null;
  private destroyed = false;
  private raf: (cb: () => void) => number;
  private cancelRaf: (id: number) => void;

  constructor(private deps: Deps) {
    this.raf = deps.raf ?? ((cb) => window.requestAnimationFrame(cb));
    this.cancelRaf =
      deps.cancelRaf ?? ((id) => window.cancelAnimationFrame(id));
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onEdit(_trs: readonly Transaction[]): void {
    if (this.destroyed) return;
    if (this.deps.isComposing()) {
      this.deferred = true;
      return;
    }
    this.clearTimer();
    const now = Date.now();
    if (this.deadline === null) this.deadline = now + MAX_WAIT_MS;
    const wait = Math.max(0, Math.min(DEBOUNCE_MS, this.deadline - now));
    this.timer = setTimeout(() => {
      this.timer = null;
      this.fire();
    }, wait);
  }

  now(): void {
    if (this.destroyed) return;
    if (this.deps.isComposing()) {
      this.deferred = true;
      return;
    }
    this.clearTimer();
    if (this.frame !== null) return;
    this.frame = this.raf(() => {
      this.frame = null;
      this.fire();
    });
  }

  isPending(): boolean {
    return this.timer !== null || this.frame !== null;
  }

  flush(): void {
    if (this.destroyed) return;
    if (this.timer === null && this.frame === null) return;
    this.clearTimer();
    this.clearFrame();
    this.fire();
  }

  compositionEnd(): void {
    if (this.destroyed || !this.deferred) return;
    this.deferred = false;
    this.now();
  }

  destroy(): void {
    this.destroyed = true;
    this.deferred = false;
    this.clearTimer();
    this.clearFrame();
  }

  private fire() {
    this.deadline = null;
    if (this.destroyed) return;
    if (this.deps.isComposing()) {
      this.deferred = true;
      return;
    }
    this.deps.run();
  }

  private clearTimer() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private clearFrame() {
    if (this.frame !== null) this.cancelRaf(this.frame);
    this.frame = null;
  }
}
