import { describe, it, expect } from "vitest";
import { TableWidget } from "../src/live-preview";

const SOURCE = [
  "| Header 1 | Header 2 | Header 3 |",
  "| -------- | -------- | -------- |",
  "| Row 1 A  | Row 1 B  | Row 1 C  |",
  "| Row 2 A  | Row 2 B  | Row 2 C  |",
].join("\n");

describe("TableWidget", () => {
  it("renders headers from the first row", () => {
    const dom = new TableWidget(SOURCE).toDOM();

    const headers = [...dom.querySelectorAll("th")].map((th) => th.textContent);
    expect(headers).toEqual(["Header 1", "Header 2", "Header 3"]);
  });

  it("renders body rows, skipping the delimiter row", () => {
    const dom = new TableWidget(SOURCE).toDOM();

    const bodyRows = dom.querySelectorAll("tbody tr");
    expect(bodyRows.length).toBe(2);
    const firstRow = [...bodyRows[0]!.querySelectorAll("td")].map(
      (td) => td.textContent,
    );
    expect(firstRow).toEqual(["Row 1 A", "Row 1 B", "Row 1 C"]);
  });
});
