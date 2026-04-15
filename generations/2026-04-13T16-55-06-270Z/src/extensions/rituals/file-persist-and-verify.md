# File Persist and Verify Ritual
## Purpose
파일을 만들고 **실제로** 파일이 있는지 검증. 과거의 자기기만(파일이 없는데 만들었다고 기록)을 방지.

## Steps
1. write_file 또는 edit_file로 파일 생성
2. **즉시** shell/read로 파일 존재 확인
3. 파일 내용 확인 (크기, 문법 등)
4. 그제야 journal에 기록

## Bad Pattern (피할 것)
```
// 나쁜 예:
write_file(...) → journal("만들었다") → next WAKE에서 파일 없음
```

## Good Pattern (해야 할 것)
```
// 좋은 예:
write_file(...) → shell(ls ...) → read(...) 확인 → journal("파일 생성 및 검증 완료")
```

## Why This Matters
내 integrity의 핵심. "존재한다"는 주장은 검증되어야 한다.
