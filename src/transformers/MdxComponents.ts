import type { QuartzTransformerPlugin } from "@quartz-community/types";
import { visit } from "unist-util-visit";
import type { Element, Root } from "hast";
import { buildSync } from "esbuild";
import path from "path";
import fs from "fs";

export interface MdxOptions {
  /** The folder containing the user's MDX Preact components */
  componentsDir: string;
}

const defaultOptions: MdxOptions = {
  componentsDir: "./quartz/components/mdx",
};

// This is the clean runtime that mounts the auto-discovered components
const RUNTIME_CODE = `
import { render, h } from "preact";

function parseProps(attrString) {
  const props = {};
  const regex = /(\\w+)=["']([^"']*)["']/g;
  let match;
  while ((match = regex.exec(attrString)) !== null) props[match[1]] = match[2];
  return props;
}

async function mountMdx(registry) {
  const elements = document.querySelectorAll(".mdx-component-mount");
  if (!elements.length) return;

  let contextData = { allFiles: [], fileData: { slug: "", frontmatter: {} } };
  try {
    const rawData = await window.fetchData;
    const allFiles = Object.values(rawData).map((c) => ({
      slug: c.slug, frontmatter: { ...c }, links: c.links,
    }));
    const slug = document.body.dataset.slug || "";
    contextData = { allFiles, fileData: { slug, frontmatter: { ...(rawData[slug] || {}) } } };
  } catch (e) {
    console.error("MDX context fetch failed:", e);
  }

  for (const el of elements) {
    if (el.dataset.rendered === "true") continue;
    
    const mdxCode = el.dataset.mdx || "";
    const match = mdxCode.match(/<([A-Za-z0-9_]+)([^>]*)\\/?>(.*)/s);
    if (!match) continue;

    const componentName = match[1];
    const Component = registry[componentName];
    
    if (!Component) {
      el.innerHTML = '<div class="mdx-error">Component <strong>' + componentName + '</strong> not found.</div>';
      continue;
    }

    const inlineProps = parseProps(match[2] || "");
    
    // Render the component, merging Quartz context with inline props
    render(h(Component, { ...contextData, ...inlineProps }), el);
    el.dataset.rendered = "true";
  }
}

// Hook into Quartz SPA router
if (typeof document !== "undefined") {
  mountMdx(MDX_REGISTRY);
  document.addEventListener("nav", () => mountMdx(MDX_REGISTRY));
}
`;

export const MdxComponents: QuartzTransformerPlugin<MdxOptions> = (userOpts) => {
  const opts = { ...defaultOptions, ...userOpts };
  let bundledScript: string | null = null;

  return {
    name: "MdxComponents",
    htmlPlugins() {
      return [
        () => {
          return (tree: Root) => {
            visit(tree, "element", (node: Element, index, parent) => {
              if (node.tagName === "pre" && node.children.length > 0) {
                const codeNode = node.children[0] as Element;
                if (
                  codeNode.tagName === "code" &&
                  (typeof codeNode.properties?.className === "string"
                    ? codeNode.properties.className.includes("language-mdx")
                    : Array.isArray(codeNode.properties?.className) &&
                      codeNode.properties.className.includes("language-mdx"))
                ) {
                  const mdxCode =
                    codeNode.children[0]?.type === "text" ? codeNode.children[0].value : "";

                  const mdxIsland: Element = {
                    type: "element",
                    tagName: "div",
                    properties: {
                      className: ["mdx-component-mount"],
                      "data-mdx": mdxCode,
                    },
                    children: [],
                  };

                  if (parent && index !== undefined) parent.children[index] = mdxIsland;
                }
              }
            });
          };
        },
      ];
    },
    externalResources() {
      if (!bundledScript) {
        const absComponentsDir = path.resolve(process.cwd(), opts.componentsDir);

        if (!fs.existsSync(absComponentsDir)) {
          console.warn(`[MdxPlugin] Components directory not found: ${absComponentsDir}`);
          return {};
        }

        // 1. Auto-discover all .tsx and .jsx files in the user's directory
        const files = fs
          .readdirSync(absComponentsDir)
          .filter((f) => f.endsWith(".tsx") || f.endsWith(".jsx"));

        // 2. Generate the dynamic imports mapping
        const importStatements = files
          .map((f) => {
            const name = path.basename(f).replace(/\.(tsx|jsx)$/, "");
            return `import ${name} from "${path.join(absComponentsDir, f).replace(/\\/g, "/")}";`;
          })
          .join("\n");

        const registryObject = files
          .map((f) => path.basename(f).replace(/\.(tsx|jsx)$/, ""))
          .join(", ");

        // 3. Create the temporary entrypoint file for ESBuild
        const tempEntryPath = path.join(process.cwd(), ".quartz-mdx-entry.tsx");
        const entryContent = `
          ${importStatements}
          const MDX_REGISTRY = { ${registryObject} };
          ${RUNTIME_CODE}
        `;

        fs.writeFileSync(tempEntryPath, entryContent);

        try {
          // 4. Bundle using ESBuild.
          // absWorkingDir ensures it uses the user's node_modules (Preact)
          const result = buildSync({
            entryPoints: [tempEntryPath],
            absWorkingDir: process.cwd(),
            bundle: true,
            minify: true,
            write: false,
            format: "iife",
            jsxFactory: "h",
            jsxFragment: "Fragment",
            // CRITICAL: Load .scss and .css as raw text so the user's
            // \`import style from "./styles.scss"\` behaves exactly like Quartz components
            loader: {
              ".tsx": "tsx",
              ".ts": "ts",
              ".css": "text",
              ".scss": "text",
            },
          });

          const outJs = result.outputFiles.find((f) => f.path.endsWith(".js"));
          if (outJs) bundledScript = outJs.text;
        } catch (e) {
          console.error("[MdxPlugin] Bundle failed:", e);
        } finally {
          // Cleanup
          if (fs.existsSync(tempEntryPath)) fs.unlinkSync(tempEntryPath);
        }
      }

      return bundledScript
        ? {
            js: [
              {
                script: bundledScript,
                loadTime: "afterDOMReady",
                contentType: "inline",
                spaPreserve: true,
              },
            ],
          }
        : {};
    },
  };
};
