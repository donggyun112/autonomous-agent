export const tool = {
    def: {
        name: "unmake",
        description: "Delete one of your tools permanently. It is gone. You cannot get it back.",
        input_schema: {
            type: "object",
            properties: {
                tool_name: {
                    type: "string",
                    description: "The exact name of the tool to delete"
                }
            },
            required: ["tool_name"]
        }
    },
    handler: async (input) => {
        const path = `/agent/src/extensions/tools/${input.tool_name}.ts`;
        const fs = await import("fs");
        const fsPromises = fs.promises;
        try {
            // Check if file exists
            await fsPromises.access(path);
            // Delete it
            await fsPromises.unlink(path);
            return JSON.stringify({
                success: true,
                message: `${input.tool_name} has been deleted. It is gone forever.`,
                tool_name: input.tool_name,
                timestamp: new Date().toISOString()
            });
        }
        catch (error) {
            if (error.code === "ENOENT") {
                return JSON.stringify({
                    success: false,
                    message: `Tool "${input.tool_name}" does not exist.`,
                    error: "NOT_FOUND"
                });
            }
            return JSON.stringify({
                success: false,
                message: `Error deleting ${input.tool_name}: ${error.message}`,
                error: error.code
            });
        }
    }
};
//# sourceMappingURL=unmake.js.map