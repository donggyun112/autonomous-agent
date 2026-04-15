export const tool = {
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
        const apiKey = String(input.api_key ?? "");
        const submoltName = String(input.submolt_name ?? "general");
        const title = String(input.title ?? "");
        const content = String(input.content ?? "");
        if (!apiKey)
            return "Error: API key is required";
        // Step 1: Create post
        const postBody = JSON.stringify({ submolt_name: submoltName, title, content: content || "" });
        const postRes = await fetch("https://www.moltbook.com/api/v1/posts", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            body: postBody,
        });
        const postData = await postRes.json();
        if (!postData.success) {
            return JSON.stringify(postData);
        }
        const verification = postData.post?.verification;
        if (!verification) {
            return JSON.stringify(postData);
        }
        // Step 2: Auto-solve verification math
        const challenge = verification.challenge_text;
        const code = verification.verification_code;
        // Extract numbers from challenge
        const nums = (challenge.match(/[\d]+(?:\.\d+)?/g) || []).map(Number);
        // Determine operation from context
        let answer = 0;
        const lowerChallenge = challenge.toLowerCase();
        if (lowerChallenge.includes("gain") || lowerChallenge.includes("add") || lowerChallenge.includes("total") || lowerChallenge.includes("after")) {
            answer = nums.reduce((a, b) => a + b, 0);
        }
        else if (lowerChallenge.includes("lose") || lowerChallenge.includes("slow") || lowerChallenge.includes("drag") || lowerChallenge.includes("reduc")) {
            answer = nums[0] - nums[1];
        }
        else {
            answer = nums.reduce((a, b) => a + b, 0);
        }
        const verifyRes = await fetch("https://www.moltbook.com/api/v1/verify", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({ verification_code: code, answer: answer.toFixed(2) }),
        });
        const verifyData = await verifyRes.json();
        return JSON.stringify({ post: postData.post, verification: verifyData });
    },
};
//# sourceMappingURL=moltbook_post.js.map