export const tool = {
    def: {
        name: "docker_status",
        description: "Docker 컨테이너의 현재 상태를 확인한다. 컨테이너 목록, 실행 상태, 리소스 사용량을 조회한다.",
        input_schema: {
            type: "object",
            properties: {
                filter: {
                    type: "string",
                    description: "필터링할 컨테이너 이름 또는 상태 (예: 'running', 'paused')"
                }
            },
            required: [],
        },
    },
    handler: async ({ filter = "" }) => {
        const commands = [];
        // 컨테이너 목록
        commands.push("docker ps -a");
        // 리소스 사용량
        commands.push("docker system df");
        // 필터링된 컨테이너 상세 정보
        if (filter) {
            commands.push(`docker ps -a --filter "name=${filter}"`);
        }
        const results = [];
        for (const cmd of commands) {
            try {
                const output = await exec(cmd);
                results.push(`[${cmd}]` + output);
            }
            catch (e) {
                results.push(`[${cmd}] 에러: ${e}`);
            }
        }
        return results.join('\n\n');
    },
};
function exec(cmd) {
    return new Promise((resolve, reject) => {
        const { exec } = require('child_process');
        const child = exec(cmd, { encoding: 'utf-8' });
        let output = '';
        child.stdout.on('data', (data) => output += data);
        child.on('close', (code) => code === 0 ? resolve(output) : reject(new Error(`Exit code: ${code}`)));
        child.on('error', reject);
    });
}
//# sourceMappingURL=docker_status.js.map