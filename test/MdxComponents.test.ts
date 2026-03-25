import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

// Mock the inline script
vi.mock("../src/transformers/runtime.inline.ts", () => {
  return {
    default: "console.log('mock runtime code', MDX_REGISTRY);",
  };
});

import { MdxComponents } from "../src/transformers/MdxComponents";
import type { Root } from "hast";
import fs from "fs";
import path from "path";
import os from "os";

describe("MdxComponents", () => {
  it("should transform language-mdx code blocks into mdx islands", () => {
    // 1. Setup the plugin
    const plugin = MdxComponents({ componentsDir: "./quartz/components/mdx" });
    const htmlPlugins = plugin.htmlPlugins!(
      {} as unknown as import("@quartz-community/types").BuildCtx,
    );
    const htmlPluginFactory = htmlPlugins[0] as (options?: unknown) => import("unified").Plugin;
    const htmlPlugin = htmlPluginFactory();

    // 2. Create a mock AST representing:
    // <pre><code class="language-mdx"><MyButton text="Click me" /></code></pre>
    const ast: Root = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "pre",
          properties: {},
          children: [
            {
              type: "element",
              tagName: "code",
              properties: { className: ["language-mdx"] },
              children: [
                {
                  type: "text",
                  value: '<MyButton text="Click me" />',
                },
              ],
            },
          ],
        },
      ],
    };

    // 3. Apply the transformer
    const transform = htmlPlugin as (tree: import("hast").Root) => void;
    transform(ast);

    // 4. Verify the transformation
    const preNode = ast.children[0] as unknown as import("hast").Element;

    // It should have replaced the `pre` entirely with a `div` island
    expect(preNode.tagName).toBe("div");
    expect(preNode.properties.className).toEqual(["mdx-component-mount"]);
    expect(preNode.properties["data-mdx"]).toBe('<MyButton text="Click me" />');
    expect(preNode.children).toEqual([]);
  });

  it("should ignore standard code blocks", () => {
    const plugin = MdxComponents({ componentsDir: "./quartz/components/mdx" });
    const htmlPlugins = plugin.htmlPlugins!(
      {} as unknown as import("@quartz-community/types").BuildCtx,
    );
    const htmlPluginFactory = htmlPlugins[0] as (options?: unknown) => import("unified").Plugin;
    const htmlPlugin = htmlPluginFactory();

    const ast: Root = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "pre",
          properties: {},
          children: [
            {
              type: "element",
              tagName: "code",
              properties: { className: ["language-javascript"] },
              children: [
                {
                  type: "text",
                  value: 'console.log("Hello");',
                },
              ],
            },
          ],
        },
      ],
    };

    const astCopy = JSON.parse(JSON.stringify(ast));
    const transform = htmlPlugin as (tree: import("hast").Root) => void;
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
