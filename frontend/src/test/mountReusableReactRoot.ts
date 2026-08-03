import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

type ReusableRoot = Pick<Root, "render">;
type ReusableRootFactory = (container: HTMLElement) => ReusableRoot;
type ReusableRootElement = HTMLElement & {
  __reusableReactRoot?: ReusableRoot;
};

export function mountReusableReactRoot(
  container: HTMLElement,
  node: ReactNode,
  rootFactory: ReusableRootFactory = createRoot,
): ReusableRoot {
  const rootElement = container as ReusableRootElement;
  const root =
    rootElement.__reusableReactRoot ??
    (rootElement.__reusableReactRoot = rootFactory(rootElement));

  root.render(node);
  return root;
}
