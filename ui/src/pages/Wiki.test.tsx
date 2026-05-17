// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WikiFrame } from "./Wiki";
import { PUSTAK_WIKI_URL } from "../lib/wiki-tab";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("WikiFrame", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
  });

  it("embeds the Pustak wiki with the expected iframe permissions", async () => {
    const root = createRoot(container);

    await act(async () => {
      root.render(<WikiFrame />);
    });

    const iframe = container.querySelector("iframe");
    expect(iframe?.getAttribute("src")).toBe(PUSTAK_WIKI_URL);
    expect(iframe?.getAttribute("sandbox")).toBe("allow-same-origin allow-scripts allow-forms allow-popups");
    expect(iframe?.getAttribute("sandbox")).not.toContain("allow-top-navigation");
    expect(iframe?.getAttribute("allow")).toBe("clipboard-read; clipboard-write");

    await act(async () => {
      root.unmount();
    });
  });
});
