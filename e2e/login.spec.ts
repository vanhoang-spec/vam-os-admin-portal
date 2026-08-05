import { expect, test, type Page } from "@playwright/test";

/**
 * Browser-level acceptance coverage for the login form.
 *
 * Every "how many times was the server action invoked?" assertion is made at
 * the wire level: we intercept the POST that Next issues for the server action
 * and count it. That is stronger than any mock-based count, because it observes
 * the real submission pipeline rather than a stand-in for it.
 *
 * The server action deterministically fails with the "network unavailable"
 * state (Supabase env is pinned empty in playwright.config.ts), so the failure
 * paths below exercise a genuine end-to-end server-action round trip.
 */

const NETWORK_ERROR = "VAM OS đang tạm thời không thể kết nối. Vui lòng thử lại sau.";
const IDLE_LABEL = "Đăng nhập";
const PENDING_LABEL = "Đang đăng nhập...";

/** Counts real server-action POSTs, optionally holding each one open. */
async function instrumentServerAction(page: Page, { delayMs = 0 }: { delayMs?: number } = {}) {
  const calls: string[] = [];

  await page.route(
    (url) => url.pathname === "/login",
    async (route) => {
      const request = route.request();
      const actionId = request.headers()["next-action"];
      if (request.method() !== "POST" || !actionId) {
        await route.continue();
        return;
      }
      calls.push(actionId);
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      await route.continue();
    }
  );

  return calls;
}

// Scoped to the form: Next renders its own `role="alert"` route announcer on
// the page, which an unscoped getByRole("alert") would also match.
const errorAlert = (page: Page) => page.locator('form [role="alert"]');
const idleButton = (page: Page) => page.getByRole("button", { name: IDLE_LABEL, exact: true });
const pendingButton = (page: Page) => page.getByRole("button", { name: PENDING_LABEL, exact: true });
const emailInput = (page: Page) => page.locator('input[name="email"]');
const passwordInput = (page: Page) => page.locator('input[name="password"]');

async function fillCredentials(page: Page, email = "user@example.com", password = "correct-horse") {
  await emailInput(page).fill(email);
  await passwordInput(page).fill(password);
}

test.describe("login form — submission behaviour", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await expect(idleButton(page)).toBeVisible();
  });

  test("a single physical click invokes the server action exactly once", async ({ page }) => {
    const calls = await instrumentServerAction(page);
    await fillCredentials(page);

    await idleButton(page).click();

    await expect(errorAlert(page)).toHaveText(NETWORK_ERROR);
    expect(calls).toHaveLength(1);
  });

  test("Enter from the email input invokes the server action exactly once", async ({ page }) => {
    const calls = await instrumentServerAction(page);
    await fillCredentials(page);

    await emailInput(page).press("Enter");

    await expect(errorAlert(page)).toHaveText(NETWORK_ERROR);
    expect(calls).toHaveLength(1);
  });

  test("Enter from the password input invokes the server action exactly once", async ({ page }) => {
    const calls = await instrumentServerAction(page);
    await fillCredentials(page);

    await passwordInput(page).press("Enter");

    await expect(errorAlert(page)).toHaveText(NETWORK_ERROR);
    expect(calls).toHaveLength(1);
  });

  test("a rapid double-click while pending still invokes the server action once", async ({ page }) => {
    const calls = await instrumentServerAction(page, { delayMs: 1500 });
    await fillCredentials(page);

    const box = await idleButton(page).boundingBox();
    expect(box).not.toBeNull();
    const x = box!.x + box!.width / 2;
    const y = box!.y + box!.height / 2;

    // Two genuine mouse clicks with no wait in between — the second lands while
    // the first submission is still in flight.
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.up();
    await page.mouse.down();
    await page.mouse.up();

    await expect(errorAlert(page)).toHaveText(NETWORK_ERROR, { timeout: 15_000 });
    expect(calls).toHaveLength(1);
  });

  test("the submit lock blocks a second submission that bypasses the disabled button", async ({ page }) => {
    const calls = await instrumentServerAction(page, { delayMs: 1500 });
    await fillCredentials(page);

    await idleButton(page).click();
    await expect(pendingButton(page)).toBeDisabled();

    // requestSubmit() fires a real submit event regardless of the disabled
    // button, so ONLY the in-flight submit lock can stop this second
    // submission. This is the assertion that fails if the lock is removed.
    await page.evaluate(() => {
      const form = document.querySelector("form");
      form?.requestSubmit();
      form?.requestSubmit();
    });

    await expect(errorAlert(page)).toHaveText(NETWORK_ERROR, { timeout: 15_000 });
    expect(calls).toHaveLength(1);
  });

  test("repeated Enter presses while pending still invoke the server action once", async ({ page }) => {
    const calls = await instrumentServerAction(page, { delayMs: 1500 });
    await fillCredentials(page);

    await passwordInput(page).press("Enter");
    await expect(pendingButton(page)).toBeVisible();

    await passwordInput(page).press("Enter");
    await passwordInput(page).press("Enter");
    await emailInput(page).press("Enter");

    await expect(errorAlert(page)).toHaveText(NETWORK_ERROR, { timeout: 15_000 });
    expect(calls).toHaveLength(1);
  });
});

