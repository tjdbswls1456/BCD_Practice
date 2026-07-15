import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { ArrowLeft, ChevronLeft, ChevronRight, Download, Eye, FilePlus2, FileText, Heart, LoaderCircle, LockKeyhole, Paperclip, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import './Board.css'

const PAGE_SIZE = 10
const PAGE_BUTTONS = 5
const MAX_FILES = 5
const MAX_FILE_SIZE = 10 * 1024 * 1024
const MAX_TOTAL_SIZE = 30 * 1024 * 1024

type BoardView = 'list' | 'write' | 'detail'
type SearchField = 'title' | 'author_name'

type Attachment = {
  id: string
  post_id: number
  original_name: string
  storage_path: string
  mime_type: string | null
  file_size: number
  created_at: string
}

type Post = {
  id: number
  author_id: string
  author_name: string
  title: string
  content: string
  is_secret: boolean
  view_count: number
  created_at: string
  updated_at: string
  post_attachments?: Attachment[]
  post_likes?: Array<{ count?: number; user_id?: string }>
}

type EditorValues = {
  title: string
  password: string
  content: string
  isSecret: boolean
  files: File[]
  removedAttachments: Attachment[]
}

const formatDate = (value: string, withTime = false) => new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric', month: '2-digit', day: '2-digit',
  ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
}).format(new Date(value))

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const getLikeCount = (post: Post) => post.post_likes?.[0]?.count ?? 0

const getErrorMessage = (error: unknown) => {
  if (typeof error === 'object' && error && 'message' in error) return String(error.message)
  return '요청 처리 중 문제가 발생했습니다.'
}

const safeFileName = (name: string) => name.normalize('NFC').replace(/[^a-zA-Z0-9가-힣._-]/g, '_')

async function uploadAttachments(userId: string, postId: number, files: File[]) {
  const uploadedPaths: string[] = []
  try {
    for (const file of files) {
      const path = `${userId}/${postId}/${crypto.randomUUID()}-${safeFileName(file.name)}`
      const { error: uploadError } = await supabase.storage.from('post-files').upload(path, file, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      })
      if (uploadError) throw uploadError
      uploadedPaths.push(path)

      const { error: metadataError } = await supabase.from('post_attachments').insert({
        post_id: postId,
        uploader_id: userId,
        original_name: file.name,
        storage_path: path,
        mime_type: file.type || null,
        file_size: file.size,
      })
      if (metadataError) throw metadataError
    }
  } catch (error) {
    if (uploadedPaths.length) await supabase.storage.from('post-files').remove(uploadedPaths)
    throw error
  }
}

