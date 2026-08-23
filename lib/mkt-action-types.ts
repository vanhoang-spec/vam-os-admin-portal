/**
 * Shared types for the MKT plan server actions.
 *
 * A plain module: client components import these, and a `"use server"` file may
 * export nothing but async functions.
 */

export type MktActionState = {
  ok: boolean;
  message: string | null;
};

export const initialMktActionState: MktActionState = {
  ok: false,
  message: null
};

/**
 * Generating a week says more than yes or no.
 *
 * An operator who expected twelve posts and got nine needs the reason on the
 * same screen: two slots came back empty, one was left alone because a designer
 * had already worked on it.
 */
export type MktWeekActionState = MktActionState & {
  filled?: number;
  missing?: number;
  preserved?: number;
  unplacedOrders?: string[];
};

export const initialMktWeekActionState: MktWeekActionState = {
  ok: false,
  message: null
};
