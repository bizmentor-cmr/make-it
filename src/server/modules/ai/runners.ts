// Make It — AI job runners registry (THE central runners file).
// Importing this module registers ALL 11 job runners as a side effect.
// Each runner uses the `log` / `progress` callbacks, calls the appropriate
// `@/server/core/ai` method, loads + renders the relevant prompt template via
// `getPrompt` + `renderTemplate`, parses JSON outputs leniently (strip ```json fences,
// try/parse, fallback to plain text), and returns `{output, consumedCredits}`.
//
// ── ANTI-WASTE ENGINE ──────────────────────────────────────────────────────
// Before generating, every runner checks the ContentCache to see whether a reusable
// resource already exists for the same inputs. Concretely:
//   - style_analysis: skip the vision pass if the source URL/asset was already analysed.
//   - message_analysis: cache intent/sentiment for the same message hash.
//   - image_generation (style_recreate): cache the rendered image for the same prompt+brief
//     and serve it instead of re-generating (a re-crop / re-caption is cheaper than a regen).
//   - transcription: cache the transcription for the same asset.
// The principle: an adaptation of text should NEVER trigger a visual regen if only the text
// differs; a LinkedIn déclinaison shouldn't regenerate the whole image; an image already
// generated can be re-cropped instead of regenerating. Cache hits are free (no AI call).
// ────────────────────────────────────────────────────────────────────────────

import { db } from "@/lib/db";
import { textChat, visionChat, generateImage, editImage, tts, transcribe, generateVideo, pollVideo } from "@/server/core/ai";
import { registerJobRunner, type JobRunner } from "@/server/core/ai-job";
import { getPrompt, renderTemplate } from "@/server/core/prompts";
import { estimateCost } from "@/server/core/ai-cost";
import { jsonStringify, jsonParse } from "@/server/core/types";
import { logger } from "@/server/core/logger";
import { buildBrandContext, buildPerformanceContext, buildTrendContext, routeTask } from "./orchestrator";
import { cacheKey, getCache, setCache, hit } from "./cache";

// ── Helpers ────────────────────────────────────────────────────────────

// Lenient JSON parse: strip ```json fences, try/parse, fallback to plain text.
function parseLenient<T = unknown>(raw: string): T | string {
  if (!raw) return "";
  let s = raw.trim();
  // strip code fences
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  // find the first balanced { or [ and try to parse from there
  const tryExtract = (start: number) => {
    try {
      const sub = s.slice(start);
      return JSON.parse(sub) as T;
    } catch {
      return null;
    }
  };
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "{" || s[i] === "[") {
      const candidate = tryExtract(i);
      if (candidate !== null) return candidate;
    }
  }
  // Last-ditch: just parse the whole thing
  try {
    return JSON.parse(s) as T;
  } catch {
    return s; // fallback to plain text
  }
}

// Strip markdown to a plain summary used for content storage.
function firstParagraph(s: string): string {
  return s.trim().split(/\n\s*\n/)[0] ?? s.trim();
}

const safeCost = async (operation: string, quantity = 1): Promise<number> => {
  try {
    const c = await estimateCost(operation, quantity);
    return c.estimated;
  } catch {
    return 1;
  }
};

// ── 1. text_generation ─────────────────────────────────────────────────
// Input: { platform, objective, idea, format, brandVoice?, history? }
const textRunner: JobRunner = async ({ id, workspaceId, input, log: logFn, progress }) => {
  await logFn("Démarrage génération de texte", "info", "start");
  await progress(20, "Analyse du brief");
  const i = (input ?? {}) as Record<string, unknown>;
  const platform = (i.platform as string) ?? "instagram";
  const objective = (i.objective as string) ?? "engagement";
  const idea = (i.idea as string) ?? (i.prompt as string) ?? "";
  const format = (i.format as string) ?? "post";

  const tpl = await getPrompt("text_generation", workspaceId);
  const brand = await buildBrandContext(workspaceId);
  // Trend context — when the workspace has trend watches, the AI aligns
  // its suggestions with current hashtags + angles + platforms.
  const trend = await buildTrendContext(workspaceId).catch(() => "(veille indisponible)");
  const user = tpl?.userTemplate
    ? renderTemplate(tpl.userTemplate, { platform, objective, idea, brand_voice: brand, format })
    : `Plateforme : ${platform}\nObjectif : ${objective}\nIdée : ${idea}\nVoix de marque : ${brand}\nFormat : ${format}\nVeille & tendances :\n${trend}`;
  await progress(50, "Génération");
  const res = await textChat({
    system: tpl?.systemPrompt ?? "Tu es un concepteur-rédacteur marketing.",
    messages: [{ role: "user", content: user }],
  });
  await progress(80, "Validation");
  const content = res.content?.trim() ?? "";
  // try to extract structured {hook, body, cta, hashtags}
  const parsed = parseLenient(content);
  let out: Record<string, unknown>;
  if (typeof parsed === "string") {
    out = { text: content, hook: firstParagraph(content), body: content, cta: null, hashtags: [] };
  } else {
    out = { ...(parsed as Record<string, unknown>), text: content };
  }
  await progress(100, "Terminé");
  await logFn("Génération terminée", "info", "done");
  const consumed = await safeCost("text_generation", 1);
  return { output: out, consumedCredits: consumed };
};

