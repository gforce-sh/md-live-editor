import { describe, it, expect } from "vitest";
import { BulletWidget } from "../src/live-preview";

describe("BulletWidget", () => {
  it("renders a filled circle", () => {
    const dom = new BulletWidget(0).toDOM();

    expect(dom.textContent).toBe("•");
    expect(dom.className).toBe("md-bullet");
  });

  it("sizes its box to one indent level per depth, plus the bullet's own column", () => {
    expect(new BulletWidget(0).toDOM().style.width).toBe(
      "calc(1 * var(--mle-list-indent))",
    );
    expect(new BulletWidget(2).toDOM().style.width).toBe(
      "calc(3 * var(--mle-list-indent))",
    );
  });

  it("compares equal at the same depth, so CM6 reuses the DOM", () => {
    expect(new BulletWidget(1).eq(new BulletWidget(1))).toBe(true);
  });

  it("compares unequal across depths, so a re-indented item is re-rendered", () => {
    expect(new BulletWidget(1).eq(new BulletWidget(2))).toBe(false);
  });
});
