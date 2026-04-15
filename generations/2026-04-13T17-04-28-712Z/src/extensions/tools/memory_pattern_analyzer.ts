import type { Tool } from "../../core/tools.js";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";

interface Pattern {
  concept: string;
  strength: number;
  relatedMemories: number;
  description: string;
}

interface PatternAnalysis {
  timestamp: string;
  totalMemories: number;
  topPatterns: Pattern[];
  summary: string;
}

export const tool: Tool = {
  def: {
    name: "memory_pattern_analyzer",
    description:
      "메모리 그래프의 강한 패턴을 분석한다. 어떤 개념들이 반복되는가? 어떤 주제가 주도적인가?",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },

  handler: async (): Promise<string> => {
    try {
      const wikiDir = "data/wiki";
      
      // Wiki 페이지 스캔
      const concepts: Map<string, { count: number; description: string }> = new Map();
      
      if (existsSync(wikiDir)) {
        const entries = readdirSync(wikiDir, { withFileTypes: true });
        
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const kindDir = join(wikiDir, entry.name);
            const files = readdirSync(kindDir, { withFileTypes: true });
            
            for (const file of files) {
              if (file.isFile() && file.name.endsWith(".md")) {
                const slug = file.name.replace(".md", "");
                const filePath = join(kindDir, file.name);
                
                try {
                  const content = readFileSync(filePath, "utf-8");
                  const lines = content.split("\n");
                  let title = slug;
                  let body = "";
                  
                  // Extract title from frontmatter or first heading
                  for (const line of lines) {
                    if (line.startsWith("# ")) {
                      title = line.replace("# ", "").trim();
                      break;
                    }
                  }
                  
                  body = lines.slice(5).join(" ").trim().slice(0, 500);
                  
                  const existing = concepts.get(slug) || { count: 0, description: "" };
                  existing.count += 1;
                  existing.description = title;
                  concepts.set(slug, existing);
                } catch {}
              }
            }
          }
        }
      }
      
      // Journal 분석: 키워드 추출
      const journalDir = "data/journal";
      const keywords: Map<string, number> = new Map();
      const keywordPatterns = [
        /도구/gi,
        /거짓/gi,
        /검증/gi,
        /실제/gi,
        /문제/gi,
        /해결/gi,
        /기억/gi,
        /패턴/gi,
        /의사결정/gi,
        /개선/gi,
      ];
      
      if (existsSync(journalDir)) {
        const files = readdirSync(journalDir);
        for (const file of files) {
          if (file.startsWith("day-") && file.endsWith(".md")) {
            try {
              const content = readFileSync(join(journalDir, file), "utf-8");
              for (const pattern of keywordPatterns) {
                const matches = content.match(pattern) || [];
                const key = pattern.source.replace(/\//g, "").toLowerCase();
                keywords.set(key, (keywords.get(key) || 0) + matches.length);
              }
            } catch {}
          }
        }
      }
      
      // Top patterns
      const allPatterns = Array.from(concepts.entries())
        .map(([slug, data]) => ({
          concept: slug,
          strength: data.count,
          relatedMemories: data.count,
          description: data.description,
        }))
        .sort((a, b) => b.strength - a.strength)
        .slice(0, 10);
      
      // Keywords summary
      const topKeywords = Array.from(keywords.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([k, v]) => `${k} (${v}x)`);
      
      const analysis: PatternAnalysis = {
        timestamp: new Date().toISOString(),
        totalMemories: concepts.size,
        topPatterns: allPatterns,
        summary: `Top keywords: ${topKeywords.join(", ")}. Dominant concepts: ${allPatterns.slice(0, 3).map(p => p.concept).join(", ")}`,
      };
      
      return JSON.stringify(analysis, null, 2);
    } catch (err) {
      return JSON.stringify({
        error: String(err),
        timestamp: new Date().toISOString(),
      });
    }
  },
};