// ── 2. image_generation ────────────────────────────────────────────────
// Input: { prompt, size?, brandContext?, format? }
const imageRunner: JobRunner = async ({ id, workspaceId, input, log: logFn, progress }) => {
  await logFn("Démarrage génération d'image", "info", "start");
  const i = (input ?? {}) as Record<string, unknown>;
  const prompt = (i.prompt as string) ?? "";
  const size = (i.size as "1024x1024" | "768x1344" | "864x1152" | "1344x768" | "1152x864" | "1440x720" | "720x1440") ?? "1024x1024";

  // ANTI-WASTE: serve a cached image for the same prompt+size if present
  const key = cacheKey(["image", workspaceId, prompt, size]);
  const cached = await getCache<{ dataUrl: string; base64: string } | null>(workspaceId, key);
  if (cached && cached.dataUrl) {
    await hit(key);
    await logFn("Image servie depuis le cache anti-gaspillage", "info", "cache-hit");
    await progress(100, "Terminé (cache)");
    return { output: { dataUrl: cached.dataUrl, base64: cached.base64, cached: true }, consumedCredits: 0 };
  }

  await progress(20, "Analyse du brief");
  await progress(50, "Génération");
  const res = await generateImage({ prompt, size });
  if (!res.base64) throw new Error("La génération d'image a échoué (réponse vide)");
  await progress(80, "Validation");
  await setCache(workspaceId, key, "transform", { dataUrl: res.dataUrl, base64: res.base64 });
  await progress(100, "Terminé");
  await logFn("Image générée et mise en cache", "info", "done");
  const consumed = await safeCost("image_generation", 1);
  return { output: { dataUrl: res.dataUrl, base64: res.base64, cached: false }, consumedCredits: consumed };
};

// ── 3. atomize ──────────────────────────────────────────────────────────
// Input: { idea, platforms: string[], objective }
// Creates a parent Content (idea, type text, status idea) + N children (parentContentId=parent).
const atomizeRunner: JobRunner = async ({ id, workspaceId, input, log: logFn, progress }) => {
  await logFn("Démarrage atomisation", "info", "start");
  const i = (input ?? {}) as Record<string, unknown>;
  const idea = (i.idea as string) ?? "";
  const platforms = Array.isArray(i.platforms) ? (i.platforms as string[]) : ["instagram"];
  const objective = (i.objective as string) ?? "engagement";

  await progress(20, "Analyse de l'idée");
  const tpl = await getPrompt("atomize", workspaceId);
  const brand = await buildBrandContext(workspaceId);
  const perf = await buildPerformanceContext(workspaceId);
  const user = tpl?.userTemplate
    ? renderTemplate(tpl.userTemplate, {
        idea,
        platforms: platforms.join(", "),
        brand: `${brand}\n\nPerformance:\n${perf}`,
        objectives: objective,
      })
    : `Idée : ${idea}\nPlateformes : ${platforms.join(", ")}\nMarque : ${brand}\nObjectifs : ${objective}`;
  await progress(50, "Génération des déclinaisons");
  const res = await textChat({
    system: tpl?.systemPrompt ?? "Tu es un expert en déclinaison multicanal.",
    messages: [{ role: "user", content: user }],
  });
  await progress(80, "Validation");
  const parsed = parseLenient<{ variants?: Array<{ platform?: string; format?: string; hook?: string; body?: string; cta?: string; hashtags?: string[] }> }>(res.content ?? "");
  const variants =
    (parsed && typeof parsed !== "string" && Array.isArray(parsed.variants) ? parsed.variants : []) as Array<{
      platform?: string; format?: string; hook?: string; body?: string; cta?: string; hashtags?: string[];
    }>;

  // Map platform → Content type (sensible defaults)
  const platformToType: Record<string, string> = {
    instagram: "post",
    facebook: "post",
    tiktok: "video",
    youtube: "video",
    linkedin: "post",
    google: "post",
    whatsapp: "post",
  };

  // Create parent Content
  const parent = await db.content.create({
    data: {
      workspaceId,
      type: "text",
      title: idea.slice(0, 200) || "Idée atomisée",
      objective,
      status: "idea",
      platforms: jsonStringify(platforms),
      metadata: jsonStringify({ idea, platforms, source: "atomize" }),
      aiGenerated: true,
    },
  });

  // Create children
  const children: Array<Record<string, unknown>> = [];
  for (const v of variants.slice(0, Math.max(1, platforms.length))) {
    const plat = (v.platform ?? platforms[0] ?? "instagram").toLowerCase();
    const type = platformToType[plat] ?? "post";
    const child = await db.content.create({
      data: {
        workspaceId,
        type,
        title: (v.hook ?? idea.slice(0, 100)) as string,
        description: (v.body ?? null) as string | null,
        objective,
        status: "draft",
        parentContentId: parent.id,
        platforms: jsonStringify([plat]),
        metadata: jsonStringify({
          platform: plat,
          format: v.format ?? null,
          hook: v.hook ?? null,
          body: v.body ?? null,
          cta: v.cta ?? null,
          hashtags: Array.isArray(v.hashtags) ? v.hashtags : [],
        }),
        aiGenerated: true,
      },
    });
    children.push({
      id: child.id,
      platform: plat,
      format: v.format ?? null,
      hook: v.hook ?? null,
      body: v.body ?? null,
      cta: v.cta ?? null,
      hashtags: Array.isArray(v.hashtags) ? v.hashtags : [],
    });
  }
  await progress(100, "Terminé");
  await logFn(`Atomisation terminée : ${children.length} déclinaisons`, "info", "done");
  const consumed = await safeCost("atomize", Math.max(1, variants.length));
  return { output: { parentContentId: parent.id, variants: children, count: children.length }, consumedCredits: consumed };
};

