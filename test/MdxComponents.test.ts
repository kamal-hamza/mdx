import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

// Mock the inline script
vi.mock("../src/transformers/runtime.inline.ts", () => {
  return {
    default: "console.log('mock runtime code', MDX_REGISTRY);",
  };
});

import { MdxComponents } from "../src/transformers/MdxComponents";
import type { Root } from "mdast";
import fs from "fs";
import path from "path";
import os from "os";

describe("MdxComponents", () => {
  it("should transform language-mdx code blocks into mdx islands", () => {
    // 1. Setup the plugin
    const plugin = MdxComponents({ componentsDir: "./quartz/components/mdx" });
    const markdownPlugins = plugin.markdownPlugins!(
      {} as unknown as import("@quartz-community/types").BuildCtx,
    );
    const markdownPluginFactory = markdownPlugins[0] as (
      options?: unknown,
    ) => import("unified").Plugin;
    const markdownPlugin = markdownPluginFactory();

    // 2. Create a mock AST representing:
    // ```mdx
    // <MyButton text="Click me" />
    // ```
    const ast: Root = {
      type: "root",
      children: [
        {
          type: "code",
          lang: "mdx",
          value: '<MyButton text="Click me" />',
        },
      ],
    };

    // 3. Apply the transformer
    const transform = markdownPlugin as (tree: import("mdast").Root) => void;
    transform(ast);

    // 4. Verify the transformation
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const node = ast.children[0] as any;

    // It should have replaced the code block entirely with a node having hName
    expect(node.type).toBe("paragraph");
    expect(node.data.hName).toBe("div");
    expect(node.data.hProperties.className).toEqual(["mdx-component-mount"]);
    expect(node.data.hProperties["data-mdx"]).toBe(
      encodeURIComponent('<MyButton text="Click me" />'),
    );
  });

  it("should ignore standard code blocks", () => {
    const plugin = MdxComponents({ componentsDir: "./quartz/components/mdx" });
    const markdownPlugins = plugin.markdownPlugins!(
      {} as unknown as import("@quartz-community/types").BuildCtx,
    );
    const markdownPluginFactory = markdownPlugins[0] as (
      options?: unknown,
    ) => import("unified").Plugin;
    const markdownPlugin = markdownPluginFactory();

    const ast: Root = {
      type: "root",
      children: [
        {
          type: "code",
          lang: "javascript",
          value: 'console.log("Hello");',
        },
      ],
    };

    const astCopy = JSON.parse(JSON.stringify(ast));
    const transform = markdownPlugin as (tree: import("mdast").Root) => void;
    transform(ast);

    // AST should be completely unchanged
    expect(ast).toEqual(astCopy);
  });

  describe("externalResources", () => {
    let tempDir: string;

    beforeEach(() => {
      // Create a temporary directory for dummy components
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "quartz-mdx-test-"));
    });

    afterEach(() => {
      // Clean up
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should gracefully handle missing components directory", () => {
      const plugin = MdxComponents({ componentsDir: path.join(tempDir, "does-not-exist") });
      const resources = plugin.externalResources!(
        {} as unknown as import("@quartz-community/types").BuildCtx,
      ) as import("@quartz-community/types").StaticResources;

      expect(resources).toEqual({});
    });

    it("should bundle external resources if components exist", () => {
      // Create a dummy component
      fs.writeFileSync(
        path.join(tempDir, "MyComponent.tsx"),
        "export default function MyComponent() { return <div>Hello</div>; }",
      );

      // Calculate relative path for componentsDir
      const relativeTempDir = path.relative(process.cwd(), tempDir);

      const plugin = MdxComponents({ componentsDir: relativeTempDir });
      const resources = plugin.externalResources!(
        {} as unknown as import("@quartz-community/types").BuildCtx,
      ) as import("@quartz-community/types").StaticResources;

      // Should inject a script
      expect(resources).toHaveProperty("js");
      expect(resources.js).toHaveLength(1);

      const scriptResource = resources.js![0];
      expect(scriptResource!.contentType).toBe("inline");
      expect(scriptResource!.loadTime).toBe("afterDOMReady");
      expect((scriptResource as { script: string }).script).toContain("MyComponent");
    });
  });
});
