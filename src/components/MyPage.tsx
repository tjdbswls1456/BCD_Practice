import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { CalendarDays, ChevronLeft, ChevronRight, Eye, FileText, Heart, LoaderCircle, LockKeyhole, Search } from 'lucide-react'
import { supabase } from '../lib/supabase'
import './MyPage.css'

const PAGE_SIZE = 5
const PAGE_BUTTONS = 5

type SecretPost = {
  id: number
  title: string
  view_count: number
  created_at: string
  post_likes?: Array<{ count?: number }>
}

type KpiValues = {
  likes: number
  secretPosts: number
  posts: number
  monthlyPosts: number
}

const formatDate = (value: string) => new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(value))

const getLikeCount = (post: SecretPost) => post.post_likes?.[0]?.count ?? 0

export default function MyPage({ user }: { user: User }) {
  const [kpis, setKpis] = useState<KpiValues>({ likes: 0, secretPosts: 0, posts: 0, monthlyPosts: 0 })
  const [secretPosts, setSecretPosts] = useState<SecretPost[]>([])
  const [searchInput, setSearchInput] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [statsLoading, setStatsLoading] = useState(true)
  const [listLoading, setListLoading] = useState(true)
  const [error, setError] = useState('')

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const pageNumbers = useMemo(() => {
    const start = Math.floor((page - 1) / PAGE_BUTTONS) * PAGE_BUTTONS + 1
    return Array.from({ length: Math.min(PAGE_BUTTONS, totalPages - start + 1) }, (_, index) => start + index)
  }, [page, totalPages])

  useEffect(() => {
    const fetchKpis = async () => {
      setStatsLoading(true)
      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
      const [likesResult, secretResult, postsResult, monthlyResult] = await Promise.all([
        supabase.from('post_likes').select('post_id', { count: 'exact', head: true }).eq('user_id', user.id),
        supabase.from('posts').select('id', { count: 'exact', head: true }).eq('author_id', user.id).eq('is_secret', true),
        supabase.from('posts').select('id', { count: 'exact', head: true }).eq('author_id', user.id),
        supabase.from('posts').select('id', { count: 'exact', head: true }).eq('author_id', user.id).gte('created_at', monthStart),
      ])
      const firstError = likesResult.error ?? secretResult.error ?? postsResult.error ?? monthlyResult.error
      if (firstError) setError(firstError.message)
      else setKpis({
        likes: likesResult.count ?? 0,
        secretPosts: secretResult.count ?? 0,
        posts: postsResult.count ?? 0,
        monthlyPosts: monthlyResult.count ?? 0,
      })
      setStatsLoading(false)
    }
    void fetchKpis()
  }, [user.id])

  const fetchSecretPosts = useCallback(async () => {
    setListLoading(true)
    setError('')
    let query = supabase
      .from('posts')
      .select('id, title, view_count, created_at, post_likes(count)', { count: 'exact' })
      .eq('author_id', user.id)
      .eq('is_secret', true)
      .order('created_at', { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
    if (searchTerm) query = query.ilike('title', `%${searchTerm}%`)
    const { data, count, error: queryError } = await query
    if (queryError) setError(queryError.message)
    else {
      setSecretPosts((data ?? []) as SecretPost[])
      setTotalCount(count ?? 0)
    }
    setListLoading(false)
  }, [page, searchTerm, user.id])

  useEffect(() => { void fetchSecretPosts() }, [fetchSecretPosts])

  const handleSearch = (event: FormEvent) => {
    event.preventDefault()
    setPage(1)
    setSearchTerm(searchInput.trim())
  }

  const displayName = user.user_metadata.full_name || user.email?.split('@')[0] || '회원'
  const cards = [
    { label: '좋아요', value: kpis.likes, icon: Heart, tone: 'rose' },
    { label: '비밀글', value: kpis.secretPosts, icon: LockKeyhole, tone: 'gold' },
    { label: '게시글', value: kpis.posts, icon: FileText, tone: 'green' },
    { label: '이번 달에 작성한 글', value: kpis.monthlyPosts, icon: CalendarDays, tone: 'blue' },
  ]

  return (
    <main className="mypage-page">
      <section className="mypage-summary">
        <div className="mypage-heading"><div><p className="eyebrow">MY ACTIVITY</p><h1>{displayName}님의 마이 페이지</h1></div><span>나의 게시판 활동을 한눈에 확인하세요.</span></div>
        <div className="kpi-grid">
          {cards.map(({ label, value, icon: Icon, tone }) => <article className={`kpi-card ${tone}`} key={label}><div className="kpi-icon"><Icon size={20} /></div><div><span>{label}</span>{statsLoading ? <LoaderCircle className="spinner" size={20} /> : <strong>{value.toLocaleString()}<small>건</small></strong>}</div></article>)}
        </div>
      </section>

      <section className="mypage-secrets">
        <div className="secret-list-heading"><div><LockKeyhole size={19} /><h2>나의 비밀글</h2><span>{totalCount.toLocaleString()}건</span></div><p>나에게만 표시되는 게시글입니다.</p></div>
        <form className="mypage-search" onSubmit={handleSearch}><div><Search size={18} /><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="제목으로 검색" /></div><button type="submit">검색</button></form>
        {error && <div className="notice error mypage-notice">{error}</div>}

        <div className="secret-table-wrap"><table className="secret-table"><thead><tr><th>번호</th><th>제목</th><th>조회수</th><th>좋아요</th><th>작성일</th></tr></thead><tbody>
          {listLoading ? <tr><td colSpan={5}><div className="mypage-table-state"><LoaderCircle className="spinner" size={23} /> 비밀글을 불러오는 중...</div></td></tr>
            : secretPosts.length === 0 ? <tr><td colSpan={5}><div className="mypage-table-state">작성한 비밀글이 없습니다.</div></td></tr>
              : secretPosts.map((post, index) => <tr key={post.id}><td>{totalCount - (page - 1) * PAGE_SIZE - index}</td><td><span className="my-secret-title"><LockKeyhole size={13} />{post.title}</span></td><td><Eye size={13} /> {post.view_count.toLocaleString()}</td><td><Heart size={13} /> {getLikeCount(post).toLocaleString()}</td><td>{formatDate(post.created_at)}</td></tr>)}
        </tbody></table></div>

        <div className="mypage-pagination" aria-label="비밀글 페이지"><button onClick={() => setPage(1)} disabled={page === 1} aria-label="첫 페이지">&lt;&lt;</button><button onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1} aria-label="이전 페이지"><ChevronLeft size={16} /></button>{pageNumbers.map((number) => <button key={number} className={page === number ? 'active' : ''} onClick={() => setPage(number)}>{number}</button>)}<button onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page === totalPages} aria-label="다음 페이지"><ChevronRight size={16} /></button><button onClick={() => setPage(totalPages)} disabled={page === totalPages} aria-label="마지막 페이지">&gt;&gt;</button></div>
      </section>
    </main>
  )
}