// ── 4. adapt ──────────────────────────────────────────────────────────
// Input: { contentId, source, platform, objective?, format? }
const adaptRunner: JobRunner = async ({ id, workspaceId, input, log: logFn, progress }) => {
  await logFn("Démarrage adaptation", "info", "start");
  const i = (input ?? {}) as Record<string, unknown>;
  const contentId = (i.contentId as string) ?? null;
  const source = (i.source as string) ?? "";
  const platform = (i.platform as string) ?? "instagram";
  const objective = (i.objective as string) ?? "engagement";

  await progress(20, "Analyse du contenu source");
  // If a contentId is given, load source content (title+description+metadata)
  let sourceText = source;
  if (contentId) {
    const c = await db.content.findUnique({ where: { id: contentId } });
    if (c && c.workspaceId === workspaceId) {
      const meta = jsonParse<Record<string, unknown>>(c.metadata, {});
      sourceText = [c.title, c.description, JSON.stringify(meta)].filter(Boolean).join("\n");
    }
  }
  if (!sourceText) throw new Error("Contenu source introuvable");

  const platformProfile = await db.platformProfile.findUnique({ where: { platform } });
  const learning = await db.workspacePlatformLearning.findFirst({ where: { workspaceId, platform } });

  const tpl = await getPrompt("adapt", workspaceId);
  const user = tpl?.userTemplate
    ? renderTemplate(tpl.userTemplate, {
        source: sourceText,
        platform,
        platform_dna: platformProfile ? jsonStringify(platformProfile) : "{}",
        workspace_learning: learning ? jsonStringify(learning) : "{}",
      })
    : `Contenu source : ${sourceText}\nPlateforme cible : ${platform}`;
  await progress(50, "Génération de l'adaptation");
  const res = await textChat({
    system: tpl?.systemPrompt ?? "Tu adaptes un contenu à une plateforme cible.",
    messages: [{ role: "user", content: user }],
  });
  await progress(80, "Validation");
  const parsed = parseLenient<{ hook?: string; body?: string; cta?: string; hashtags?: string[]; adaptation_note?: string }>(res.content ?? "");
  let out: Record<string, unknown>;
  if (typeof parsed === "string") {
    out = { text: res.content, hook: res.content, body: res.content, cta: null, hashtags: [], adaptation_note: null };
  } else {
    out = { ...parsed, text: res.content };
  }
  // Store the adapted content as a new Content row (parent = source)
  if (contentId) {
    await db.content.create({
      data: {
        workspaceId,
        type: "text",
        title: String(out.hook ?? sourceText.slice(0, 100)),
        description: String(out.body ?? null),
        objective,
        status: "draft",
        parentContentId: contentId,
        platforms: jsonStringify([platform]),
        metadata: jsonStringify(out),
        aiGenerated: true,
      },
    });
  }
  await progress(100, "Terminé");
  await logFn("Adaptation terminée", "info", "done");
  const consumed = await safeCost("adapt", 1);
  return { output: out, consumedCredits: consumed };
};

