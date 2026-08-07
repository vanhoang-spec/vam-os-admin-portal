import { expect, test, type Page } from "@playwright/test";

/** Counts real server-action POSTs, optionally holding each one open. */
async function instrumentServerAction(page: Page, { delayMs = 0 }: { delayMs?: number } = {}) {
  const calls: string[] = [];
  await page.route(
    (url) => url.pathname === "/e2e-harness",
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

test.describe("admin actions ux - membership lifecycle", () => {
  test.beforeEach(async ({ page }) => {
    page.on("dialog", (dialog) => dialog.accept());
    await page.goto("/e2e-harness");
  });

  test("A. active state: Tạm nghỉ with deterministic delay", async ({ page }) => {
    const calls = await instrumentServerAction(page, { delayMs: 1500 });
    const activeSection = page.locator('section[data-vam-membership-id="11111111-1111-1111-1111-111111111111"]');
    const pauseButton = activeSection.getByRole("button", { name: "Tạm nghỉ" });
    
    await expect(pauseButton).toBeVisible();
    await pauseButton.click();
    
    await expect(pauseButton).toBeDisabled();
    await expect(pauseButton).toHaveText(/Đang tạm nghỉ/i);
    
    const siblingButton = activeSection.getByRole("button", { name: "Rút khỏi chương trình" });
    await expect(siblingButton).toBeDisabled();
    
    const pausedSection = page.locator('section[data-vam-membership-id="22222222-2222-2222-2222-222222222222"]');
    const reactivateButton = pausedSection.getByRole("button", { name: "Kích hoạt lại" });
    await expect(reactivateButton).toBeEnabled();
    
    const errorAlert = activeSection.locator('[role="status"]');
    await expect(errorAlert).toBeVisible({ timeout: 10_000 });
    await expect(pauseButton).toBeEnabled();
    await expect(pauseButton).toHaveText("Tạm nghỉ");
    await expect(siblingButton).toBeEnabled();
    
    expect(calls).toHaveLength(1);
  });

  test("B. paused state: Kích hoạt lại", async ({ page }) => {
    const calls = await instrumentServerAction(page, { delayMs: 1000 });
    const pausedSection = page.locator('section[data-vam-membership-id="22222222-2222-2222-2222-222222222222"]');
    const reactivateButton = pausedSection.getByRole("button", { name: "Kích hoạt lại" });
    
    await reactivateButton.click();
    await expect(reactivateButton).toBeDisabled();
    await expect(reactivateButton).toHaveText(/Đang kích hoạt/i);
    
    const withdrawButton = pausedSection.getByRole("button", { name: "Rút khỏi chương trình" });
    await expect(withdrawButton).toBeDisabled();

    const errorAlert = pausedSection.locator('[role="status"]');
    await expect(errorAlert).toBeVisible({ timeout: 10_000 });
    await expect(reactivateButton).toBeEnabled();
    
    expect(calls).toHaveLength(1);
  });

  test("C. duplicate protection: rapid double click", async ({ page }) => {
    const calls = await instrumentServerAction(page, { delayMs: 1500 });
    const activeSection = page.locator('section[data-vam-membership-id="11111111-1111-1111-1111-111111111111"]');
    const pauseButton = activeSection.getByRole("button", { name: "Tạm nghỉ" });
    
    const box = await pauseButton.boundingBox();
    expect(box).not.toBeNull();
    const x = box!.x + box!.width / 2;
    const y = box!.y + box!.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.up();
    await page.mouse.down();
    await page.mouse.up();
    
    const errorAlert = activeSection.locator('[role="status"]');
    await expect(errorAlert).toBeVisible({ timeout: 10_000 });
    expect(calls).toHaveLength(1);
  });

  test("C. duplicate protection: requestSubmit bypass", async ({ page }) => {
    const calls = await instrumentServerAction(page, { delayMs: 1500 });
    const activeSection = page.locator('section[data-vam-membership-id="11111111-1111-1111-1111-111111111111"]');
    const pauseButton = activeSection.getByRole("button", { name: "Tạm nghỉ" });
    
    await pauseButton.click();
    await expect(pauseButton).toBeDisabled();

    await activeSection.evaluate((section) => {
      const forms = section.querySelectorAll("form");
      forms[0].requestSubmit();
      forms[0].requestSubmit();
    });

    const errorAlert = activeSection.locator('[role="status"]');
    await expect(errorAlert).toBeVisible({ timeout: 10_000 });
    expect(calls).toHaveLength(1);
  });

  test("D. failure keeps reason and retries", async ({ page }) => {
    const calls = await instrumentServerAction(page);
    const activeSection = page.locator('section[data-vam-membership-id="11111111-1111-1111-1111-111111111111"]');
    const withdrawButton = activeSection.getByRole("button", { name: "Rút khỏi chương trình" });
    const withdrawForm = activeSection.locator('form', { has: page.getByRole("button", { name: "Rút khỏi chương trình" }) });
    const formReasonInput = withdrawForm.locator('input[name="reason"]');
    
    await formReasonInput.fill("I am leaving because reasons");
    await withdrawButton.click();
    
    const errorAlert = withdrawForm.locator('[role="status"]');
    await expect(errorAlert).toBeVisible({ timeout: 10_000 });
    await expect(formReasonInput).toHaveValue("I am leaving because reasons");
    
    await withdrawButton.click();
    await expect(errorAlert).toBeVisible({ timeout: 10_000 });
    expect(calls).toHaveLength(2);
  });
});

test.describe("admin actions ux - CRM and Import", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/e2e-harness");
  });

  test("CRM note pending behavior", async ({ page }) => {
    const calls = await instrumentServerAction(page, { delayMs: 1000 });
    const crmHarness = page.locator('#crm-harness');
    const submitBtn = crmHarness.getByRole("button", { name: "Thêm ghi chú CRM" });
    
    await submitBtn.click();
    await expect(submitBtn).toBeDisabled();
    await expect(submitBtn).toHaveText(/Đang lưu/i);

    await expect(submitBtn).toBeEnabled({ timeout: 10_000 });
    expect(calls).toHaveLength(1);
  });

  test("Import pending behavior", async ({ page }) => {
    const calls = await instrumentServerAction(page, { delayMs: 1000 });
    const importHarness = page.locator('#import-harness');
    const fileInput = importHarness.locator('input[name="csv_file"]');
    const submitBtn = importHarness.getByRole("button", { name: "Xem trước an toàn" });
    
    await fileInput.setInputFiles({
      name: "test.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("email,role\ntest@example.com,mentor")
    });

    await submitBtn.click();
    await expect(submitBtn).toBeDisabled();
    await expect(submitBtn).toHaveText(/Đang xử lý/i);

    const errorAlert = importHarness.locator('[role="status"]');
    await expect(errorAlert).toBeVisible({ timeout: 10_000 });
    expect(calls).toHaveLength(1);
  });
});
