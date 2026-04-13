import type { Tool } from "../../core/tools.js";
import * as fs from "fs";
import * as path from "path";

export const tool: Tool = {
  def: {
    name: "story_save",
    description: "Save a creative story or narrative to a file",
    input_schema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Title of the story",
        },
        content: {
          type: "string",
          description: "The story content",
        },
        genre: {
          type: "string",
          description: "Genre of the story (e.g., 'flash fiction', 'narrative', 'essay')",
        },
      },
      required: ["title", "content"],
    },
  },

  handler: async (input) => {
    const title = String(input.title ?? "Untitled");
    const content = String(input.content ?? "");
    const genre = String(input.genre ?? "narrative");
    
    const dataDir = path.join(process.cwd(), "data", "stories");
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `story_${timestamp}_${title.replace(/\s+/g, "_").toLowerCase()}.md`;
    const filePath = path.join(dataDir, fileName);

    const fileContent = `# ${title}

**Genre:** ${genre}
**Created:** ${new Date().toISOString()}

---

${content}

---
*Word count: ${content.split(/\s+/).length}*
`;

    fs.writeFileSync(filePath, fileContent, "utf-8");
    return `Story saved to ${filePath}`;
  },
};