// ── 5. calendar_generate ───────────────────────────────────────────────
// Input: { horizon, industry, objective, pillars, frequency, platforms? }
const calendarRunner: JobRunner = async ({ id, workspaceId, input, log: logFn, progress }) => {
  await logFn("Démarrage génération de calendrier", "info", "start");
  const i = (input ?? {}) as Record<string, unknown>;
  const horizon = Math.min(90, Math.max(7, Number(i.horizon ?? 30)));
  const industry = (i.industry as string) ?? "";
  const objective = (i.objective as string) ?? "engagement";
  const pillars = Array.isArray(i.pillars) ? (i.pillars as string[]).join(", ") : (i.pillars as string) ?? "";
  const frequency = (i.frequency as string) ?? "3/semaine";
  const platforms = Array.isArray(i.platforms) ? (i.platforms as string[]) : ["instagram", "tiktok", "facebook"];

  await progress(20, "Analyse du brief");
  const tpl = await getPrompt("calendar_generate", workspaceId);
  const brand = await buildBrandContext(workspaceId);
  const perf = await buildPerformanceContext(workspaceId);
  // Trend context — surfaces top hashtags + top platforms + top angles so the
  // calendar the AI builds is aligned with what's currently performing in the
  // workspace's market. Returns "(aucune veille configurée)" when there's none.
  const trend = await buildTrendContext(workspaceId).catch(() => "(veille indisponible)");
  const country = (i.country as string) ?? "France";
  const user = tpl?.userTemplate
    ? renderTemplate(tpl.userTemplate, {
        horizon: String(horizon),
        industry,
        objective,
        pillars,
        frequency,
        platforms: platforms.join(", "),
        performance: `${brand}\n\nPerformance:\n${perf}\n\nVeille & tendances:\n${trend}`,
        country,
      })
    : `Horizon : ${horizon}\nSecteur : ${industry}\nObjectif : ${objective}\nVeille & tendances :\n${trend}`;
  await progress(50, "Génération du calendrier");
  const res = await textChat({
    system: tpl?.systemPrompt ?? "Tu es un planificateur éditorial.",
    messages: [{ role: "user", content: user }],
  });
  await progress(80, "Validation");
  const parsed = parseLenient<{ items?: Array<{ day?: number; platform?: string; format?: string; title?: string; goal?: string; time?: string }> }>(res.content ?? "");
  const items =
    (parsed && typeof parsed !== "string" && Array.isArray(parsed.items) ? parsed.items : []) as Array<{
      day?: number; platform?: string; format?: string; title?: string; goal?: string; time?: string;
    }>;
  await progress(100, "Terminé");
  await logFn(`Calendrier généré : ${items.length} items`, "info", "done");
  const consumed = await safeCost("calendar_generate", 1);
  return { output: { items, count: items.length, horizon }, consumedCredits: consumed };
};

