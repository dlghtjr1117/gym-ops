// Supabase Edge Function: "transcribe-summarize"
//
// 이 파일을 Supabase 대시보드 > Edge Functions > "Deploy a new function" > "Via Editor"에서
// 새 함수를 만들고(이름: transcribe-summarize) 이 코드를 그대로 붙여넣은 뒤 "Deploy function"을
// 누르면 배포됩니다. 터미널/CLI 설치 없이 브라우저에서 전부 할 수 있어요.
//
// 이 함수가 하는 일:
// 1) 브라우저(meetings.html)에서 녹음한 음성 파일을 받음
// 2) OpenAI Whisper(음성인식)로 텍스트로 변환(전사)
// 3) 그 텍스트를 다시 OpenAI에게 보내서 회의록 형식으로 요약
// 4) { transcript, summary } 를 JSON으로 돌려줌
//
// 반드시 필요한 설정: Supabase 대시보드 > Edge Functions > Secrets 에서
// OPENAI_API_KEY 라는 이름으로 OpenAI API 키를 저장해둬야 합니다 (README/설정 안내 문서 참고).

Deno.serve(async (req: Request) => {
  // 브라우저에서 바로 호출하기 때문에 CORS 프리플라이트(OPTIONS) 요청을 허용해줘야 함
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: 'OPENAI_API_KEY가 설정되어 있지 않습니다. Supabase 대시보드 Edge Functions > Secrets에서 등록해주세요.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 브라우저가 multipart/form-data로 "audio" 필드에 녹음 파일을 담아서 보냄
    const incomingForm = await req.formData();
    const audioFile = incomingForm.get('audio');
    if (!audioFile || !(audioFile instanceof File)) {
      return new Response(JSON.stringify({ error: '오디오 파일(audio)이 없습니다.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ---- 1) 음성 -> 텍스트 (전사) ----
    const whisperForm = new FormData();
    whisperForm.append('file', audioFile, audioFile.name || 'recording.webm');
    whisperForm.append('model', 'gpt-4o-transcribe'); // 한국어 인식 품질이 좋은 최신 모델. 문제가 있으면 'whisper-1'로 바꿔도 됨
    whisperForm.append('language', 'ko');

    const transcribeRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: whisperForm,
    });
    if (!transcribeRes.ok) {
      const errText = await transcribeRes.text();
      return new Response(JSON.stringify({ error: `음성 인식 실패: ${errText}` }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const transcribeData = await transcribeRes.json();
    const transcript: string = transcribeData.text || '';

    if (!transcript.trim()) {
      return new Response(JSON.stringify({ transcript: '', summary: '(인식된 음성이 없습니다)' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ---- 2) 텍스트 -> 회의록 요약 ----
    const summaryRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: '너는 헬스장 직원 회의를 정리해주는 비서야. 아래 회의 전사 내용을 한국어로 간결하게 정리해줘. ' +
              '형식은 반드시 다음과 같이: "■ 핵심 내용" 줄바꿈 후 불릿(-)으로 요약, 빈 줄, "■ 결정 사항" 불릿 목록, 빈 줄, "■ 할 일(액션 아이템)" 불릿 목록(담당자가 언급되면 같이 적기). ' +
              '내용이 없는 항목은 "- 없음"이라고 적어. 원문에 없는 내용을 지어내지 마.'
          },
          { role: 'user', content: transcript }
        ],
        temperature: 0.3,
      }),
    });
    if (!summaryRes.ok) {
      const errText = await summaryRes.text();
      // 전사는 성공했으니, 요약만 실패해도 전사 텍스트는 돌려줌 (화면에서 사용자가 직접 요약해도 되도록)
      return new Response(JSON.stringify({ transcript, summary: '', warning: `요약 실패: ${errText}` }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const summaryData = await summaryRes.json();
    const summary: string = summaryData.choices?.[0]?.message?.content || '';

    return new Response(JSON.stringify({ transcript, summary }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
