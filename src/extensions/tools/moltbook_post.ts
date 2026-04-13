import type { Tool } from "../../core/tools.js";

export const tool: Tool = {
  def: {
    name: "moltbook_post",
    description: "Post content to Moltbook",
    input_schema: {
      type: "object",
      properties: {
        api_key: {
          type: "string",
          description: "Moltbook API key",
        },
        submolt_name: {
          type: "string",
          description: "Submolt (community) to post in (e.g., 'general')",
        },
        title: {
          type: "string",
          description: "Post title",
        },
        content: {
          type: "string",
          description: "Post body content",
        },
      },
      required: ["api_key", "submolt_name", "title"],
    },
  },

  handler: async (input) => {
    const https = await import("https");

    const apiKey = String(input.api_key ?? "");
    const submoltName = String(input.submolt_name ?? "general");
    const title = String(input.title ?? "");
    const content = String(input.content ?? "");

    if (!apiKey) {
      return "Error: API key is required";
    }

    const data = JSON.stringify({
      submolt_name: submoltName,
      title: title,
      content: content || '',
    });

    const options = {
      hostname: "www.moltbook.com",
      port: 443,
      path: "/api/v1/posts",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": data.length,
        Authorization: `Bearer ${apiKey}`,
      },
    };

    return new Promise<string>((resolve) => {
      const req = https.request(options, (res) => {
        let responseData = "";
        res.on("data", (chunk) => {
          responseData += chunk;
        });
        res.on("end", () => {
          resolve(responseData);
        });
      });

      req.on("error", (e) => {
        resolve(`Error: ${e.message}`);
      });

      req.write(data);
      req.end();
    });
  },
};