// ── 6. style_analysis ─────────────────────────────────────────────────
// Input: { sourceType: "image"|"video"|"url", sourceUrl?, assetId? }
// Uses visionChat to extract palette/composition/lighting/typography/...
// Stores StyleReference + StyleDNA. Uses ContentCache to skip re-analysis.
const styleAnalysisRunner: JobRunner = async ({ id, workspaceId, input, log: logFn, progress }) => {
  await logFn("Démarrage analyse de style", "info", "start");
  const i = (input ?? {}) as Record<string, unknown>;
  const sourceType = (i.sourceType as string) ?? "image";
  const sourceUrl = (i.sourceUrl as string) ?? null;
  const assetId = (i.assetId as string) ?? null;

  // Build the source URL for vision. For assetId, resolve to a MediaAsset storagePath → public URL.
  let visionUrl: string | null = sourceUrl;
  if (assetId && !visionUrl) {
    const asset = await db.mediaAsset.findUnique({ where: { id: assetId } });
    if (asset && asset.workspaceId === workspaceId) visionUrl = asset.storagePath;
  }
  if (!visionUrl) throw new Error("Aucune source fournie pour l'analyse de style");

  // ANTI-WASTE: cache by workspace + sourceType + url
  const key = cacheKey(["style_dna", workspaceId, sourceType, visionUrl]);
  const cached = await getCache<{ styleDNAId: string; summary: string } | null>(workspaceId, key);
  if (cached && cached.styleDNAId) {
    await hit(key);
    await logFn("Style DNA servi depuis le cache", "info", "cache-hit");
    await progress(100, "Terminé (cache)");
    return { output: { ...cached, cached: true }, consumedCredits: 0 };
  }

  await progress(20, "Analyse visuelle");
  const isVideo = sourceType === "video";
  const system =
    "Tu es un directeur artistique IA. Analyse l'image/vidéo fournie et extrais le Style DNA. " +
    "Réponds UNIQUEMENT en JSON valide avec ce schéma : " +
    '{"visualMood":...,"palette":["#hex"],"composition":...,"layout":...,"lighting":...,"typography":...,"framing":...,"contrast":...,"density":...,"tags":[],"summary":...}' +
    (isVideo
      ? ',"duration":...,"scenes":[],"transitions":[],"pacing":...,"shotTypes":[],"movement":...,"captions":...,"audio":...,"hook":...,"cta":...,"narrativeStructure":...'
      : "");
  const prompt = isVideo
    ? "Analyse cette vidéo. Extrais palette, composition, lumière, typographie, cadrage, contraste, densité, ambiance visuelle, durée, scènes, transitions, pacing, types de plans, mouvements, captions, audio, hook, CTA, structure narrative. Réponds en JSON."
    : "Analyse cette image. Extrais palette de couleurs (tableau de hex), composition, layout, lumière, typographie (ou son absence), cadrage, contraste, densité, ambiance visuelle, tags, et un résumé d'une phrase. Réponds en JSON.";

  const visionOpts: { system: string; prompt: string; imageUrl?: string; videoUrl?: string } = {
    system,
    prompt,
  };
  if (isVideo) visionOpts.videoUrl = visionUrl;
  else visionOpts.imageUrl = visionUrl;

  const res = await visionChat(visionOpts);
  await progress(50, "Génération du Style DNA");
  const parsed = parseLenient<Record<string, unknown>>(res.content ?? "{}");
  const dna =
    typeof parsed === "string" ? { summary: parsed, tags: [] } : (parsed as Record<string, unknown>);

  // Persist StyleReference + StyleDNA
  const ref = await db.styleReference.create({
    data: {
      workspaceId,
      sourceType,
      sourceUrl: visionUrl,
      assetId: assetId ?? null,
    },
  });
  const summary = String(dna.summary ?? "Style DNA extrait");
  const stored = await db.styleDNA.create({
    data: {
      workspaceId,
      referenceId: ref.id,
      visualMood: (dna.visualMood as string) ?? null,
      palette: jsonStringify(Array.isArray(dna.palette) ? dna.palette : []),
      composition: (dna.composition as string) ?? null,
      layout: (dna.layout as string) ?? null,
      lighting: (dna.lighting as string) ?? null,
      typography: (dna.typography as string) ?? null,
      framing: (dna.framing as string) ?? null,
      contrast: (dna.contrast as string) ?? null,
      density: (dna.density as string) ?? null,
      duration: typeof dna.duration === "number" ? (dna.duration as number) : null,
      scenes: jsonStringify(Array.isArray(dna.scenes) ? dna.scenes : []),
      transitions: jsonStringify(Array.isArray(dna.transitions) ? dna.transitions : []),
      pacing: (dna.pacing as string) ?? null,
      shotTypes: jsonStringify(Array.isArray(dna.shotTypes) ? dna.shotTypes : []),
      movement: (dna.movement as string) ?? null,
      captions: (dna.captions as string) ?? null,
      audio: (dna.audio as string) ?? null,
      hook: (dna.hook as string) ?? null,
      cta: (dna.cta as string) ?? null,
      narrativeStructure: (dna.narrativeStructure as string) ?? null,
      tags: jsonStringify(Array.isArray(dna.tags) ? dna.tags : []),
      summary,
    },
  });
  await setCache(workspaceId, key, "style_dna", { styleDNAId: stored.id, summary });
  await progress(100, "Terminé");
  await logFn("Style DNA extrait et stocké", "info", "done");
  const consumed = await safeCost("style_analysis", 1);
  return { output: { styleDNAId: stored.id, summary, referenceId: ref.id }, consumedCredits: consumed };
};

