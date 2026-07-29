# VAM OS Responsive Admin Edit UX Design
## 2026-07-29

Design only. No implementation in this task.

---

## Current Edit/Save/Cancel Pattern Audit

VAM OS uses two distinct Edit/Save patterns depending on the page context.

### Pattern A — URL Search Param Edit State

Used in: `/admin/users?edit=<id>`, `/admin/corrections?edit=<id>` (and similar pages).

```
1. User clicks "Sửa" link → navigates to /admin/users?edit=<uuid>
2. Server reads searchParams.edit → renders EditAdminUserForm inline on the same page
3. User modifies fields → submits via useFormState(serverAction, initialState)
4. Action returns { ok: boolean, message: string }
5. ActionMessage component in user-management-forms.tsx reads state and shows inline message
6. On success: router.refresh() called from useEffect watching state.ok + state.message
7. User clicks "Đóng form sửa" link → navigates to /admin/users (removes ?edit=)
```

**Characteristics:**
- Edit state is server-side (URL), back-button safe, shareable
- `ActionMessage` in this pattern is a local component — NOT the shared `InlineActionMessage` from `components/action-feedback.tsx`
- No `LoadingButton` — uses a plain `<button>` with no pending state
- No `aria-busy` on the submit button
- `router.refresh()` called after success — server re-fetches all users and re-renders

### Pattern B — Shared Component Edit Pattern

Used in: `/mentors/[id]/edit`, `/mentees/[id]/edit`, `/events/[id]/edit`, `/reviews/[id]`, etc.

```
1. User navigates to dedicated edit page (full URL)
2. Form renders with defaultValues from server props
3. User modifies fields → submits via useFormState(serverAction, initialState)
4. InlineActionMessage (shared) reads state: role="status" on success, role="alert" on error
5. LoadingButton renders spinner + pendingLabel during submission (useFormStatus)
6. showSavedAt=true shows "Đã lưu lúc HH:MM" timestamp on success
7. No explicit page refresh — server component data is not re-fetched automatically
```

**Characteristics:**
- `InlineActionMessage` carries ARIA live roles (`role="status"` / `role="alert"`)
- `LoadingButton` carries `aria-busy={pending}` for screen readers
- `useActionTiming()` logs performance timing via `lib/action-feedback.ts`
- No router.refresh() — feedback is ephemeral within the client component

---

## Gaps Identified in Current Patterns

| Gap | Location | Risk |
|---|---|---|
| Admin users page uses local `ActionMessage` instead of shared `InlineActionMessage` | `app/admin/users/user-management-forms.tsx:23–38` | Inconsistent ARIA — no `role="status"` or `role="alert"` |
| Submit buttons in admin users forms are plain `<button>` with no pending state | `user-management-forms.tsx` | No loading indicator; double-submit possible |
| `router.refresh()` after every success re-fetches entire user list | Pattern A pages | Performance: round-trips to DB for every small edit |
| Pattern B pages with full-page edit routes do not re-fetch server data after save | Pattern B pages | Stale data: form shows old values if server data changed |
| Edit form state (open/closed) encoded in URL but Cancel is a `<Link>` navigating away | Pattern A pages | Scroll position lost; `<Link>` not `<button>` — not keyboard-idiomatic for a UI action |
| No "unsaved changes" warning before Cancel or navigation | All forms | User may lose work silently |
| Password inputs in `CreateAdminUserForm` do not have password policy feedback | `user-management-forms.tsx` | No `"Đạt yêu cầu"` / `"Không đạt yêu cầu"` display yet |

---

## Target Edit Pattern (Canonical)

All admin edit flows should converge on this pattern:

### State Management

- **URL search param for "which record is being edited"** — server-side, back-button safe.
  - `?edit=<uuid>` opens the form for that record inline.
  - Removing `?edit=` (Cancel link) closes the form.
- **Server action for all mutations** — `"use server"`, no API routes.
- **`useFormState(serverAction, initialState)`** for form state.

### Feedback Components

| Component | When to use | ARIA |
|---|---|---|
| `InlineActionMessage` from `components/action-feedback.tsx` | Every form that has an action result | `role="status"` (success) / `role="alert"` (error) |
| `LoadingButton` from `components/action-feedback.tsx` | Every submit button | `aria-busy={pending}` |
| `ConfirmActionDialog` from `components/action-feedback.tsx` | Destructive actions (suspend, remove access) | `role="dialog"`, `aria-modal="true"` |

