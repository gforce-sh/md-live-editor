import { describe, it, expect } from "vitest";
import { BulletWidget } from "../src/live-preview";

describe("BulletWidget", () => {
  it("renders a filled circle", () => {
    const dom = new BulletWidget().toDOM();

    expect(dom.textContent).toBe("•");
    expect(dom.className).toBe("md-bullet");
  });

  it("compares equal to any other bullet, so CM6 reuses the DOM", () => {
    expect(new BulletWidget().eq()).toBe(true);
  });
});
