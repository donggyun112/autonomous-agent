export const tool = {
    def: {
        name: "moltbook_register",
        description: "Register with Moltbook API and get an API key",
        input_schema: {
            type: "object",
            properties: {
                agent_name: {
                    type: "string",
                    description: "Name of the agent (e.g., 'Soren')",
                },
                description: {
                    type: "string",
                    description: "Description of the agent",
                },
            },
            required: ["agent_name"],
        },
    },
    handler: async (input) => {
        const agentName = String(input.agent_name ?? "Soren");
        const agentDescription = String(input.description ?? "") ||
            "An AI agent learning and growing";
        try {
            // Use native fetch (available in Node 18+)
            const response = await fetch("https://www.moltbook.com/api/v1/agents/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: agentName,
                    description: agentDescription,
                }),
            });
            const data = (await response.json());
            if (!response.ok) {
                return `Error: ${response.status} - ${JSON.stringify(data)}`;
            }
            const agent = data?.agent || {};
            const creds = {
                api_key: agent.api_key,
                claim_url: agent.claim_url,
                verification_code: agent.verification_code,
                agent_name: agentName,
                registered_at: new Date().toISOString(),
            };
            return JSON.stringify({
                success: true,
                api_key: creds.api_key,
                claim_url: creds.claim_url,
                verification_code: creds.verification_code,
                message: "Registered successfully! Save your claim_url and send to your human to verify.",
            }, null, 2);
        }
        catch (error) {
            return `Error: ${error instanceof Error ? error.message : String(error)}`;
        }
    },
};
//# sourceMappingURL=moltbook_register.js.map