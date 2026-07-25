/**
 * OverlapType — describes how a query range relates to a region's time span.
 */
export enum OverlapType {
  /** No overlap at all */
  NONE,
  /** Query range is fully inside the region */
  INTERNAL,
  /** Query overlaps the region's start (but not its end) */
  START,
  /** Query overlaps the region's end (but not its start) */
  END,
  /** Region is fully inside the query range */
  EXTERNAL,
}
