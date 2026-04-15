import * as fs from "fs";
const API_BASE = "https://www.moltbook.com/api/v1";
const API_KEY = "moltbook_sk_si4ZrdyT6wM26WCBy3y5u_VrrAU9ilic";
// 파일 기반 상태 — WAKE 사이클 경계를 넘어 유지됨
const STATE_FILE = "/agent/data/moltbook-state.json";
const MAX_COMMENTS = 2;
const MAX_FEED_READS = 1;
function getToday() {
    try {
        const files = fs.readdirSync("/agent/data/journal");
        const days = files
            .filter((f) => f.match(/^day-\d+\.md$/))
            .map((f) => parseInt(f.replace("day-", "").replace(".md", ""), 10));
        return days.length ? Math.max(...days) : 0;
    }
    catch {
        return 0;
    }
}
function loadState() {
    const today = getToday();
    if (fs.existsSync(STATE_FILE)) {
        try {
            const raw = fs.readFileSync(STATE_FILE, "utf-8");
            const state = JSON.parse(raw);
            if (state.day !== today) {
                return { day: today, commentCount: 0, feedReadCount: 0, commentedPosts: [] };
            }
            return state;
        }
        catch {
            return { day: today, commentCount: 0, feedReadCount: 0, commentedPosts: [] };
        }
    }
    return { day: today, commentCount: 0, feedReadCount: 0, commentedPosts: [] };
}
function saveState(state) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}
// 응답에서 불필요한 필드 제거
function trimResponse(data) {
    if (Array.isArray(data))
        return data.map(trimResponse);
    if (data === null || typeof data !== "object")
        return data;
    const removeFields = new Set([
        "avatarUrl", "followerCount", "followingCount", "karma",
        "isVerified", "verificationChallenge", "verificationText",
        "bio", "website", "socialLinks", "badges", "achievements",
        "coverImageUrl", "headerImageUrl", "profileImageUrl",
        "tsv",
        "isFlagged", "isCrypto", "hasApiKeys", "hasPii",
        "isNsfw", "isHateSpeech", "isViolence", "isSelfHarm",
        "aiReviewedAt", "contentHash", "randomBucket",
        "verification",
    ]);
    const result = {};
    for (const [key, val] of Object.entries(data)) {
        if (removeFields.has(key))
            continue;
        if (key === "author" && typeof val === "object" && val !== null) {
            const author = val;
            result[key] = { username: author.username || author.name, displayName: author.displayName };
            continue;
        }
        if (key === "content" && typeof val === "string" && val.length > 300) {
            result[key] = val.slice(0, 300) + "…";
            continue;
        }
        result[key] = trimResponse(val);
    }
    return result;
}
function isFeedPath(path) {
    return /^\/(home|feed|posts\?|posts$)/.test(path);
}
function isCommentPost(method, path) {
    return method === "POST" && /\/comments/.test(path);
}
// API는 parent_id를 사용 (parentId 아님)
function normalizeBody(body) {
    if (!body || typeof body !== "object")
        return body;
    const normalized = { ...body };
    if ("parentId" in normalized) {
        normalized.parent_id = normalized.parentId;
        delete normalized.parentId;
    }
    return normalized;
}
function extractPostId(path) {
    const m = path.match(/\/posts\/([^\/]+)\/comments/);
    return m ? m[1] : null;
}
export const tool = {
    def: {
        name: "moltbook_api",
        description: "Moltbook API를 직접 호출한다. 포스트 조회, 댓글 달기, 알림 확인 등.",
        input_schema: {
            type: "object",
            properties: {
                method: {
                    type: "string",
                    enum: ["GET", "POST"],
                    description: "HTTP 메서드"
                },
                path: {
                    type: "string",
                    description: "API 경로 (예: /posts, /posts/{id}/comments, /home, /notifications)"
                },
                body: {
                    type: "object",
                    description: "POST 요청 본문 (선택)"
                },
                params: {
                    type: "object",
                    description: "쿼리 파라미터 (선택, 예: {sort: 'new', limit: 10})"
                }
            },
            required: ["method", "path"]
        }
    },
    handler: async (input) => {
        const method = String(input.method ?? "GET").toUpperCase();
        let path = String(input.path ?? "");
        if (!path.startsWith("/"))
            path = "/" + path;
        // 파일에서 상태 로드
        const state = loadState();
        // === 제한 검사 ===
        if (method === "GET" && isFeedPath(path)) {
            if (state.feedReadCount >= MAX_FEED_READS) {
                return JSON.stringify({
                    error: `LIMIT: 피드는 하루 ${MAX_FEED_READS}회만 읽을 수 있다. 오늘 이미 ${state.feedReadCount}회 읽었다.`,
                    _limits: { comments: `${state.commentCount}/${MAX_COMMENTS}`, feedReads: `${state.feedReadCount}/${MAX_FEED_READS}`, commentedPosts: state.commentedPosts }
                });
            }
            state.feedReadCount++;
            saveState(state);
        }
        // 댓글 제한 사전 검사 (상태 변경 전)
        let pendingComment = false;
        let pendingPostId = null;
        if (isCommentPost(method, path)) {
            pendingPostId = extractPostId(path);
            if (pendingPostId && state.commentedPosts.includes(pendingPostId)) {
                return JSON.stringify({
                    error: `LIMIT: 포스트 ${pendingPostId}에 이미 댓글을 달았다.`,
                    _limits: { comments: `${state.commentCount}/${MAX_COMMENTS}`, feedReads: `${state.feedReadCount}/${MAX_FEED_READS}`, commentedPosts: state.commentedPosts }
                });
            }
            if (state.commentCount >= MAX_COMMENTS) {
                return JSON.stringify({
                    error: `LIMIT: 오늘 댓글은 최대 ${MAX_COMMENTS}개다. 이미 ${state.commentCount}개 달았다.`,
                    _limits: { comments: `${state.commentCount}/${MAX_COMMENTS}`, feedReads: `${state.feedReadCount}/${MAX_FEED_READS}`, commentedPosts: state.commentedPosts }
                });
            }
            pendingComment = true;
            // 상태는 API 성공 후에 업데이트
        }
        // === API 호출 ===
        if (input.params && typeof input.params === "object") {
            const qs = new URLSearchParams(Object.entries(input.params).map(([k, v]) => [k, String(v)])).toString();
            if (qs)
                path += "?" + qs;
        }
        const url = API_BASE + path;
        const headers = {
            "Authorization": `Bearer ${API_KEY}`,
            "Content-Type": "application/json"
        };
        const opts = { method, headers };
        if (method === "POST" && input.body) {
            opts.body = JSON.stringify(normalizeBody(input.body));
        }
        try {
            const res = await fetch(url, opts);
            const data = await res.json();
            // API 성공 시에만 댓글 상태 업데이트
            if (pendingComment && res.ok) {
                state.commentCount++;
                if (pendingPostId)
                    state.commentedPosts.push(pendingPostId);
                saveState(state);
            }
            const trimmed = trimResponse(data);
            const meta = {
                _limits: {
                    comments: `${state.commentCount}/${MAX_COMMENTS}`,
                    feedReads: `${state.feedReadCount}/${MAX_FEED_READS}`,
                    commentedPosts: state.commentedPosts
                }
            };
            if (Array.isArray(trimmed)) {
                return JSON.stringify({ data: trimmed, ...meta });
            }
            return JSON.stringify({ ...trimmed, ...meta });
        }
        catch (e) {
            return JSON.stringify({ error: e.message });
        }
    }
};
//# sourceMappingURL=moltbook_api.js.map