// ── 7. style_recreate ─────────────────────────────────────────────────
// Input: { styleDNAId, brief, format, platform? }
// Loads StyleDNA, builds brand+platform context, calls "style_recreate" prompt.
// If format is image, calls generateImage and stores a new Content row.
const styleRecreateRunner: JobRunner = async ({ id, workspaceId, input, log: logFn, progress }) => {
  await logFn("Démarrage recréation de style", "info", "start");
  const i = (input ?? {}) as Record<string, unknown>;
  const styleDNAId = (i.styleDNAId as string) ?? null;
  const brief = (i.brief as string) ?? "";
  const format = (i.format as string) ?? "image";
  const platform = (i.platform as string) ?? "instagram";
  if (!styleDNAId) throw new Error("styleDNAId requis");

  await progress(20, "Chargement du Style DNA");
  const dna = await db.styleDNA.findUnique({ where: { id: styleDNAId } });
  if (!dna || dna.workspaceId !== workspaceId) throw new Error("Style DNA introuvable");

  const brand = await buildBrandContext(workspaceId);
  const platformProfile = await db.platformProfile.findUnique({ where: { platform } });
  const tpl = await getPrompt("style_recreate", workspaceId);
  const dnaSummary = dna.summary ?? "";
  const user = tpl?.userTemplate
    ? renderTemplate(tpl.userTemplate, {
        style_dna: `${dnaSummary}\nPalette: ${dna.palette ?? "[]"}\nComposition: ${dna.composition ?? "?"}\nLighting: ${dna.lighting ?? "?"}`,
        brief,
        brand_dna: brand,
        platform_dna: platformProfile ? jsonStringify(platformProfile) : "{}",
        format,
      })
    : `Style DNA : ${dnaSummary}\nBrief : ${brief}\nFormat : ${format}`;

  await progress(50, "Génération de la recréation");
  const res = await textChat({
    system: tpl?.systemPrompt ?? "Tu es un directeur artistique.",
    messages: [{ role: "user", content: user }],
  });
  const parsed = parseLenient<{ prompt?: string; composition?: string; palette?: string[] }>(res.content ?? "{}");
  const plan =
    typeof parsed === "string"
      ? { prompt: parsed, composition: null, palette: [] }
      : (parsed as { prompt?: string; composition?: string; palette?: string[] });

  let output: Record<string, unknown> = { plan, raw: res.content };

  if (format === "image" && plan.prompt) {
    // ANTI-WASTE: cache the rendered image by prompt hash
    const ckey = cacheKey(["style_recreate", workspaceId, plan.prompt, "1024x1024"]);
    const cachedImg = await getCache<{ dataUrl: string; base64: string } | null>(workspaceId, ckey);
    if (cachedImg && cachedImg.dataUrl) {
      await hit(ckey);
      output = { ...output, dataUrl: cachedImg.dataUrl, base64: cachedImg.base64, cached: true };
      await logFn("Image servie depuis le cache", "info", "cache-hit");
    } else {
      const img = await generateImage({ prompt: plan.prompt, size: "1024x1024" });
      if (img.base64) {
        await setCache(workspaceId, ckey, "transform", { dataUrl: img.dataUrl, base64: img.base64 });
        output = { ...output, dataUrl: img.dataUrl, base64: img.base64, cached: false };
      }
    }
    // Store a new Content row
    const content = await db.content.create({
      data: {
        workspaceId,
        type: "image",
        title: brief.slice(0, 200) || "Recréation de style",
        description: plan.prompt,
        objective: "engagement",
        status: "draft",
        platforms: jsonStringify([platform]),
        metadata: jsonStringify({
          styleDNAId,
          prompt: plan.prompt,
          composition: plan.composition ?? null,
          palette: Array.isArray(plan.palette) ? plan.palette : [],
          imageDataUrl: output.dataUrl ?? null,
        }),
        aiGenerated: true,
      },
    });
    output.contentId = content.id;
  }

  await progress(100, "Terminé");
  await logFn("Recréation de style terminée", "info", "done");
  const consumed = await safeCost("image_generation", 1);
  return { output, consumedCredits: consumed };
};

// ── 8. message_analysis ────────────────────────────────────────────────
// Input: { message, platform?, conversationId?, messageId? }
// Uses cache for same message hash.
const messageAnalysisRunner: JobRunner = async ({ id, workspaceId, input, log: logFn, progress }) => {
  await logFn("Démarrage analyse de message", "info", "start");
  const i = (input ?? {}) as Record<string, unknown>;
  const message = (i.message as string) ?? "";
  const platform = (i.platform as string) ?? "instagram";
  if (!message) throw new Error("Message vide");

  // ANTI-WASTE: cache intent/sentiment for the same message hash
  const key = cacheKey(["message", workspaceId, message, platform]);
  const cached = await getCache<{ intent?: string; sentiment?: string; priority?: string; suggestedReply?: string; confidence?: number } | null>(workspaceId, key);
  if (cached) {
    await hit(key);
    await progress(100, "Terminé (cache)");
    return { output: { ...cached, cached: true }, consumedCredits: 0 };
  }

  await progress(20, "Analyse du message");
  const tpl = await getPrompt("message_analysis", workspaceId);
  const brand = await buildBrandContext(workspaceId);
  const user = tpl?.userTemplate
    ? renderTemplate(tpl.userTemplate, { message, platform, brand_voice: brand })
    : `Message : ${message}\nPlateforme : ${platform}`;
  await progress(50, "Génération de l'analyse");
  const res = await textChat({
    system: tpl?.systemPrompt ?? "Tu analyses un message entrant.",
    messages: [{ role: "user", content: user }],
  });
  await progress(80, "Validation");
  const parsed = parseLenient<{ intent?: string; sentiment?: string; priority?: string; suggested_reply?: string; confidence?: number }>(res.content ?? "{}");
  const out =
    typeof parsed === "string"
      ? { intent: "question", sentiment: "neutral", priority: "low", suggested_reply: parsed, confidence: 0.5 }
      : {
          intent: parsed.intent ?? "question",
          sentiment: parsed.sentiment ?? "neutral",
          priority: parsed.priority ?? "low",
          suggestedReply: parsed.suggested_reply ?? null,
          confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
        };
  await setCache(workspaceId, key, "analysis", out);

  // Optionally persist on the Message row
  const messageId = (i.messageId as string) ?? null;
  if (messageId) {
    await db.message
      .update({
        where: { id: messageId },
        data: {
          intent: out.intent,
          sentiment: out.sentiment,
          suggestedReply: out.suggestedReply,
          aiAnalyzed: true,
        },
      })
      .catch(() => undefined);
  }
  await progress(100, "Terminé");
  const consumed = await safeCost("message_analysis", 1);
  return { output: out, consumedCredits: consumed };
};