test.describe("login form — pending state", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await expect(idleButton(page)).toBeVisible();
  });

  test("while the action is in flight the button is disabled, relabelled and shows a spinner", async ({ page }) => {
    const calls = await instrumentServerAction(page, { delayMs: 1500 });
    await fillCredentials(page);

    await idleButton(page).click();

    // This is the M-1 regression guard. `pending` comes from useFormStatus(),
    // which is only ever populated by startHostTransition() — and that only
    // runs when React's form-action plugin handles the submit natively. If the
    // component ever goes back to preventDefault()-ing the first submit and
    // dispatching by hand, `pending` stays false forever and all three of these
    // assertions fail.
    const busy = pendingButton(page);
    await expect(busy).toBeVisible();
    await expect(busy).toBeDisabled();
    await expect(page.getByTestId("login-spinner")).toBeVisible();
    await expect(idleButton(page)).toHaveCount(0);

    await expect(errorAlert(page)).toHaveText(NETWORK_ERROR, { timeout: 15_000 });
    expect(calls).toHaveLength(1);
  });

  test("a failed submission restores an enabled button with the idle label", async ({ page }) => {
    await instrumentServerAction(page, { delayMs: 1200 });
    await fillCredentials(page);

    await idleButton(page).click();
    await expect(pendingButton(page)).toBeDisabled();

    await expect(errorAlert(page)).toHaveText(NETWORK_ERROR, { timeout: 15_000 });
    await expect(idleButton(page)).toBeEnabled();
    await expect(pendingButton(page)).toHaveCount(0);
    await expect(page.getByTestId("login-spinner")).toHaveCount(0);
  });

  test("retrying after a failure invokes the server action a second time", async ({ page }) => {
    const calls = await instrumentServerAction(page);
    await fillCredentials(page);

    await idleButton(page).click();
    await expect(errorAlert(page)).toHaveText(NETWORK_ERROR);
    expect(calls).toHaveLength(1);

    await idleButton(page).click();
    await expect(errorAlert(page)).toHaveText(NETWORK_ERROR);
    expect(calls).toHaveLength(2);
  });

  test("the normalized email survives a failed submission", async ({ page }) => {
    await instrumentServerAction(page);

    await emailInput(page).fill("  USER@Example.COM  ");
    await passwordInput(page).click(); // blur the email field
    await expect(emailInput(page)).toHaveValue("user@example.com");

    await passwordInput(page).fill("correct-horse");
    await idleButton(page).click();

    await expect(errorAlert(page)).toHaveText(NETWORK_ERROR);
    await expect(emailInput(page)).toHaveValue("user@example.com");
  });
});

test.describe("login form — accessibility and input affordances", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await expect(idleButton(page)).toBeVisible();
  });

  test("email and password carry the expected autocomplete hints", async ({ page }) => {
    await expect(emailInput(page)).toHaveAttribute("autocomplete", "email");
    await expect(passwordInput(page)).toHaveAttribute("autocomplete", "current-password");
    await expect(emailInput(page)).toHaveAttribute("type", "email");
  });

  test("password visibility toggles and keeps an accurate accessible label", async ({ page }) => {
    await expect(passwordInput(page)).toHaveAttribute("type", "password");

    const reveal = page.getByRole("button", { name: "Hiện mật khẩu" });
    await expect(reveal).toBeVisible();
    await reveal.click();

    await expect(passwordInput(page)).toHaveAttribute("type", "text");
    const hide = page.getByRole("button", { name: "Ẩn mật khẩu" });
    await expect(hide).toBeVisible();
    await hide.click();

    await expect(passwordInput(page)).toHaveAttribute("type", "password");
    await expect(page.getByRole("button", { name: "Hiện mật khẩu" })).toBeVisible();
  });

  test("the password toggle never submits the form", async ({ page }) => {
    const calls = await instrumentServerAction(page);
    await fillCredentials(page);

    await page.getByRole("button", { name: "Hiện mật khẩu" }).click();
    await page.getByRole("button", { name: "Ẩn mật khẩu" }).click();

    await expect(idleButton(page)).toBeEnabled();
    expect(calls).toHaveLength(0);
  });

  test("no React form-action warning or page error is emitted", async ({ page }) => {
    const problems: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") {
        problems.push(`${message.type()}: ${message.text()}`);
      }
    });
    page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));

    await instrumentServerAction(page);
    await fillCredentials(page);
    await idleButton(page).click();
    await expect(errorAlert(page)).toHaveText(NETWORK_ERROR);

    expect(problems.filter((entry) => entry.includes("Invalid value for prop"))).toEqual([]);
    expect(problems).toEqual([]);
  });
});