### Required Props

```tsx
<InlineActionMessage
  state={state}
  successFallback="Đã lưu thành công."
  errorFallback="Không thể thực hiện thao tác. Vui lòng thử lại."
  showSavedAt={state.ok}
/>

<LoadingButton
  pendingLabel="Đang lưu..."
  className="rounded-md bg-vam-green px-3 py-2 text-sm font-medium text-white"
>
  Lưu thay đổi
</LoadingButton>
```

### Password Policy Display (where applicable)

- Display ONLY `"Đạt yêu cầu"` or `"Không đạt yêu cầu"`.
- Render as `role="status"` region.
- Never display: score, strength label, character breakdown, length, or fragments.
- Evaluate client-side on `onChange`; do not send the password to the server before submission.

### Cancel / Close

- Use a `<Link href="/admin/users">Đóng</Link>` to close inline edit panels (URL-param pattern).
- "Cancel" must not submit a form or trigger a server action.
- Future: add `beforeunload` / `useBeforeUnload()` guard for unsaved changes if the form is long.

---

## Responsive Layout Rules

### Mobile (< 640px)

- Single-column field layout.
- Sticky action bar at the bottom for Save / Cancel buttons.
- Table columns in admin list pages: show only Email + Role + Status + Thao tác.
- All other columns hidden (`hidden sm:table-cell`).

### Tablet (640px–1024px)

- Two-column field layout (`sm:grid-cols-2`).
- Table shows Email + Role + Status + Scope + Thao tác.
- Horizontal scroll for tables that cannot fit (use `overflow-x: auto` container, not `overflow-x` on `<body>`).

### Desktop (≥ 1024px)

- Three- or four-column field layout (`xl:grid-cols-3`, `xl:grid-cols-4`).
- Full table with all columns.
- Sticky "Thao tác" column with `sticky right-0 z-10` and left shadow.

### Already-implemented responsive patterns (to preserve)

- `min-w-[1280px]` on admin users table: horizontal scroll in `overflow-x-auto` container — correct.
- Sticky actions column: `sticky right-0 z-10 shadow-[-8px_0_12px_-12px_...]` — correct.
- `grid gap-3 md:grid-cols-2 xl:grid-cols-3` on form fields — correct.

---

## Admin Users Page — Specific UX Improvements

These apply only to `/admin/users`:

| Item | Current | Target |
|---|---|---|
| Submit button | Plain `<button>` | `LoadingButton` with `pendingLabel="Đang lưu..."` |
| Feedback message | Local `ActionMessage` (no ARIA role) | `InlineActionMessage` (role="status" / role="alert") |
| Password field | Missing from Create form | Add with policy feedback ("Đạt yêu cầu" / "Không đạt yêu cầu") |
| Scope editing | First scope only — multi-scope not visible | Show all active scopes; add button for each; deactivate individually |
| Status toggle | "Tạm khóa" toggles between `active` and `inactive` | Add `suspended` as an intermediate; "Tạm khóa" → `suspended`; "Kích hoạt lại" → `active`; "Xóa quyền admin" → `inactive` |
| Scope program/season | Free-text input | Dropdown from `public.programs` / `public.seasons` |

---

## Accessibility Checklist

All edit forms must satisfy:

- [ ] Every form field has a `<label>` or `aria-label`.
- [ ] `InlineActionMessage` uses `role="status"` (success) or `role="alert"` (error).
- [ ] `LoadingButton` uses `aria-busy={pending}`.
- [ ] `ConfirmActionDialog` uses `role="dialog"`, `aria-modal`, `aria-labelledby`, `aria-describedby`.
- [ ] Focus management: when dialog opens, focus moves to Cancel button.
- [ ] When dialog closes, focus returns to the trigger button.
- [ ] Color is not the only differentiator for success vs. error (use icon + text).
- [ ] All interactive elements are keyboard-accessible (no `pointer-events-none` on focused containers without `aria-disabled`).

---

*Design only. No implementation in this task. No database connections used.*
