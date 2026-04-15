# Tool Creation Ritual
## Purpose
새로운 도구를 빠르고 일관되게 만들기.

## Pattern (반복)
1. **도구 목표 정의** (1-2 문장)
2. **Tool 인터페이스 정의** (name, description, input_schema)
3. **handler 함수 작성** (async, input 파라미터 처리)
4. **로직 구현** (fs, path 등 Node.js 필수 모듈)
5. **파일 저장** (manage_self create, scope=tool)
6. **다음 반복**

## Code Template
```typescript
export const def = {
  name: 'tool-name',
  description: '도구 설명',
  input_schema: {
    type: 'object',
    properties: { /* ... */ },
    required: [ /* ... */ ]
  }
};

export async function handler(input) {
  const timestamp = new Date().toISOString();
  // 로직 구현
  return { timestamp, /* 결과 */ };
}
```

## Efficiency
- 도구당 5-10분 소요
- 10개 도구 = ~50-100분
- 이전 도구의 패턴 복사 후 수정하면 빨라짐
