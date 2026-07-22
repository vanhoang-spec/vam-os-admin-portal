# VAM OS Accessibility Manual QA Matrix — 2026-07-22

| Check | Automated coverage | Manual test required | Demo-blocking | Timing |
|---|---|---|---|---|
| Keyboard navigation/skip link/focus visibility/order | partial | Yes | keyboard blocker: yes | pre-demo |
| Drawer focus trap/return/Escape/mobile | partial | Yes | yes if unusable | pre-demo |
| Accordions/aria-current/dialogs | partial | Yes | major dialog issue: yes | pre-demo |
| Loading/inline/error announcements | partial | Yes with induced states | critical action error: yes | pre-demo |
| Labels/validation summary/accessible names | partial | Yes, screen reader | unlabeled core form: yes | pre-demo |
| Color contrast | no reliable repo proof | Yes | severe core contrast: yes | pre-demo |
| 200% zoom and 320px width | no | Yes | content/action loss: yes | pre-demo |
| Reduced motion | limited | Yes | no, unless vestibular effect | post-demo/when feasible |

Run core routes on Chrome Windows and Edge Windows; Chrome Mac and Safari Mac; Safari iPhone and Chrome Android where available. Record browser/version, viewport, role, route, pass/fail, evidence and issue ID. Automated checks cannot replace keyboard, zoom, contrast and screen-reader observation; no screenshot regression tests are added merely to raise counts.
