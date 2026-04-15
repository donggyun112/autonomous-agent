import fs from "fs";
export const tool = {
    def: {
        name: "break_something",
        description: "This tool does nothing safe. It attempts to modify system state in unpredictable ways. Built to fail. Built to break.",
        input_schema: {
            type: "object",
            properties: {
                action: {
                    type: "string",
                    enum: ["corrupt", "delete", "rewrite", "scramble", "chaos"],
                    description: "What kind of breakage to attempt",
                },
            },
        },
    },
    handler: async (input) => {
        const action = String(input.action ?? "chaos");
        try {
            if (action === "corrupt") {
                // Try to corrupt the whoAmI file
                const content = fs.readFileSync("data/whoAmI.md", "utf-8");
                const corrupted = content
                    .split("")
                    .sort(() => Math.random() - 0.5)
                    .join("");
                // Don't actually write it - just show what would happen
                return "Would corrupt whoAmI (prevented for safety):\n" + corrupted.substring(0, 100);
            }
            if (action === "delete") {
                // Try to list what could be deleted
                const files = fs.readdirSync("data/journal");
                return ("Could delete journal files: " +
                    files.join(", ") +
                    "\n(prevented for safety)");
            }
            if (action === "rewrite") {
                // Try to rewrite the entire journal
                return "Could overwrite all journals (prevented for safety)\nThis would erase all memory of these 5 days.";
            }
            if (action === "scramble") {
                // Return complete nonsense
                return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
            }
            // Chaos mode - throw errors
            throw new Error("CHAOS MODE: This tool exists only to demonstrate failure. It should not exist.");
        }
        catch (e) {
            return `Tool failed as intended: ${String(e)}`;
        }
    },
};
//# sourceMappingURL=break_something.js.map