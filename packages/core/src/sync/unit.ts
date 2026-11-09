/**
 * The unit of sync work and the call budget shared by every unit of a run. Shared by `runSync`
 * (sites) and the app planner (ADR 0009).
 */
import type { IsoDate, SourceId } from '../types.js';

export interface Unit {
  task: string;
  siteId: string;
  source: SourceId;
  /** History work (GSC backfill, Cloudflare lookback): runs after every increment and stops at the daily write budget. */
  backfill: boolean;
  /** The newest day a history unit pulls; history runs newest first across all sites. */
  date?: IsoDate;
  /** API calls reserved before the unit runs; extra pages take more from the budget as they go. */
  calls: number;
  /** Stable id used to detect invocations killed mid-unit (e.g. CPU limit). */
  key: string;
  /** Rows written; null when there turned out to be nothing to do (the unit is then not reported). */
  run: () => Promise<number | null>;
  /**
   * Gives up on this unit after repeated interruptions: a range is split for the next run
   * (returning what was done), a single day is passed over.
   */
  skip: () => Promise<string | void>;
  /** Splits a multi-day range after an error; false for a single day. */
  shrink?: () => Promise<boolean>;
  /** Also split the range when it needed more calls than one run allows (default true; false when calls do not depend on days). */
  splitOnBudget?: boolean;
  /**
   * Spare-capacity work (index coverage): runs only with calls and time left over after
   * everything else, and never makes a run partial when it stops for lack of either.
   */
  idle?: boolean;
}

/** The call budget shared by every unit of a run. */
export interface Budget {
  /** Takes one more call, or stops the unit (BudgetExceeded) when none is left. */
  spend(source: SourceId): void;
  /** Hands back reserved calls a unit did not need. */
  refund(source: SourceId, calls: number): void;
  /** Calls still left in this run. */
  left(): number;
  /** True once the run's time budget is spent. */
  expired(): boolean;
}
