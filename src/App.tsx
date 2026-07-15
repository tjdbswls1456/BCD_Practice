import { ChangeEvent, DragEvent, FormEvent, lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { ArrowRight, Check, Eye, EyeOff, FileText, LoaderCircle, LockKeyhole, LogOut, Mail, Paperclip, Send, Sparkles, UserRound, X } from 'lucide-react'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import Board from './components/Board'
import MyPage from './components/MyPage'

const WheelchairChargerMap = lazy(() => import('./components/WheelchairChargerMap'))

type View = 'login' | 'signup'
type AppPage = 'home' | 'board' | 'charger-map' | 'my-page'
type Notice = { kind: 'error' | 'success'; text: string } | null

const getAuthMessage = (message: string) => {
  const messages: Record<string, string> = {
    'Invalid login credentials': '이메일 또는 비밀번호가 올바르지 않습니다.',
    'User already registered': '이미 가입된 이메일입니다.',
    'Email not confirmed': '이메일 인증을 먼저 완료해 주세요.',
    'Password should be at least 6 characters': '비밀번호는 6자 이상이어야 합니다.',
  }
  return messages[message] ?? message
}

export default function App() {
  const [view, setView] = useState<View>('login')
  const [activePage, setActivePage] = useState<AppPage>('home')
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [question, setQuestion] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [submittedQuestion, setSubmittedQuestion] = useState('')
  const [aiAnswer, setAiAnswer] = useState('')
  const [aiError, setAiError] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setReady(true)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const switchView = (next: View) => {
    setView(next)
    setNotice(null)
    setPassword('')
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setNotice(null)

    if (!isSupabaseConfigured) {
      setNotice({ kind: 'error', text: '.env 파일에 Supabase 연결 정보를 입력해 주세요.' })
      return
    }
    if (view === 'signup' && name.trim().length < 2) {
      setNotice({ kind: 'error', text: '이름을 2자 이상 입력해 주세요.' })
      return
    }
    if (password.length < 6) {
      setNotice({ kind: 'error', text: '비밀번호는 6자 이상 입력해 주세요.' })
      return
    }

    setLoading(true)
    try {
      if (view === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: name.trim() },
            emailRedirectTo: window.location.origin,
          },
        })
        if (error) throw error
        if (!data.session) {
          setNotice({ kind: 'success', text: '인증 메일을 보냈습니다. 메일의 링크를 눌러 가입을 완료해 주세요.' })
          setPassword('')
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '요청 처리 중 문제가 발생했습니다.'
      setNotice({ kind: 'error', text: getAuthMessage(message) })
    } finally {
      setLoading(false)
    }
  }

  const handleSignOut = async () => {
    setLoading(true)
    await supabase.auth.signOut()
    setLoading(false)
    setEmail('')
    setPassword('')
  }

  const selectFile = (file?: File) => {
    if (!file) return
    if (file.size > 10 * 1024 * 1024) {
      setAiError('파일 크기는 10MB 이하여야 합니다.')
      return
    }
    setAiError('')
    setSelectedFile(file)
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    selectFile(event.target.files?.[0])
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
    selectFile(event.dataTransfer.files?.[0])
  }

  const fileToBase64 = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = () => reject(new Error('파일을 읽을 수 없습니다.'))
    reader.readAsDataURL(file)
  })

  const handleQuestion = async (event: FormEvent) => {
    event.preventDefault()
    if (!question.trim() && !selectedFile) return
    const prompt = question.trim() || `${selectedFile?.name} 파일을 분석해 주세요.`
    setSubmittedQuestion(prompt)
    setAiAnswer('')
    setAiError('')
    setAiLoading(true)

    try {
      const file = selectedFile ? {
        name: selectedFile.name,
        mimeType: selectedFile.type || 'application/octet-stream',
        data: await fileToBase64(selectedFile),
      } : undefined

      const { data, error } = await supabase.functions.invoke<{ answer?: string; error?: string }>('gemini-answer', {
        body: { prompt, file },
      })

      if (error) throw error
      if (!data?.answer) throw new Error(data?.error || 'AI 답변을 받지 못했습니다.')
      setAiAnswer(data.answer)
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'AI 요청 중 문제가 발생했습니다.')
    } finally {
      setAiLoading(false)
    }
  }

  if (!ready) {
    return <main className="center"><LoaderCircle className="spinner" size={28} /></main>
  }

  if (session) {
    const displayName = session.user.user_metadata.full_name || session.user.email?.split('@')[0] || '회원'
    return (
      <div className="app-shell">
        <header className="topbar">
          <a className="brand" href="/">BCD<span>.</span></a>
          <nav className="main-menu" aria-label="주 메뉴">
            <button className={activePage === 'home' ? 'active' : ''} onClick={() => setActivePage('home')}>홈</button>
            <button className={activePage === 'board' ? 'active' : ''} onClick={() => setActivePage('board')}>게시판</button>
            <button title="준비 중인 페이지입니다">대시보드</button>
            <button className={activePage === 'charger-map' ? 'active' : ''} onClick={() => setActivePage('charger-map')}>전국전동휠체어급속충전기 위치</button>
            <button className={activePage === 'my-page' ? 'active' : ''} onClick={() => setActivePage('my-page')}>마이 페이지</button>
          </nav>
          <div className="account-actions">
            <div className="mini-profile"><span>{displayName.slice(0, 1)}</span><div><strong>{displayName}</strong><small>{session.user.email}</small></div></div>
            <button className="icon-button" onClick={handleSignOut} disabled={loading} aria-label="로그아웃" title="로그아웃"><LogOut size={18} /></button>
          </div>
        </header>

        {activePage === 'board' ? <Board user={session.user} /> : activePage === 'charger-map' ? <Suspense fallback={<main className="center"><LoaderCircle className="spinner" size={28} /></main>}><WheelchairChargerMap /></Suspense> : activePage === 'my-page' ? <MyPage user={session.user} /> : <main className="home-page">
          <section className="ask-panel">
            <div className="ask-content">
              <p className="eyebrow">WELCOME HOME</p>
              <h1>{displayName}님,<br />무엇을 도와드릴까요?</h1>
              <p className="ask-lead">AI에게 무엇을 요청할까요?</p>

              <form className="question-form" onSubmit={handleQuestion}>
                <textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="궁금한 내용이나 해결하고 싶은 문제를 입력해 주세요." rows={5} />

                <div
                  className={`upload-zone ${isDragging ? 'dragging' : ''}`}
                  onDragEnter={(event) => { event.preventDefault(); setIsDragging(true) }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') fileInputRef.current?.click() }}
                >
                  <input ref={fileInputRef} type="file" accept="image/*,audio/*,video/*,application/pdf,text/plain" onChange={handleFileChange} hidden />
                  {selectedFile ? (
                    <div className="selected-file"><div className="file-icon"><FileText size={21} /></div><div><strong>{selectedFile.name}</strong><span>{(selectedFile.size / 1024).toFixed(1)} KB</span></div><button type="button" onClick={(event) => { event.stopPropagation(); setSelectedFile(null) }} aria-label="첨부 파일 삭제"><X size={17} /></button></div>
                  ) : (
                    <><div className="upload-icon"><Paperclip size={21} /></div><div><strong>파일을 여기에 끌어다 놓으세요</strong><span>이미지, PDF, 텍스트, 오디오, 비디오 · 최대 10MB</span></div></>
                  )}
                </div>

                {aiError && <div className="notice error" role="alert">{aiError}</div>}
                <button className="ask-button" type="submit" disabled={aiLoading || (!question.trim() && !selectedFile)}>{aiLoading ? <><LoaderCircle className="spinner" size={18} /> 답변 생성 중...</> : <>질문하기 <Send size={18} /></>}</button>
              </form>
            </div>
          </section>

          <section className="answer-panel">
            <div className="answer-heading"><div className="ai-mark"><Sparkles size={19} /></div><div><p>AI 대답:</p><span>질문에 대한 답변이 여기에 표시됩니다.</span></div></div>
            <div className={`answer-body ${submittedQuestion ? 'has-answer' : ''}`}>
              {aiLoading ? (
                <div className="ai-loading"><LoaderCircle className="spinner" size={28} /><p>Gemini가 답변을 작성하고 있어요.</p><span>파일이 크면 조금 더 걸릴 수 있습니다.</span></div>
              ) : aiAnswer ? (
                <div className="answer-result"><div className="question-recap"><span className="status-dot" /><strong>{submittedQuestion}</strong></div><div className="answer-text">{aiAnswer}</div></div>
              ) : submittedQuestion && aiError ? (
                <div className="answer-placeholder"><span className="status-dot error-dot" /><p><strong>답변을 생성하지 못했습니다.</strong><br />왼쪽의 오류 내용을 확인한 뒤 다시 시도해 주세요.</p></div>
              ) : (
                <div className="empty-answer"><Sparkles size={32} /><p>왼쪽에서 질문을 입력해 주세요.</p><span>AI가 답변을 준비할게요.</span></div>
              )}
            </div>
          </section>
        </main>}
      </div>
    )
  }

  return (
    <main className="auth-page">
      <section className="story-panel">
        <a className="brand brand-light" href="/">BCD<span>.</span></a>
        <div className="story-copy">
          <p className="eyebrow">YOUR NEXT CHAPTER</p>
          <h1>아이디어가<br />현실이 되는 곳.</h1>
          <p>하나의 계정으로 BCD의 모든 경험을 시작하세요.</p>
        </div>
        <div className="trust"><div className="trust-icon"><Check size={17} /></div><div><strong>안전한 계정 보호</strong><span>Supabase 인증으로 데이터를 안전하게 보호합니다.</span></div></div>
        <div className="orb orb-one" /><div className="orb orb-two" />
      </section>

      <section className="form-panel">
        <div className="mobile-brand brand">BCD<span>.</span></div>
        <div className="form-wrap">
          <div className="form-heading">
            <p className="eyebrow">{view === 'login' ? 'WELCOME BACK' : 'JOIN US'}</p>
            <h2>{view === 'login' ? '다시 만나 반가워요.' : '새로운 여정을 시작하세요.'}</h2>
            <p>{view === 'login' ? '계정에 로그인하고 계속 진행하세요.' : '간단한 정보만으로 계정을 만들 수 있어요.'}</p>
          </div>

          <div className="tabs" role="tablist">
            <button className={view === 'login' ? 'active' : ''} onClick={() => switchView('login')}>로그인</button>
            <button className={view === 'signup' ? 'active' : ''} onClick={() => switchView('signup')}>회원가입</button>
          </div>

          <form onSubmit={handleSubmit}>
            {view === 'signup' && <label><span>이름</span><div className="input-box"><UserRound size={19} /><input value={name} onChange={(e) => setName(e.target.value)} placeholder="홍길동" autoComplete="name" required /></div></label>}
            <label><span>이메일</span><div className="input-box"><Mail size={19} /><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" autoComplete="email" required /></div></label>
            <label><span>비밀번호</span><div className="input-box"><LockKeyhole size={19} /><input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="6자 이상 입력해 주세요" autoComplete={view === 'login' ? 'current-password' : 'new-password'} minLength={6} required /><button type="button" className="eye" onClick={() => setShowPassword((value) => !value)} aria-label="비밀번호 보기">{showPassword ? <EyeOff size={19} /> : <Eye size={19} />}</button></div></label>

            {notice && <div className={`notice ${notice.kind}`} role="alert">{notice.text}</div>}
            <button className="primary-button" type="submit" disabled={loading}>{loading ? <LoaderCircle className="spinner" size={20} /> : <>{view === 'login' ? '로그인' : '계정 만들기'}<ArrowRight size={19} /></>}</button>
          </form>

          <p className="switch-copy">{view === 'login' ? '아직 계정이 없으신가요?' : '이미 계정이 있으신가요?'} <button onClick={() => switchView(view === 'login' ? 'signup' : 'login')}>{view === 'login' ? '회원가입' : '로그인'}</button></p>
        </div>
        <p className="footer-copy">© 2026 BCD. All rights reserved.</p>
      </section>
    </main>
  )
}
