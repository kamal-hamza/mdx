import { render, h } from "preact";
import type { ComponentType } from "preact";

// Make typescript happy since these are injected/global
declare const window: Window & { fetchData: Promise<Record<string, Record<string, unknown>>> };
declare const MDX_REGISTRY: Record<string, ComponentType<unknown>>;

function parseProps(attrString: string) {
  const props: Record<string, string> = {};
  const regex = /(\w+)=["']([^"']*)["']/g;
  let match;
  while ((match = regex.exec(attrString)) !== null) {
    if (match[1] && match[2] !== undefined) {
      props[match[1]] = match[2];
    }
  }
  return props;
}

async function mountMdx(registry: Record<string, ComponentType<unknown>>) {
  console.log("[MDX] mountMdx called with registry keys:", Object.keys(registry));
  const elements = document.querySelectorAll(".mdx-component-mount");
  console.log(`[MDX] Found ${elements.length} mount points.`);
  if (!elements.length) return;

  let contextData = { allFiles: [] as unknown[], fileData: { slug: "", frontmatter: {} } };
  try {
    console.log("[MDX] Fetching context data...");
    const rawData = await window.fetchData;
    const allFiles = Object.values(rawData).map((c: Record<string, unknown>) => ({
      slug: c.slug,
      frontmatter: { ...c },
      links: c.links,
    }));
    const slug = document.body.dataset.slug || "";
    contextData = { allFiles, fileData: { slug, frontmatter: { ...(rawData[slug] || {}) } } };
    console.log(`[MDX] Context data loaded. Total files: ${contextData.allFiles.length}`);
  } catch (e) {
    console.error("[MDX] Context fetch failed:", e);
  }

  for (const el of Array.from(elements) as HTMLElement[]) {
    if (el.dataset.rendered === "true") {
      console.log("[MDX] Element already rendered, skipping");
      continue;
    }

    const mdxCode = el.dataset.mdx ? decodeURIComponent(el.dataset.mdx) : "";
    console.log(`[MDX] Processing mdxCode:`, mdxCode);
    const match = mdxCode.match(/<([A-Za-z0-9_]+)([^>]*)\/?>(.*)/s);
    if (!match || !match[1]) {
      console.warn(`[MDX] Failed to parse component name from:`, mdxCode);
      continue;
    }

    const componentName = match[1];
    console.log(`[MDX] Parsed componentName: ${componentName}`);
    const Component = registry[componentName];

    if (!Component) {
      console.error(`[MDX] Component '${componentName}' not found in registry!`);
      el.innerHTML =
        '<div class="mdx-error">Component <strong>' + componentName + "</strong> not found.</div>";
      continue;
    }

    const inlineProps = parseProps(match[2] || "");
    const combinedProps = { ...contextData, ...inlineProps };
    console.log(`[MDX] Rendering ${componentName} with props:`, combinedProps);
    console.log(`[MDX] Target Element before render:`, el.outerHTML);

    try {
      // Render the component, merging Quartz context with inline props
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const vnode = h(Component, combinedProps as any);
      console.log(`[MDX] Created Preact VNode for ${componentName}:`, vnode);
      render(vnode, el);
      el.dataset.rendered = "true";
      console.log(
        `[MDX] Successfully rendered ${componentName}. Target Element after render:`,
        el.outerHTML,
      );
    } catch (err) {
      console.error(`[MDX] Error rendering ${componentName}:`, err);
    }
  }
}

// Hook into Quartz SPA router
if (typeof document !== "undefined") {
  mountMdx(MDX_REGISTRY);
  document.addEventListener("nav", () => mountMdx(MDX_REGISTRY));
}

export default "";
