# BCD Auth

React + TypeScript + Supabase로 만든 서버리스 회원가입/로그인 앱입니다.

## 시작하기

1. Supabase에서 프로젝트를 생성합니다.
2. `supabase/schema.sql`을 Supabase SQL Editor에서 실행합니다.
3. `.env.example`을 `.env`로 복사하고 Project Settings > API의 URL과 anon key를 입력합니다.
4. Supabase Authentication > URL Configuration에서 Site URL을 실제 배포 주소로 설정합니다. 로컬 개발 시 Redirect URLs에 `http://localhost:5173/**`를 추가합니다.
5. 아래 명령을 실행합니다.

```bash
npm install
npm run dev
```

회원가입 시 이름은 `auth.users`의 user metadata와 `public.profiles` 테이블에 저장됩니다. RLS 정책으로 사용자는 자신의 프로필만 읽고 수정할 수 있습니다.

## Gemini AI 연결

AI 요청은 API 키가 브라우저에 노출되지 않도록 Supabase Edge Function을 통해 전달됩니다. Google AI Studio에서 발급한 키를 Supabase secret으로 등록한 뒤 함수를 배포합니다.

```bash
npm install supabase --save-dev
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase secrets set GEMINI_API_KEY=YOUR_GEMINI_API_KEY
npx supabase functions deploy gemini-answer
```

`YOUR_PROJECT_REF`는 Supabase 프로젝트 URL의 앞부분입니다. 예를 들어 URL이 `https://abcdefgh.supabase.co`라면 project ref는 `abcdefgh`입니다.

Gemini 키를 `VITE_GEMINI_API_KEY`처럼 프론트엔드 환경변수로 만들면 사용자에게 노출되므로 사용하지 마세요.
