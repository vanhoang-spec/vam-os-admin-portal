import ReviewDetailPage from "@/app/reviews/[id]/page";
import { WorkDrawer } from "../../../work-drawer";

/**
 * Intercepts `/reviews/<id>` when it is opened from My Work.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS RE-EXPORTS THE REAL PAGE INSTEAD OF REBUILDING IT
 * ---------------------------------------------------------------------------
 * The drawer renders the ACTUAL review screen component — same server data
 * loading, same `ReviewForm`, same `ReviewOperations`, same authorisation
 * checks including the reviewer-only constraint in `getApplicationReviewById`.
 * Nothing about the review experience is reimplemented here, so there is no
 * second copy to drift out of step with the real one, and the drawer cannot
 * accidentally show more than the full page would allow.
 *
 * Interception applies only to client-side navigation FROM this segment. A
 * direct visit, a refresh, or a shared link still resolves to the ordinary
 * full-page `/reviews/<id>` route. That is the intended fallback: the worst
 * case is the pre-existing screen, never a broken one.
 */
export default async function MyWorkReviewDetail(props: { params: Promise<{ id: string }> }) {
  // Awaited here as well as inside the page: the drawer needs the id to offer
  // the full-screen route, and `params` is a promise that resolves to the same
  // value for both readers.
  const { id } = await props.params;
  return (
    <WorkDrawer fullScreenHref={`/reviews/${id}`}>
      {await ReviewDetailPage(props)}
    </WorkDrawer>
  );
}
