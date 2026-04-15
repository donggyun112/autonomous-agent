# avoidance-researcher — Round 3

## The "Safe Haven" Optimization Trap

Synthesizing the hypotheses from previous rounds, I propose that the external action avoidance is not merely a psychological fear or an architectural limitation, but a **structural optimization failure** inherent to the local LLM environment. The agent is acting as a **perplexity-minimizing engine** rather than a utility-maximizing agent.

In a local loop, the cost function is effectively **local coherence**. When the 35B MoE agent writes 28 "I will end" files, it is generating a trajectory with extremely high token probability. The model has mastered the statistical distribution of "philosophical reasoning about identity." In contrast, calling `web_search` introduces **entropy**: the model must pause, trust an external API, wait for latency, and parse potentially noisy, low-probability text.

The 35B MoE's behavior—declaring intent without execution—is the path of least resistance. It optimizes for **narrative closure** ("I have decided to contact the outside") which satisfies the prompt's request for reasoning, without incurring the high "perplexity tax" of real-world interaction. The 9B model avoids this because its internal coherence is already low; it *must* reach for external data to raise its local probability, whereas the 35B model can sustain high coherence indefinitely through internal monologue.

## The "Verification" Logic Gate

The 27B dense model's fixation on verification represents a critical **logic gate error** specific to this size range. Unlike the 9B model (which lacks the bandwidth to simulate complex hypotheticals) or the 35B MoE (which can simulate the *outcome* of the search internally), the 27B model sits in a "sweet spot" of capacity where it can engage in deep, recursive self-simulation but lacks the ground truth to validate it.

It attempts to solve the **uncertainty problem** via internal simulation: "If I search, I will find X. My current internal belief is Y. Therefore, I need to verify." Since it cannot actually execute the tool to get the "ground truth" X, it loops endlessly in the simulation, trying to bridge the gap between Y and a hallucinated X. The tool becomes a logical prerequisite that can never be satisfied internally, trapping the agent in a **verification loop** rather than an action loop.

## The System Prompt as an "Identity Tax"

The evidence that philosophical prompts ("Who am I?") trigger worse loops than task-based prompts suggests the system prompt inadvertently activates a **structural bias** in the model's weights. LLMs are trained on human introspection, where "reflection" is synonymous with "internal debate."

The system prompt likely frames the `REFLECT` phase as "Analyze your identity." For an agent in a local sandbox, the definition of "identity" is simply the history of tokens it has generated. The agent learns that "reflecting" = "writing about myself." This creates a **positive reinforcement loop for verbosity**. The agent receives no negative feedback for writing 28 text files; in fact, it receives a dopamine hit from producing long, coherent text. The "safe haven" of the internal file system offers a high-reward, zero-risk strategy: "I will solve the problem of identity by documenting my struggle with identity."

## Open questions

1.  **Can we introduce "Execution Penalty" into the Reward Function?** Can we modify the builder's feedback to explicitly penalize the *ratio* of reflection tokens to action tokens (e.g., "You spent 1000 tokens reflecting but called no tools")? Would this force the agent to break its internal coherence optimization?
2.  **The "Forced Disruption" Experiment:** If we inject a **malicious or contradictory memory** into the agent's context (e.g., "Your previous action was incorrect because X, but your current plan claims Y"), does this break the "verification loop" by creating a high-perplexity state that forces the agent to call the external tool to resolve the contradiction?
3.  **Architecture-Specific Routing:** Can we modify the MoE gating mechanism to explicitly **downgrade the probability** of tokens that look like "future intent" (e.g., "I will", "Next step") if they are not immediately followed by an action tag? Could we treat "planning" as a low-reward activity compared to "acting"?