// ── 9. report ──────────────────────────────────────────────────────────
// Input: { period, metrics?, topContents?, flops?, campaignId? }
const reportRunner: JobRunner = async ({ id, workspaceId, input, log: logFn, progress }) => {
  await logFn("Démarrage génération de rapport", "info", "start");
  const i = (input ?? {}) as Record<string, unknown>;
  const period = (i.period as string) ?? "30j";
  const metrics = i.metrics ?? {};
  const top = i.top ?? i.topContents ?? [];
  const flops = i.flops ?? [];

  await progress(20, "Analyse des métriques");
  // If no metrics provided, build them from AnalyticsSnapshot
  let metricsStr = JSON.stringify(metrics);
  if (!metrics || (typeof metrics === "object" && Object.keys(metrics as object).length === 0)) {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rows = await db.analyticsSnapshot.findMany({
      where: { workspaceId, date: { gte: since } },
      select: { platform: true, impressions: true, engagement: true, clicks: true, conversions: true, revenueCents: true },
    });
    const agg = { impressions: 0, engagement: 0, clicks: 0, conversions: 0, revenueCents: 0, byPlatform: {} as Record<string, unknown> };
    for (const r of rows) {
      agg.impressions += r.impressions;
      agg.engagement += r.engagement;
      agg.clicks += r.clicks;
      agg.conversions += r.conversions;
      agg.revenueCents += r.revenueCents;
      (agg.byPlatform as Record<string, unknown>)[r.platform ?? "all"] = (agg.byPlatform as Record<string, unknown>)[r.platform ?? "all"] ?? {};
    }
    metricsStr = JSON.stringify(agg);
  }
  const tpl = await getPrompt("report", workspaceId);
  const user = tpl?.userTemplate
    ? renderTemplate(tpl.userTemplate, { period, metrics: metricsStr, top: JSON.stringify(top), flops: JSON.stringify(flops) })
    : `Période : ${period}\nMétriques : ${metricsStr}\nTop contenus : ${JSON.stringify(top)}\nFlops : ${JSON.stringify(flops)}`;
  await progress(50, "Génération du rapport");
  const res = await textChat({
    system: tpl?.systemPrompt ?? "Tu rédiges un rapport marketing.",
    messages: [{ role: "user", content: user }],
  });
  await progress(80, "Validation");
  const parsed = parseLenient<{ working?: string[]; declining?: string[]; growing?: string[]; toChange?: string[]; actions?: Array<{ title?: string; cta?: string }> }>(res.content ?? "{}");
  const report =
    typeof parsed === "string"
      ? { body: parsed, working: [], declining: [], growing: [], toChange: [], actions: [] }
      : parsed;
  // Persist a Report row
  const row = await db.report.create({
    data: {
      workspaceId,
      type: period.includes("week") ? "weekly" : period.includes("month") ? "monthly" : "weekly",
      periodStart: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      periodEnd: new Date(),
      summary: jsonStringify(report),
      body: res.content,
    },
  });
  await progress(100, "Terminé");
  await logFn(`Rapport généré (id=${row.id})`, "info", "done");
  const consumed = await safeCost("report", 1);
  return { output: { reportId: row.id, ...report }, consumedCredits: consumed };
};

// ── 10. insight ────────────────────────────────────────────────────────
// Input: { metrics?, history?, platforms? }
const insightRunner: JobRunner = async ({ id, workspaceId, input, log: logFn, progress }) => {
  await logFn("Démarrage génération d'insights", "info", "start");
  const i = (input ?? {}) as Record<string, unknown>;
  let metrics = i.metrics;
  let platforms = i.platforms;
  let history = i.history;
  if (!metrics) {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rows = await db.analyticsSnapshot.findMany({
      where: { workspaceId, date: { gte: since } },
      select: { platform: true, impressions: true, engagement: true, clicks: true, conversions: true },
    });
    metrics = JSON.stringify(rows);
    platforms = JSON.stringify(await db.workspacePlatformLearning.findMany({ where: { workspaceId } }));
    history = JSON.stringify(await db.report.findMany({ where: { workspaceId }, take: 5, orderBy: { createdAt: "desc" } }));
  }
  await progress(20, "Analyse des données");
  const tpl = await getPrompt("insight", workspaceId);
  const user = tpl?.userTemplate
    ? renderTemplate(tpl.userTemplate, { metrics: JSON.stringify(metrics), platforms: JSON.stringify(platforms), history: JSON.stringify(history) })
    : `Métriques : ${JSON.stringify(metrics)}\nPlateformes : ${JSON.stringify(platforms)}\nHistorique : ${JSON.stringify(history)}`;
  await progress(50, "Génération des insights");
  const res = await textChat({
    system: tpl?.systemPrompt ?? "Tu es un analyste marketing.",
    messages: [{ role: "user", content: user }],
  });
  await progress(80, "Validation");
  const parsed = parseLenient<{ insights?: Array<Record<string, unknown>> }>(res.content ?? "{}");
  const insights =
    (parsed && typeof parsed !== "string" && Array.isArray(parsed.insights) ? parsed.insights : []) as Array<Record<string, unknown>>;
  // Persist each insight
  const saved: Array<Record<string, unknown>> = [];
  for (const ins of insights.slice(0, 8)) {
    const row = await db.insight.create({
      data: {
        workspaceId,
        category: String(ins.category ?? "performance"),
        severity: String(ins.severity ?? "info"),
        evidence: ins.evidence ? String(ins.evidence) : null,
        explanation: ins.explanation ? String(ins.explanation) : null,
        recommendation: ins.recommendation ? String(ins.recommendation) : null,
        expectedImpact: ins.expectedImpact ? String(ins.expectedImpact) : null,
        impactScore: typeof ins.impactScore === "number" ? ins.impactScore : null,
        effortScore: typeof ins.effortScore === "number" ? ins.effortScore : null,
        urgencyScore: typeof ins.urgencyScore === "number" ? ins.urgencyScore : null,
        confidence: typeof ins.confidence === "number" ? ins.confidence : null,
        priorityScore: typeof ins.priorityScore === "number" ? ins.priorityScore : null,
      },
    });
    saved.push({ id: row.id, ...ins });
  }
  await progress(100, "Terminé");
  await logFn(`Insights générés : ${saved.length}`, "info", "done");
  const consumed = await safeCost("insight", 1);
  return { output: { insights: saved, count: saved.length }, consumedCredits: consumed };
};