function PostEditor({
  mode,
  post,
  busy,
  onCancel,
  onSave,
}: {
  mode: 'create' | 'edit'
  post?: Post
  busy: boolean
  onCancel: () => void
  onSave: (values: EditorValues) => Promise<void>
}) {
  const [title, setTitle] = useState(post?.title ?? '')
  const [password, setPassword] = useState('')
  const [content, setContent] = useState(post?.content ?? '')
  const [isSecret, setIsSecret] = useState(post?.is_secret ?? false)
  const [files, setFiles] = useState<File[]>([])
  const [removedAttachments, setRemovedAttachments] = useState<Attachment[]>([])
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const existingAttachments = (post?.post_attachments ?? []).filter(
    (attachment) => !removedAttachments.some((removed) => removed.id === attachment.id),
  )
  const totalSize = existingAttachments.reduce((sum, file) => sum + file.file_size, 0)
    + files.reduce((sum, file) => sum + file.size, 0)

  const addFiles = (incoming: File[]) => {
    setError('')
    const uniqueFiles = incoming.filter((file) => !files.some(
      (selected) => selected.name === file.name && selected.size === file.size,
    ))
    if (existingAttachments.length + files.length + uniqueFiles.length > MAX_FILES) {
      setError(`첨부 파일은 게시글당 최대 ${MAX_FILES}개까지 가능합니다.`)
      return
    }
    if (uniqueFiles.some((file) => file.size > MAX_FILE_SIZE)) {
      setError('파일 하나의 크기는 최대 10MB입니다.')
      return
    }
    const nextTotal = totalSize + uniqueFiles.reduce((sum, file) => sum + file.size, 0)
    if (nextTotal > MAX_TOTAL_SIZE) {
      setError('첨부 파일 전체 크기는 최대 30MB입니다.')
      return
    }
    setFiles((current) => [...current, ...uniqueFiles])
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(event.target.files ?? []))
    event.target.value = ''
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (title.trim().length < 1 || title.trim().length > 200) return setError('제목은 1자 이상 200자 이하로 입력해 주세요.')
    if (!content.trim()) return setError('내용을 입력해 주세요.')
    if (password.length < 4) return setError('게시글 비밀번호를 4자 이상 입력해 주세요.')
    try {
      await onSave({ title: title.trim(), password, content, isSecret, files, removedAttachments })
    } catch (saveError) {
      setError(getErrorMessage(saveError))
    }
  }

  return (
    <section className="board-card editor-card">
      <div className="board-section-heading">
        <div><p className="eyebrow">{mode === 'create' ? 'NEW POST' : 'EDIT POST'}</p><h1>{mode === 'create' ? '새 글 작성' : '게시글 수정'}</h1></div>
        <button className="board-text-button" type="button" onClick={onCancel}><ArrowLeft size={17} /> 취소</button>
      </div>

      <form className="post-editor" onSubmit={handleSubmit}>
        <label><span>제목 <b>*</b></span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} placeholder="제목을 입력해 주세요" /></label>
        <label><span>게시글 비밀번호 <b>*</b></span><div className="board-password-input"><LockKeyhole size={18} /><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={4} maxLength={100} placeholder={mode === 'create' ? '수정·삭제 시 사용할 비밀번호 (4자 이상)' : '수정하려면 기존 게시글 비밀번호를 입력하세요'} /></div></label>
        <label><span>내용 <b>*</b></span><textarea value={content} onChange={(event) => setContent(event.target.value)} rows={14} placeholder="내용을 입력해 주세요" /></label>

        <div className="board-file-field">
          <div className="board-label-row"><span>첨부 파일</span><small>{existingAttachments.length + files.length}/{MAX_FILES}개 · {formatBytes(totalSize)}/30MB</small></div>
          <input ref={fileInputRef} type="file" multiple onChange={handleFileChange} hidden />
          <button className="board-file-picker" type="button" onClick={() => fileInputRef.current?.click()}><FilePlus2 size={20} /><span><strong>여러 파일 선택</strong><small>파일당 10MB, 게시글당 5개·총 30MB까지</small></span></button>
          {(existingAttachments.length > 0 || files.length > 0) && <div className="board-file-list">
            {existingAttachments.map((file) => <div key={file.id}><FileText size={17} /><span><strong>{file.original_name}</strong><small>{formatBytes(file.file_size)} · 기존 파일</small></span><button type="button" onClick={() => setRemovedAttachments((current) => [...current, file])} aria-label="첨부 파일 삭제"><X size={16} /></button></div>)}
            {files.map((file, index) => <div key={`${file.name}-${file.size}`}><FileText size={17} /><span><strong>{file.name}</strong><small>{formatBytes(file.size)} · 새 파일</small></span><button type="button" onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label="선택 파일 삭제"><X size={16} /></button></div>)}
          </div>}
        </div>

        <label className="secret-check"><input type="checkbox" checked={isSecret} onChange={(event) => setIsSecret(event.target.checked)} /><span><LockKeyhole size={16} /> 비밀글로 작성</span><small>비밀글은 작성자 본인에게만 표시됩니다.</small></label>
        {error && <div className="notice error" role="alert">{error}</div>}
        <div className="editor-actions"><button type="button" className="board-secondary-button" onClick={onCancel}>취소</button><button type="submit" className="board-primary-button" disabled={busy}>{busy ? <LoaderCircle className="spinner" size={18} /> : mode === 'create' ? <Plus size={18} /> : <Pencil size={17} />}{busy ? '저장 중...' : mode === 'create' ? '등록하기' : '수정 완료'}</button></div>
      </form>
    </section>
  )
}

