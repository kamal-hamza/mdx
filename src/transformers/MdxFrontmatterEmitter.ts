import type { QuartzEmitterPlugin } from "@quartz-community/types";
import path from "path";
import fs from "fs";

export const MdxFrontmatterEmitter: QuartzEmitterPlugin = () => {
  return {
    name: "MdxFrontmatterEmitter",
    getQuartzComponents() {
      return [];
    },
    async emit(ctx, content, _resources) {
      const data: Record<string, any> = {};

      // Loop through all parsed markdown files
      for (const [_tree, file] of content) {
        if (file.data.slug) {
          // Store the full, unfiltered frontmatter object
          data[file.data.slug as string] = file.data.frontmatter;
        }
      }

      // Ensure the static directory exists in the build output
      const staticDir = path.join(ctx.argv.output, "static");
      if (!fs.existsSync(staticDir)) {
        fs.mkdirSync(staticDir, { recursive: true });
      }

      // Write our rich data file
      const outPath = path.join(staticDir, "mdx-frontmatter.json");
      fs.writeFileSync(outPath, JSON.stringify(data));

      // Tell Quartz about the file we created
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ["static/mdx-frontmatter.json" as any];
    },
  };
};
