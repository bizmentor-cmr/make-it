// Make It — AI provider abstraction over z-ai-web-dev-sdk.
// Single SDK instance, with typed methods for each capability.
// The "AI orchestrator" chooses the cheapest provider/operation that satisfies a task.

import ZAI from "z-ai-web-dev-sdk";

let _zai: Awaited<ReturnType<typeof ZAI.create>> | null = null;

export async function getAI() {
  if (_zai) return _zai;
  _zai = await ZAI.create();
  return _zai;
}

// ── Text (LLM) ──────────────────────────────────────────────
export async function textChat(opts: {
  system?: string;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  model?: string;
  stream?: boolean;
}) {
  const ai = await getAI();
  const messages = opts.system
    ? [{ role: "system" as const, content: opts.system }, ...opts.messages]
    : opts.messages;
  const res = await ai.chat.completions.create({
    model: opts.model,
    messages,
    stream: false,
  });
  // res.choices[0].message.content for OpenAI-compatible shape.
  const content = (res as any)?.choices?.[0]?.message?.content ?? "";
  return { content, raw: res };
}

// ── Vision (VLM) ──────────────────────────────────────────────
export async function visionChat(opts: {
  system?: string;
  prompt: string;
  imageUrl?: string;
  videoUrl?: string;
  fileUrl?: string;
  model?: string;
}) {
  const ai = await getAI();
  const content: any[] = [{ type: "text", text: opts.prompt }];
  if (opts.imageUrl) content.push({ type: "image_url", image_url: { url: opts.imageUrl } });
  if (opts.videoUrl) content.push({ type: "video_url", video_url: { url: opts.videoUrl } });
  if (opts.fileUrl) content.push({ type: "file_url", file_url: { url: opts.fileUrl } });
  const res = await ai.chat.completions.createVision({
    model: opts.model || "glm-4.5v",
    messages: [
      ...(opts.system ? [{ role: "system" as const, content: opts.system }] : []),
      { role: "user" as const, content },
    ],
    stream: false,
  });
  const text = (res as any)?.choices?.[0]?.message?.content ?? "";
  return { content: text, raw: res };
}

// ── Image generation ──────────────────────────────────────
export async function generateImage(opts: {
  prompt: string;
  size?: "1024x1024" | "768x1344" | "864x1152" | "1344x768" | "1152x864" | "1440x720" | "720x1440";
}) {
  const ai = await getAI();
  const res = await ai.images.generations.create({
    prompt: opts.prompt,
    size: opts.size ?? "1024x1024",
  });
  const b64 = res.data?.[0]?.base64 ?? "";
  return { base64: b64, dataUrl: b64 ? `data:image/png;base64,${b64}` : null, raw: res };
}

// ── Image edit ──────────────────────────────────────────────
export async function editImage(opts: {
  prompt: string;
  imageBase64: string;
  size?: "1024x1024" | "768x1344" | "864x1152" | "1344x768" | "1152x864" | "1440x720" | "720x1440";
}) {
  const ai = await getAI();
  const res = await ai.images.generations.edit({
    prompt: opts.prompt,
    image: opts.imageBase64,
    size: opts.size ?? "1024x1024",
  });
  const b64 = res.data?.[0]?.base64 ?? "";
  return { base64: b64, dataUrl: b64 ? `data:image/png;base64,${b64}` : null, raw: res };
}

// ── TTS ──────────────────────────────────────────────
export async function tts(opts: { input: string; voice?: string; speed?: number }) {
  const ai = await getAI();
  const res = await ai.audio.tts.create({
    input: opts.input,
    voice: opts.voice ?? "alloy",
    speed: opts.speed ?? 1,
  });
  return res;
}

// ── ASR (transcription) ──────────────────────────────────────
export async function transcribe(opts: { fileBase64: string }) {
  const ai = await getAI();
  const res = await ai.audio.asr.create({ file_base64: opts.fileBase64 });
  return res;
}

// ── Video generation ──────────────────────────────────────
export async function generateVideo(opts: { prompt?: string; imageUrl?: string | string[]; duration?: number; withAudio?: boolean }) {
  const ai = await getAI();
  const res = await ai.video.generations.create({
    prompt: opts.prompt,
    image_url: opts.imageUrl,
    duration: opts.duration,
    with_audio: opts.withAudio ?? true,
    quality: "quality",
  });
  return res as { id: string; task_status: string };
}

export async function pollVideo(taskId: string) {
  const ai = await getAI();
  return (await ai.async.result.query(taskId)) as any;
}

// ── Web search / page reader (functions) ──────────────────────────────
export async function webSearch(query: string, num = 8) {
  const ai = await getAI();
  return ai.functions.invoke("web_search", { query, num });
}

export async function readPage(url: string) {
  const ai = await getAI();
  return ai.functions.invoke("page_reader", { url });
}