export default function Board({ user }: { user: User }) {
  const [view, setView] = useState<BoardView>('list')
  const [posts, setPosts] = useState<Post[]>([])
  const [selectedPost, setSelectedPost] = useState<Post | null>(null)
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [searchField, setSearchField] = useState<SearchField>('title')
  const [searchInput, setSearchInput] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [deleteMode, setDeleteMode] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const pageNumbers = useMemo(() => {
    const start = Math.floor((page - 1) / PAGE_BUTTONS) * PAGE_BUTTONS + 1
    return Array.from({ length: Math.min(PAGE_BUTTONS, totalPages - start + 1) }, (_, index) => start + index)
  }, [page, totalPages])

  const fetchPosts = useCallback(async () => {
    setLoading(true)
    setError('')
    let query = supabase
      .from('posts')
      .select('id, author_id, author_name, title, content, is_secret, view_count, created_at, updated_at, post_likes(count)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)

    if (searchTerm) query = query.ilike(searchField, `%${searchTerm}%`)
    const { data, count, error: queryError } = await query
    if (queryError) setError(queryError.message)
    else {
      setPosts((data ?? []) as Post[])
      setTotalCount(count ?? 0)
    }
    setLoading(false)
  }, [page, searchField, searchTerm])

  useEffect(() => { if (view === 'list') void fetchPosts() }, [fetchPosts, refreshKey, view])

  const openDetail = async (postId: number, incrementView = false) => {
    setLoading(true)
    setError('')
    let viewCountError = ''
    if (incrementView) {
      const { error: incrementError } = await supabase.rpc('increment_post_view', { target_post_id: postId })
      if (incrementError) viewCountError = `조회수를 반영하지 못했습니다: ${incrementError.message}`
    }
    const { data, error: detailError } = await supabase
      .from('posts')
      .select('id, author_id, author_name, title, content, is_secret, view_count, created_at, updated_at, post_attachments(*), post_likes(user_id)')
      .eq('id', postId)
      .single()
    if (detailError) setError(detailError.message)
    else {
      setSelectedPost(data as Post)
      setError(viewCountError)
      setView('detail')
      setEditing(false)
      setDeleteMode(false)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
    setLoading(false)
  }

  const handleSearch = (event: FormEvent) => {
    event.preventDefault()
    setPage(1)
    setSearchTerm(searchInput.trim())
  }

  const handleCreate = async (values: EditorValues) => {
    setBusy(true)
    try {
      const { data, error: createError } = await supabase.rpc('create_post', {
        post_title: values.title,
        post_password: values.password,
        post_content: values.content,
        post_is_secret: values.isSecret,
      })
      if (createError) throw createError
      const postId = Number(data)
      try {
        if (values.files.length) await uploadAttachments(user.id, postId, values.files)
      } catch (uploadError) {
        await supabase.rpc('delete_post', { target_post_id: postId, post_password: values.password })
        throw uploadError
      }
      setView('list')
      setPage(1)
      setRefreshKey((value) => value + 1)
    } finally {
      setBusy(false)
    }
  }

  const handleUpdate = async (values: EditorValues) => {
    if (!selectedPost) return
    setBusy(true)
    try {
      const { error: updateError } = await supabase.rpc('update_post', {
        target_post_id: selectedPost.id,
        post_password: values.password,
        post_title: values.title,
        post_content: values.content,
        post_is_secret: values.isSecret,
      })
      if (updateError) throw updateError

      for (const attachment of values.removedAttachments) {
        const { error: storageError } = await supabase.storage.from('post-files').remove([attachment.storage_path])
        if (storageError) throw storageError
        const { error: metadataError } = await supabase.from('post_attachments').delete().eq('id', attachment.id)
        if (metadataError) throw metadataError
      }
      if (values.files.length) await uploadAttachments(user.id, selectedPost.id, values.files)
      await openDetail(selectedPost.id)
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedPost || deletePassword.length < 4) return setError('게시글 비밀번호를 입력해 주세요.')
    setBusy(true)
    setError('')
    const attachmentPaths = selectedPost.post_attachments?.map((file) => file.storage_path) ?? []
    const { error: deleteError } = await supabase.rpc('delete_post', {
      target_post_id: selectedPost.id,
      post_password: deletePassword,
    })
    if (deleteError) setError(deleteError.message)
    else {
      if (attachmentPaths.length) await supabase.storage.from('post-files').remove(attachmentPaths)
      setSelectedPost(null)
      setView('list')
      setDeletePassword('')
      setRefreshKey((value) => value + 1)
    }
    setBusy(false)
  }

  const toggleLike = async () => {
    if (!selectedPost) return
    const liked = selectedPost.post_likes?.some((like) => like.user_id === user.id)
    setBusy(true)
    const result = liked
      ? await supabase.from('post_likes').delete().eq('post_id', selectedPost.id).eq('user_id', user.id)
      : await supabase.from('post_likes').insert({ post_id: selectedPost.id, user_id: user.id })
    if (result.error) setError(result.error.message)
    else await openDetail(selectedPost.id)
    setBusy(false)
  }

  const downloadFile = async (attachment: Attachment) => {
    const { data, error: signedUrlError } = await supabase.storage.from('post-files').createSignedUrl(attachment.storage_path, 60, { download: attachment.original_name })
    if (signedUrlError) setError(signedUrlError.message)
    else window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  if (view === 'write') return <main className="board-page"><PostEditor mode="create" busy={busy} onCancel={() => setView('list')} onSave={handleCreate} /></main>

  if (view === 'detail' && selectedPost) {
    if (editing) return <main className="board-page"><PostEditor mode="edit" post={selectedPost} busy={busy} onCancel={() => setEditing(false)} onSave={handleUpdate} /></main>
    const isAuthor = selectedPost.author_id === user.id
    const liked = selectedPost.post_likes?.some((like) => like.user_id === user.id) ?? false
    return <main className="board-page">
      <section className="board-card detail-card">
        <button className="board-text-button back-button" onClick={() => { setView('list'); setError('') }}><ArrowLeft size={17} /> 목록으로</button>
        <div className="detail-title-row"><div>{selectedPost.is_secret && <span className="secret-badge"><LockKeyhole size={13} /> 비밀글</span>}<h1>{selectedPost.title}</h1></div>{isAuthor && <div className="owner-actions"><button onClick={() => { setEditing(true); setError('') }}><Pencil size={15} /> 수정</button><button className="danger" onClick={() => setDeleteMode((value) => !value)}><Trash2 size={15} /> 삭제</button></div>}</div>
        <div className="post-meta"><span>{selectedPost.author_name}</span><span>{formatDate(selectedPost.created_at, true)}</span><span className="view-meta"><Eye size={13} /> 조회 {selectedPost.view_count.toLocaleString()}</span></div>
        <article className="post-content">{selectedPost.content}</article>
        {(selectedPost.post_attachments?.length ?? 0) > 0 && <div className="detail-files"><h2><Paperclip size={16} /> 첨부 파일 <span>{selectedPost.post_attachments?.length}</span></h2>{selectedPost.post_attachments?.map((file) => <button key={file.id} onClick={() => void downloadFile(file)}><FileText size={18} /><span><strong>{file.original_name}</strong><small>{formatBytes(file.file_size)}</small></span><Download size={16} /></button>)}</div>}
        <div className="detail-footer"><button className={`like-button ${liked ? 'liked' : ''}`} onClick={() => void toggleLike()} disabled={busy}><Heart size={18} fill={liked ? 'currentColor' : 'none'} /> {liked ? '좋아요 취소' : '좋아요'}</button></div>
        {deleteMode && <form className="delete-confirm" onSubmit={handleDelete}><div><strong>게시글을 삭제할까요?</strong><span>삭제 후에는 복구할 수 없습니다. 게시글 비밀번호를 입력해 주세요.</span></div><input type="password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} placeholder="게시글 비밀번호" autoFocus /><button type="submit" disabled={busy}>{busy ? <LoaderCircle className="spinner" size={16} /> : <Trash2 size={16} />} 삭제</button><button type="button" onClick={() => { setDeleteMode(false); setDeletePassword('') }}>취소</button></form>}
        {error && <div className="notice error board-notice">{error}</div>}
      </section>
    </main>
  }

  return <main className="board-page">
    <section className="board-card list-card">
      <div className="board-section-heading"><div><p className="eyebrow">COMMUNITY</p><h1>게시판</h1><span>자유롭게 이야기를 나누고 파일을 공유해 보세요.</span></div><button className="board-primary-button" onClick={() => setView('write')}><Plus size={18} /> 글쓰기</button></div>
      <form className="board-search" onSubmit={handleSearch}><select value={searchField} onChange={(event) => setSearchField(event.target.value as SearchField)}><option value="title">제목</option><option value="author_name">작성자</option></select><div><Search size={18} /><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="검색어를 입력해 주세요" /></div><button type="submit">검색</button></form>
      {error && <div className="notice error board-notice">{error}</div>}
      <div className="board-table-wrap"><table className="board-table"><thead><tr><th>번호</th><th>제목</th><th>작성자</th><th>조회수</th><th>좋아요</th><th>작성일</th></tr></thead><tbody>
        {loading ? <tr><td colSpan={6}><div className="table-state"><LoaderCircle className="spinner" size={24} /> 게시글을 불러오는 중...</div></td></tr>
          : posts.length === 0 ? <tr><td colSpan={6}><div className="table-state">등록된 게시글이 없습니다.</div></td></tr>
            : posts.map((post, index) => <tr key={post.id}><td>{totalCount - (page - 1) * PAGE_SIZE - index}</td><td><button className="post-title-button" onClick={() => void openDetail(post.id, true)}>{post.is_secret && <LockKeyhole size={14} />}<span>{post.title}</span>{post.author_id === user.id && <em>내 글</em>}</button></td><td>{post.author_name}</td><td><Eye size={14} /> {post.view_count.toLocaleString()}</td><td><Heart size={14} /> {getLikeCount(post)}</td><td>{formatDate(post.created_at)}</td></tr>)}
      </tbody></table></div>
      <div className="pagination" aria-label="게시글 페이지"><button onClick={() => setPage(1)} disabled={page === 1} aria-label="첫 페이지">&lt;&lt;</button><button onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1} aria-label="이전 페이지"><ChevronLeft size={16} /></button>{pageNumbers.map((number) => <button key={number} className={page === number ? 'active' : ''} onClick={() => setPage(number)}>{number}</button>)}<button onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page === totalPages} aria-label="다음 페이지"><ChevronRight size={16} /></button><button onClick={() => setPage(totalPages)} disabled={page === totalPages} aria-label="마지막 페이지">&gt;&gt;</button></div>
    </section>
  </main>
}
