/**
 * The `detail` slot when no work item is open — and, just as importantly, on a
 * hard load of /my-work, where Next.js has no previous state to fall back on.
 * Returning null means the bare list renders with no drawer.
 */
export default function MyWorkDetailDefault() {
  return null;
}
