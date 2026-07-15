const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type RequestBody = {
  prompt?: string
  file?: {
    name?: string
    mimeType?: string
    data?: string
  }
}

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> }
    finishReason?: string
  }>
  promptFeedback?: { blockReason?: string }
  error?: { message?: string }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'POST 요청만 허용됩니다.' }, 405)

  try {
    const apiKey = Deno.env.get('GEMINI_API_KEY')
    if (!apiKey) return json({ error: '서버에 GEMINI_API_KEY가 설정되지 않았습니다.' }, 500)

    const { prompt, file } = await request.json() as RequestBody
    const cleanPrompt = prompt?.trim()
    if (!cleanPrompt && !file?.data) return json({ error: '질문 또는 파일을 입력해 주세요.' }, 400)

    const parts: Array<Record<string, unknown>> = []
    if (file?.data) {
      if (!file.mimeType) return json({ error: '파일 형식을 확인할 수 없습니다.' }, 400)
      parts.push({ inlineData: { mimeType: file.mimeType, data: file.data } })
    }
    parts.push({ text: cleanPrompt || `${file?.name ?? '첨부 파일'}의 내용을 분석해 주세요.` })

    const geminiResponse = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          systemInstruction: {
            parts: [{ text: '당신은 정확하고 친절한 한국어 AI 어시스턴트입니다. 사용자의 질문에 명확하고 실용적으로 답변하세요.' }],
          },
          generationConfig: { temperature: 0.7, maxOutputTokens: 8192 },
        }),
      },
    )

    const result = await geminiResponse.json() as GeminiResponse
    if (!geminiResponse.ok) {
      console.error('Gemini API error:', result.error?.message)
      return json({ error: result.error?.message || 'Gemini API 요청에 실패했습니다.' }, geminiResponse.status)
    }

    const answer = result.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('')
      .trim()

    if (!answer) {
      const reason = result.promptFeedback?.blockReason || result.candidates?.[0]?.finishReason
      return json({ error: reason ? `답변이 생성되지 않았습니다: ${reason}` : 'Gemini가 빈 답변을 반환했습니다.' }, 422)
    }

    return json({ answer })
  } catch (error) {
    console.error('gemini-answer error:', error)
    return json({ error: error instanceof Error ? error.message : '서버 오류가 발생했습니다.' }, 500)
  }
})
