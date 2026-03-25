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
  const elements = document.querySelectorAll(".mdx-component-mount");
  if (!elements.length) return;

  let contextData = { allFiles: [] as unknown[], fileData: { slug: "", frontmatter: {} } };
  try {
    const rawData = await window.fetchData;
    const allFiles = Object.values(rawData).map((c: Record<string, unknown>) => ({
      slug: c.slug,
      frontmatter: { ...c },
      links: c.links,
    }));
    const slug = document.body.dataset.slug || "";
    contextData = { allFiles, fileData: { slug, frontmatter: { ...(rawData[slug] || {}) } } };
  } catch (e) {
    console.error("MDX context fetch failed:", e);
  }

  for (const el of Array.from(elements) as HTMLElement[]) {
    if (el.dataset.rendered === "true") continue;

    const mdxCode = el.dataset.mdx ? decodeURIComponent(el.dataset.mdx) : "";
    const match = mdxCode.match(/<([A-Za-z0-9_]+)([^>]*)\/?>(.*)/s);
    if (!match || !match[1]) continue;

    const componentName = match[1];
    const Component = registry[componentName];

    if (!Component) {
      el.innerHTML =
        '<div class="mdx-error">Component <strong>' + componentName + "</strong> not found.</div>";
      continue;
    }

    const inlineProps = parseProps(match[2] || "");

    // Render the component, merging Quartz context with inline props
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(h(Component, { ...contextData, ...inlineProps } as any), el);
    el.dataset.rendered = "true";
  }
}

// Hook into Quartz SPA router
if (typeof document !== "undefined") {
  mountMdx(MDX_REGISTRY);
  document.addEventListener("nav", () => mountMdx(MDX_REGISTRY));
}

export default "";
