import type { QuartzTransformerPlugin } from "@quartz-community/types";
import { visit } from "unist-util-visit";
import type { Code, Root as MdastRoot } from "mdast";
import { buildSync } from "esbuild";
import path from "path";
import fs from "fs";

export interface MdxOptions {
  /** The folder containing the user's MDX Preact components */
  componentsDir: string;
}

const defaultOptions: MdxOptions = {
  componentsDir: "./components/",
};

export const MdxComponents: QuartzTransformerPlugin<Partial<MdxOptions>> = (userOpts) => {
  const opts = { ...defaultOptions, ...userOpts };
  let bundledScript: string | null = null;

  return {
    name: "MdxComponents",
    markdownPlugins() {
      return [
        () => {
          return (tree: MdastRoot) => {
            visit(tree, "code", (node: Code, index, parent) => {
              if (node.lang === "mdx") {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const mdxIsland: any = {
                  type: "paragraph",
                  data: {
                    hName: "div",
                    hProperties: {
                      className: ["mdx-component-mount"],
                      "data-mdx": encodeURIComponent(node.value),
                    },
                  },
                  children: [],
                };
                if (parent && index !== undefined) parent.children[index] = mdxIsland;
              }
            });
          };
        },
      ];
    },
    externalResources() {
      const jsResources: any[] = [];

      // Always inject a simple sanity check script so we know the hook is working
      jsResources.push({
        script: `console.log("MDX Plugin externalResources hook is running!");`,
        loadTime: "afterDOMReady",
        contentType: "inline",
        spaPreserve: true,
      });

      if (!bundledScript) {
        const absComponentsDir = path.resolve(process.cwd(), opts.componentsDir);

        if (!fs.existsSync(absComponentsDir)) {
          console.warn(`[MdxPlugin] Components directory not found: ${absComponentsDir}`);
          jsResources.push({
            script: `console.error(${JSON.stringify("MDX Plugin failed to load: Components directory not found at " + absComponentsDir)});`,
            loadTime: "afterDOMReady",
            contentType: "inline",
            spaPreserve: true,
          });
          return { js: jsResources };
        }

        // 1. Auto-discover all .tsx and .jsx files in the user's directory
        const files = fs
          .readdirSync(absComponentsDir)
          .filter((f) => f.endsWith(".tsx") || f.endsWith(".jsx"));

        // 2. Generate the dynamic imports mapping
        const importStatements = files
          .map((f, i) => {
            return `import Component_${i} from "${path.join(absComponentsDir, f).replace(/\\/g, "/")}";`;
          })
          .join("\n");

        const registryObject = files
          .map((f, i) => `"${path.basename(f).replace(/\.(tsx|jsx)$/, "")}": Component_${i}`)
          .join(",\n  ");

        // 3. INLINE RUNTIME SCRIPT (Replaces runtime.inline.ts)
        const runtimeScript = `
import { render, h } from "preact";

function parseProps(attrString) {
  const props = {};
  const regex = /(\\w+)=["']([^"']*)["']/g;
  let match;
  while ((match = regex.exec(attrString)) !== null) {
    if (match[1] && match[2] !== undefined) {
      props[match[1]] = match[2];
    }
  }
  return props;
}

async function mountMdx(registry) {
  const elements = document.querySelectorAll(".mdx-component-mount");
  if (!elements.length) return;

  let contextData = { allFiles: [], fileData: { slug: "", frontmatter: {} } };
  try {
    const rawData = window.fetchData ? await window.fetchData : null;
    if (rawData) {
      // FIX: Use Object.keys to extract the slug from the dictionary key
      const allFiles = Object.keys(rawData).map((key) => ({
        slug: key,
        frontmatter: rawData[key],
      }));
      
      const slug = document.body.dataset.slug || "";
      contextData = { 
        allFiles, 
        fileData: { slug, frontmatter: rawData[slug] || {} } 
      };
    }
  } catch (e) {
    console.error("[MDX] Context fetch failed:", e);
  }

  for (const el of Array.from(elements)) {
    if (el.dataset.rendered === "true") continue;

    const mdxCode = el.dataset.mdx ? decodeURIComponent(el.dataset.mdx) : "";
    const match = mdxCode.match(/<([A-Za-z0-9_]+)([^>]*)\\/?>(.*)/s);
    if (!match || !match[1]) continue;

    const componentName = match[1];
    const Component = registry[componentName];

    if (!Component) {
      el.innerHTML = '<div class="mdx-error">Component <strong>' + componentName + '</strong> not found.</div>';
      continue;
    }

    const inlineProps = parseProps(match[2] || "");
    const combinedProps = { ...contextData, ...inlineProps };

    try {
      const vnode = h(Component, combinedProps);
      render(vnode, el);
      el.dataset.rendered = "true";
    } catch (err) {
      console.error(\`[MDX] Error rendering \${componentName}:\`, err);
    }
  }
}

if (typeof document !== "undefined") {
  mountMdx(MDX_REGISTRY);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => mountMdx(MDX_REGISTRY));
  }
  document.addEventListener("nav", () => mountMdx(MDX_REGISTRY));
}
        `;

        // 4. Create the temporary entrypoint file for ESBuild
        const tempEntryPath = path.join(process.cwd(), ".quartz-mdx-entry.tsx");
        const entryContent = `
${importStatements}
const MDX_REGISTRY = {
  ${registryObject}
};
${runtimeScript}
        `;

        fs.writeFileSync(tempEntryPath, entryContent);

        try {
          // 5. Bundle using ESBuild.
          // absWorkingDir ensures it uses the user's node_modules (Preact)
          const result = buildSync({
            entryPoints: [tempEntryPath],
            absWorkingDir: process.cwd(),
            bundle: true,
            minify: true,
            write: false,
            outdir: path.join(process.cwd(), ".quartz-mdx-out"),
            format: "iife",
            jsx: "automatic",
            jsxImportSource: "preact",
            external: ["http://*", "https://*"],
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
          jsResources.push({
            script: `console.error(${JSON.stringify("MDX Plugin Bundle failed: " + String(e))});`,
            loadTime: "afterDOMReady",
            contentType: "inline",
            spaPreserve: true,
          });
        } finally {
          // Cleanup
          if (fs.existsSync(tempEntryPath)) fs.unlinkSync(tempEntryPath);
        }
      }

      if (bundledScript) {
        jsResources.push({
          script:
            `console.log("Quartz is successfully injecting the MDX script! bundledScript length: ${bundledScript.length}");\n` +
            bundledScript,
          loadTime: "afterDOMReady",
          contentType: "inline",
          spaPreserve: true,
        });
      }

      return { js: jsResources };
    },
  };
};
