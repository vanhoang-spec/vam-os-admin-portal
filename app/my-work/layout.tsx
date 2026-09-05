/**
 * My Work renders two slots at once: the inbox list (`children`) and, when a
 * work item is open, the review screen drawn over it (`detail`).
 *
 * This is what keeps the operator's context. Because `detail` is a PARALLEL
 * slot, opening an item mounts the drawer alongside the list instead of
 * replacing it — the list component instance survives, so its filter state and
 * the page's scroll position are still there when the drawer closes. Rendering
 * the detail as an ordinary child route would unmount the list and reset both.
 */
export default function MyWorkLayout({
  children,
  detail
}: {
  children: React.ReactNode;
  detail: React.ReactNode;
}) {
  return (
    <>
      {children}
      {detail}
    </>
  );
}