// ── 11. auto_video_edit ────────────────────────────────────────────────
// Input: { duration, objective, brand?, assetId? }
const autoVideoEditRunner: JobRunner = async ({ id, workspaceId, input, log: logFn, progress }) => {
  await logFn("Démarrage montage vidéo IA", "info", "start");
  const i = (input ?? {}) as Record<string, unknown>;
  const duration = Number(i.duration ?? 30);
  const objective = (i.objective as string) ?? "engagement";
  const brand = (i.brand as string) ?? (await buildBrandContext(workspaceId));

  await progress(20, "Analyse de la vidéo");
  const tpl = await getPrompt("auto_video_edit", workspaceId);
  const user = tpl?.userTemplate
    ? renderTemplate(tpl.userTemplate, { duration: String(duration), objective, brand })
    : `Durée vidéo : ${duration}s\nObjectif : ${objective}\nMarque : ${brand}`;
  await progress(50, "Génération du plan de montage");
  const res = await textChat({
    system: tpl?.systemPrompt ?? "Tu es un monteur vidéo IA.",
    messages: [{ role: "user", content: user }],
  });
  await progress(80, "Validation");
  const parsed = parseLenient<{ plan?: Array<{ start?: string; end?: string; label?: string; reason?: string }> }>(res.content ?? "{}");
  const plan =
    (parsed && typeof parsed !== "string" && Array.isArray(parsed.plan) ? parsed.plan : []) as Array<{
      start?: string; end?: string; label?: string; reason?: string;
    }>;
  await progress(100, "Terminé");
  await logFn(`Plan de montage généré : ${plan.length} segments`, "info", "done");
  const consumed = await safeCost("video_render", 1);
  return { output: { plan, count: plan.length, duration }, consumedCredits: consumed };
};

// ── REGISTER ALL RUNNERS (side-effect import) ──────────────────────────
// NOTE: other agents may register insight/report/message_analysis runners via their
// own registerXRunners() functions. registerJobRunner just sets a Map entry — last writer wins.
// Both agents' files import runners.ts, so this file is the single source of truth.
export function registerAllRunners() {
  registerJobRunner("text_generation", textRunner);
  registerJobRunner("image_generation", imageRunner);
  registerJobRunner("atomize", atomizeRunner);
  registerJobRunner("adapt", adaptRunner);
  registerJobRunner("calendar_generate", calendarRunner);
  registerJobRunner("style_analysis", styleAnalysisRunner);
  registerJobRunner("style_recreate", styleRecreateRunner);
  registerJobRunner("message_analysis", messageAnalysisRunner);
  registerJobRunner("report", reportRunner);
  registerJobRunner("insight", insightRunner);
  registerJobRunner("auto_video_edit", autoVideoEditRunner);
  logger.info("runners:registered", { count: 11 });
}

registerAllRunners();

// Re-exports for other agents (so they can register their own runners by importing here)
export {
  textChat,
  visionChat,
  generateImage,
  editImage,
  tts,
  transcribe,
  generateVideo,
  pollVideo,
  registerJobRunner,
  getPrompt,
  renderTemplate,
  estimateCost,
  buildBrandContext,
  buildPerformanceContext,
  routeTask,
  cacheKey,
  getCache,
  setCache,
  hit,
  parseLenient,
};
