import { test, expect } from "@playwright/test";

// e2e/project-picker.pw.ts — P21-T6-06 브라우저 검증(Layer 1).
//   /preview 의 ProjectPicker(chat 헤더 [프로젝트▾])를 실 chromium 으로 열어
//   (UX-01) 바깥클릭 해제, (UX-03) Escape 해제+포커스 복귀, (UX-06/07) 키보드 오픈+옵션 이동을 단언한다.
test.describe("P21-T6-06 preview — ProjectPicker 바깥클릭/Escape/키보드", () => {
  test("바깥클릭 시 메뉴가 닫힌다", async ({ page }) => {
    await page.goto("/preview");
    const section = page.getByTestId("preview-project-picker");
    const trigger = section.getByTestId("project-picker-trigger");
    await trigger.click();
    await expect(section.getByRole("listbox")).toBeVisible();

    await page.getByRole("heading", { name: "P10 컴포넌트 프리뷰" }).click();

    await expect(section.getByRole("listbox")).toBeHidden();
  });

  test("Escape 시 메뉴가 닫히고 포커스가 트리거로 복귀한다", async ({
    page,
  }) => {
    await page.goto("/preview");
    const section = page.getByTestId("preview-project-picker");
    const trigger = section.getByTestId("project-picker-trigger");
    await trigger.click();
    await expect(section.getByRole("listbox")).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(section.getByRole("listbox")).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("트리거에서 aria-haspopup/aria-expanded 가 열림상태를 노출하고, ArrowDown 으로 옵션 사이를 이동한다", async ({
    page,
  }) => {
    await page.goto("/preview");
    const section = page.getByTestId("preview-project-picker");
    const trigger = section.getByTestId("project-picker-trigger");
    await expect(trigger).toHaveAttribute("aria-haspopup", "listbox");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");

    await trigger.focus();
    await page.keyboard.press("ArrowDown");

    const listbox = section.getByRole("listbox");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    const noneOption = section.getByTestId("project-picker-item-none");
    await expect(listbox).toHaveAttribute(
      "aria-activedescendant",
      (await noneOption.getAttribute("id")) ?? "",
    );

    await page.keyboard.press("ArrowDown");
    const opt1 = section.getByTestId("project-picker-item-proj-1");
    await expect(listbox).toHaveAttribute(
      "aria-activedescendant",
      (await opt1.getAttribute("id")) ?? "",
    );
  });
});
