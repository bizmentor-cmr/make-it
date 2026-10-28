// Make It — Seed script.
// Creates the demo user, workspace, brand profile, content, analytics, credits,
// platform profiles, prompt templates, cost rules, subscription plans, credit packs.
// Run with: bun run db:seed (or bun prisma/seed.ts)

import { db } from "../src/lib/db";
import { hashPassword } from "../src/server/core/auth";
import { ensureDefaultPrompts } from "../src/server/core/prompts";
import { ensureDefaultCostRules } from "../src/server/core/ai-cost";

async function main() {
  console.log("Seeding Make It...");

  // ── User ──
  const passwordHash = await hashPassword("makeit");
  const user = await db.user.upsert({
    where: { email: "demo@makeit.app" },
    update: {},
    create: { email: "demo@makeit.app", name: "Camille", passwordHash, locale: "fr", timezone: "Africa/Douala" },
  });
  console.log("user:", user.email);

  // ── Workspace ──
  const ws = await db.workspace.upsert({
    where: { slug: "atelier-lumiere" },
    update: {},
    create: {
      name: "Atelier Lumière",
      slug: "atelier-lumiere",
      ownerId: user.id,
      plan: "pro",
    },
  });
  console.log("workspace:", ws.name);

  await db.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: ws.id, userId: user.id } },
    update: {},
    create: { workspaceId: ws.id, userId: user.id, role: "owner" },
  });

  // ── Credit wallet ──
  await db.creditWallet.upsert({
    where: { workspaceId: ws.id },
    update: {},
    create: { workspaceId: ws.id, subscriptionCredits: 5000, purchasedCredits: 0, reservedCredits: 0, totalConsumed: 1760 },
  });

  // ── Brand profile ──
  await db.brandProfile.upsert({
    where: { workspaceId: ws.id },
    update: {},
    create: {
      workspaceId: ws.id,
      businessName: "Atelier Lumière",
      description: "Mode & lifestyle premium, savoir-faire artisanal.",
      industry: "Mode & Lifestyle",
      website: "atelier-lumiere.fr",
      country: "France",
      language: "fr",
      timezone: "Africa/Douala",
      targetMarket: "Femmes 25-40 ans urbaines, créateurs de contenu, e-commerçants",
      positioning: "Premium accessible, savoir-faire artisanal",
      valueProposition: "Des pièces uniques qui durent, faites avec soin.",
      objectives: JSON.stringify(["Ventes", "Notoriété", "Fidélisation"]),
    },
  });

  await db.brandIdentity.upsert({
    where: { workspaceId: ws.id },
    update: {},
    create: {
      workspaceId: ws.id,
      colors: JSON.stringify(["#1F2937", "#0F766E", "#F59E0B", "#F5F1EA", "#111827"]),
      fonts: JSON.stringify(["Geist Sans", "Playfair Display"]),
      visualStyle: "Minimaliste, premium, beaucoup d'espace blanc",
      imageryStyle: "Lumière douce, fond neutre, cadrage centré",
    },
  });

  await db.brandVoice.upsert({
    where: { workspaceId: ws.id },
    update: {},
    create: {
      workspaceId: ws.id,
      tone: "Premium, accessible, inspirant",
      personality: "Direct, jamais commercial agressif",
      vocabulary: JSON.stringify(["savoir-faire", "pièces uniques", "fait main"]),
      formality: "medium",
      humor: "subtle",
      localExpressions: JSON.stringify(["à la maison", "coups de cœur"]),
    },
  });

  await db.brandRules.upsert({
    where: { workspaceId: ws.id },
    update: {},
    create: {
      workspaceId: ws.id,
      topicsToPromote: JSON.stringify(["savoir-faire", "coulisses", "nouveautés"]),
      topicsToAvoid: JSON.stringify(["polémiques", "promesse irréaliste"]),
      wordsToUse: JSON.stringify(["premium", "artisanal", "unique"]),
      wordsToAvoid: JSON.stringify(["pas cher", "promotion agressive"]),
      claims: JSON.stringify(["Fait main en France"]),
      ctaPreferences: JSON.stringify(["Découvrir", "Réserver", "Voir la collection"]),
    },
  });

  // ── Social accounts ──
  const platforms = [
    { platform: "instagram", handle: "@atelier.lumiere", name: "Atelier Lumière" },
    { platform: "facebook", handle: "Atelier Lumière", name: "Atelier Lumière" },
    { platform: "tiktok", handle: "@atelierlumiere", name: "Atelier Lumière" },
    { platform: "whatsapp", handle: "+33 6 12 34 56 78", name: "Atelier Lumière" },
  ];
  for (const p of platforms) {
    await db.socialAccount.upsert({
      where: { workspaceId_platform_externalAccountId: { workspaceId: ws.id, platform: p.platform, externalAccountId: p.handle } },
      update: {},
      create: { workspaceId: ws.id, platform: p.platform, externalAccountId: p.handle, accountName: p.name, handle: p.handle, status: "connected" },
    });
  }

  // ── Subscription plans ──
  const plans = [
    { name: "free", monthlyPrice: 0, includedCredits: 500, storageLimitMb: 500, socialAccountsLimit: 2, teamMembersLimit: 1, featureFlags: JSON.stringify({}) },
    { name: "starter", monthlyPrice: 1900, includedCredits: 2000, storageLimitMb: 2000, socialAccountsLimit: 4, teamMembersLimit: 3, featureFlags: JSON.stringify({}) },
    { name: "pro", monthlyPrice: 4900, includedCredits: 5000, storageLimitMb: 10000, socialAccountsLimit: 8, teamMembersLimit: 8, featureFlags: JSON.stringify({}) },
    { name: "business", monthlyPrice: 9900, includedCredits: 12000, storageLimitMb: 50000, socialAccountsLimit: 20, teamMembersLimit: 25, featureFlags: JSON.stringify({}) },
  ];
  for (const p of plans) {
    await db.subscriptionPlan.upsert({ where: { name: p.name }, update: {}, create: p as any });
  }
  await db.subscription.upsert({
    where: { workspaceId: ws.id },
    update: {},
    create: { workspaceId: ws.id, planId: (await db.subscriptionPlan.findUnique({ where: { name: "pro" } }))!.id, status: "active", currentPeriodEnd: new Date(Date.now() + 1000 * 60 * 60 * 24 * 18) },
  });

  // ── Credit packs ──
  const packs = [
    { name: "500 crédits", credits: 500, priceCents: 900, popular: false },
    { name: "2 000 crédits", credits: 2000, priceCents: 2900, popular: true },
    { name: "5 000 crédits", credits: 5000, priceCents: 5900, popular: false },
    { name: "10 000 crédits", credits: 10000, priceCents: 9900, popular: false },
  ];
  for (const p of packs) {
    const existing = await db.creditPack.findFirst({ where: { name: p.name } });
    if (!existing) await db.creditPack.create({ data: { ...p, active: true } });
  }

  // ── Platform profiles (DNA) ──
  const platformDNA = [
    { platform: "instagram", preferredContentTypes: JSON.stringify(["Reel", "Carousel", "Story"]), recommendedLength: "Reel 15-30s, Carousel 5-8 slides", tone: "Visuel, inspirant", hookBehavior: "Première frame / première ligne forte", ctaPatterns: JSON.stringify(["Lien en bio", "Enregistrer ce post"]), hashtags: JSON.stringify(["#mode", "#artisanat", "#madewithlove"]), visualPatterns: "Premium, lumière douce", audienceBehavior: "Découverte visuelle, sauvegardes", contentNorms: "Format carré ou 4:5, visuel soigné" },
    { platform: "facebook", preferredContentTypes: JSON.stringify(["Post", "Video", "Link"]), recommendedLength: "Post 80-120 mots, Video 30-60s", tone: "Conversationnel, communautaire", hookBehavior: "Question ou anecdote", ctaPatterns: JSON.stringify(["Commentez", "Partagez"]), hashtags: JSON.stringify(["#communauté"]), visualPatterns: "Chaleureux, humain", audienceBehavior: "Commentaires, partages", contentNorms: "Lien + visuel" },
    { platform: "tiktok", preferredContentTypes: JSON.stringify(["Video", "Reel"]), recommendedLength: "15-30s", tone: "Punchy, trend-aware", hookBehavior: "Hook dans la 1ère seconde", ctaPatterns: JSON.stringify(["Follow pour plus", "Commente X pour..."]), hashtags: JSON.stringify(["#fyp", "#tiktokmode"]), visualPatterns: "Vertical, rapide, captions", audienceBehavior: "Rétention, partages", contentNorms: "9:16, captions, son tendance" },
    { platform: "linkedin", preferredContentTypes: JSON.stringify(["Article", "Post", "Carousel"]), recommendedLength: "Post 150-300 mots, Article 800+", tone: "Expert, professionnel", hookBehavior: "1 phrase forte ou chiffre", ctaPatterns: JSON.stringify(["Qu'en pensez-vous ?", "Voir le post détaillé"]), hashtags: JSON.stringify(["#marketing", "#stratégie"]), visualPatterns: "Sobre, structuré", audienceBehavior: "Lectures longues, partages pros", contentNorms: "Texte + 1 visuel pro" },
    { platform: "youtube", preferredContentTypes: JSON.stringify(["Video", "Short"]), recommendedLength: "Short 30-60s, Video 5-15min", tone: "Éducatif, narratif", hookBehavior: "Titre + 3s d'accroche", ctaPatterns: JSON.stringify(["Abonne-toi", "Lien en description"]), hashtags: JSON.stringify(["#shorts"]), visualPatterns: "Net, structuré", audienceBehavior: "Rétention longue, abonnements", contentNorms: "16:9 ou 9:16 (Shorts)" },
    { platform: "google", preferredContentTypes: JSON.stringify(["Post", "Photo"]), recommendedLength: "Post 100-200 mots", tone: "Local, direct", hookBehavior: "Offre + ville", ctaPatterns: JSON.stringify(["Voir l'itinéraire", "Appeler"]), hashtags: JSON.stringify([]), visualPatterns: "Photo vitrine claire", audienceBehavior: "Recherche locale", contentNorms: "Photos + horaires + offre" },
    { platform: "whatsapp", preferredContentTypes: JSON.stringify(["Message", "Broadcast"]), recommendedLength: "1-3 lignes", tone: "Direct, conversion", hookBehavior: "Bénéfice immédiat", ctaPatterns: JSON.stringify(["Répondez OUI", "Cliquez ici"]), hashtags: JSON.stringify([]), visualPatterns: "Image produit nette", audienceBehavior: "Messages, conversions", contentNorms: "Court, urgent, personnalisé" },
  ];
  for (const p of platformDNA) {
    await db.platformProfile.upsert({ where: { platform: p.platform }, update: {}, create: p as any });
  }

  // ── Workspace platform learning ──
  for (const platform of ["instagram", "tiktok", "facebook", "whatsapp"] as const) {
    await db.workspacePlatformLearning.upsert({
      where: { id: `learn_${ws.id}_${platform}` },
      update: {},
      create: { id: `learn_${ws.id}_${platform}`, workspaceId: ws.id, platform, bestFormat: platform === "instagram" ? "Reel" : platform === "tiktok" ? "Video" : "Post", bestTime: "Dim 19h", bestTone: "Premium", avgEngagement: 4.2, samples: 12 },
    });
  }

  // ── Content (a few items) ──
  const contentSamples = [
    { type: "reel", title: "3 erreurs qui tuent votre stratégie Instagram", objective: "notoriety", pillar: "Éducation", status: "published", platforms: JSON.stringify(["instagram", "tiktok"]) },
    { type: "carousel", title: "Notre nouveau produit arrive", objective: "sales", pillar: "Produit", status: "scheduled", platforms: JSON.stringify(["instagram"]) },
    { type: "video", title: "Tutoriel : préparer sa semaine", objective: "engagement", pillar: "Éducation", status: "published", platforms: JSON.stringify(["tiktok", "youtube"]) },
    { type: "post", title: "Coulisses de l'atelier", objective: "engagement", pillar: "Coulisses", status: "draft", platforms: JSON.stringify(["facebook", "instagram"]) },
    { type: "story", title: "Sondage audience", objective: "engagement", pillar: "Communauté", status: "idea", platforms: JSON.stringify(["instagram"]) },
    { type: "ad", title: "Promo week-end", objective: "sales", pillar: "Promotion", status: "idea", platforms: JSON.stringify(["facebook", "whatsapp"]) },
  ];
  const contentIds: string[] = [];
  for (const c of contentSamples) {
    const created = await db.content.create({
      data: { workspaceId: ws.id, type: c.type, title: c.title, objective: c.objective, pillar: c.pillar, status: c.status, platforms: c.platforms, aiGenerated: c.status !== "draft" } as any,
    });
    contentIds.push(created.id);
  }

  // ── Analytics snapshots (last 30 days, a few per day) ──
  const now = new Date();
  const metricsBase: Record<string, { reach: number; impressions: number; views: number; engagement: number; clicks: number; messages: number; leads: number; conversions: number; revenueCents: number }> = {
    instagram: { reach: 18000, impressions: 24000, views: 0, engagement: 920, clicks: 480, messages: 24, leads: 8, conversions: 4, revenueCents: 24000 },
    tiktok: { reach: 12000, impressions: 16000, views: 14000, engagement: 680, clicks: 220, messages: 12, leads: 5, conversions: 2, revenueCents: 12000 },
    facebook: { reach: 6000, impressions: 9000, views: 0, engagement: 180, clicks: 140, messages: 8, leads: 3, conversions: 1, revenueCents: 6000 },
  };
  for (let d = 0; d < 30; d++) {
    const date = new Date(now.getTime() - d * 24 * 60 * 60 * 1000);
    for (const [platform, base] of Object.entries(metricsBase)) {
      const factor = 0.7 + Math.random() * 0.6;
      await db.analyticsSnapshot.create({
        data: {
          workspaceId: ws.id,
          platform,
          date,
          reach: Math.round(base.reach * factor),
          impressions: Math.round(base.impressions * factor),
          views: Math.round(base.views * factor),
          engagement: Math.round(base.engagement * factor),
          clicks: Math.round(base.clicks * factor),
          messages: Math.round(base.messages * factor),
          leads: Math.round(base.leads * factor),
          conversions: Math.round(base.conversions * factor),
          revenueCents: Math.round(base.revenueCents * factor),
          followers: Math.round(20 * factor),
          ctr: 0.04 + Math.random() * 0.02,
          cpc: 0.2 + Math.random() * 0.1,
          cpm: 4 + Math.random() * 2,
        },
      });
    }
  }

  // ── Campaigns ──
  const cmp = await db.campaign.create({
    data: {
      workspaceId: ws.id,
      name: "Soldes Hiver — Notoriété",
      objective: "visibility",
      budgetCents: 50000,
      spentCents: 42000,
      startDate: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000),
      endDate: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
      platforms: JSON.stringify(["instagram", "facebook"]),
      status: "active",
    },
  });
  await db.campaignVariant.create({ data: { campaignId: cmp.id, creative: JSON.stringify({ image: "gradient", headline: "Soldes Hiver" }), copy: "Jusqu'à -30% sur la collection Hiver.", status: "active" } });

  const cmp2 = await db.campaign.create({
    data: {
      workspaceId: ws.id,
      name: "Leads Coaching — Prospects",
      objective: "leads",
      budgetCents: 80000,
      spentCents: 68000,
      startDate: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000),
      endDate: new Date(now.getTime() + 20 * 24 * 60 * 60 * 1000),
      platforms: JSON.stringify(["instagram", "linkedin"]),
      status: "active",
    },
  });
  await db.campaignVariant.create({ data: { campaignId: cmp2.id, creative: JSON.stringify({ image: "gradient", headline: "Coaching" }), copy: "Réservez votre session découverte.", status: "active" } });

  const cmp3 = await db.campaign.create({
    data: {
      workspaceId: ws.id,
      name: "Promo Week-end — Ventes",
      objective: "sales",
      budgetCents: 25000,
      spentCents: 22000,
      startDate: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000),
      endDate: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000),
      platforms: JSON.stringify(["facebook", "whatsapp"]),
      status: "paused",
    },
  });
  await db.campaignVariant.create({ data: { campaignId: cmp3.id, creative: JSON.stringify({ image: "gradient", headline: "Promo week-end" }), copy: "Offre limitée -20%.", status: "active" } });

  // ── Conversations / messages ──
  const convos = [
    { platform: "instagram", name: "Sophie Martin", handle: "@sophie", intent: "purchase", sentiment: "positive", preview: "Bonjour, est-ce que la promo est valable en boutique ?", unread: 1 },
    { platform: "whatsapp", name: "Karim B.", handle: "Karim Benali", intent: "purchase", sentiment: "positive", preview: "Je veux commander le pack premium", unread: 1 },
    { platform: "tiktok", name: "Léa Durand", handle: "@lea.creates", intent: "praise", sentiment: "positive", preview: "Votre tuto est génial, je l'ai partagé !", unread: 0 },
    { platform: "facebook", name: "Maxime P.", handle: "Maxime", intent: "support", sentiment: "neutral", preview: "Je n'arrive pas à finaliser ma commande", unread: 0 },
  ];
  for (const c of convos) {
    const conv = await db.conversation.create({
      data: {
        workspaceId: ws.id,
        platform: c.platform,
        participantName: c.name,
        participantHandle: c.handle,
        intent: c.intent,
        sentiment: c.sentiment,
        unreadCount: c.unread,
        lastMessageAt: new Date(now.getTime() - Math.random() * 3 * 60 * 60 * 1000),
      },
    });
    await db.message.create({
      data: { conversationId: conv.id, direction: "inbound", body: c.preview, intent: c.intent, sentiment: c.sentiment, aiAnalyzed: true },
    });
    await db.message.create({
      data: { conversationId: conv.id, direction: "outbound", body: "Merci pour votre message ! Nous revenons vers vous très vite 🙌", authoredByAi: true },
    });
  }

  // ── Notifications ──
  const notifs = [
    { type: "publication_success", title: "Publication réussie", body: "Votre Reel Instagram a été publié.", level: "success" },
    { type: "ai_credits_low", title: "Crédits faibles", body: "Il vous reste 3 240 crédits sur 5 000.", level: "warning" },
    { type: "report_available", title: "Rapport disponible", body: "Votre résumé mensuel est prêt.", level: "info" },
    { type: "publication_failed", title: "Publication échouée", body: "TikTok a renvoyé une erreur. Réessayez.", level: "danger" },
    { type: "campaign_warning", title: "Campagne sous-performante", body: "« Promo week-end » convertit en dessous de l'objectif.", level: "warning" },
  ];
  for (const n of notifs) {
    await db.notification.create({ data: { workspaceId: ws.id, userId: user.id, type: n.type, title: n.title, body: n.body, level: n.level } });
  }

  // ── Automations ──
  await db.automation.create({ data: { workspaceId: ws.id, name: "DM prix → lien WhatsApp", trigger: "comment_contains", condition: JSON.stringify({ keyword: "prix" }), action: "send_dm", actionConfig: JSON.stringify({ message: "Bonjour ! Notre brochure prix est dispo ici : ..." }), enabled: true } });
  await db.automation.create({ data: { workspaceId: ws.id, name: "Nouvelle conversation → suggérer réponse", trigger: "new_conversation", action: "suggest_reply", enabled: true } });
  await db.automation.create({ data: { workspaceId: ws.id, name: "Campagne sous seuil → alerte", trigger: "campaign_under_threshold", action: "create_alert", enabled: true } });

  // ── Workspace memory ──
  await db.workspaceMemory.upsert({
    where: { workspaceId: ws.id },
    update: {},
    create: {
      workspaceId: ws.id,
      facts: JSON.stringify([
        { type: "best_format", value: "Reel éducatif", source: "analytics" },
        { type: "best_time", value: "Dimanche 19h", source: "analytics" },
        { type: "audience", value: "Femmes 25-40 ans urbaines", source: "brand" },
      ]),
      learnings: JSON.stringify([
        "Les Reels éducatifs rétentionnent 68%",
        "Le CTA WhatsApp convertit +23%",
      ]),
    },
  });

  // ── Global prompt templates + cost rules ──
  await ensureDefaultPrompts();
  await ensureDefaultCostRules();

  // ── Agency demo data (P3) ──
  // Create an agency owned by the demo user + 2 client workspaces + wallet +
  // allocations + a couple of ContentValidation rows so the Planning badge has data.
  await seedAgency(user);

  console.log("Seed complete ✓");
}

async function seedAgency(user: { id: string }) {
  const agency = await db.agency.upsert({
    where: { slug: "make-it-agency-demo" },
    update: {},
    create: {
      name: "Make It Agency (Démo)",
      slug: "make-it-agency-demo",
      ownerId: user.id,
      status: "active",
      mode: "pool",
    },
  });
  await db.agencyMember.upsert({
    where: { agencyId_userId: { agencyId: agency.id, userId: user.id } },
    update: { role: "admin" },
    create: { agencyId: agency.id, userId: user.id, role: "admin" },
  });
  await db.agencyWallet.upsert({
    where: { agencyId: agency.id },
    update: {},
    create: { agencyId: agency.id, totalCredits: 50000, reservedCredits: 0, totalConsumed: 8200 },
  });
  await db.agencySetting.upsert({
    where: { agencyId: agency.id },
    update: {},
    create: { agencyId: agency.id, requireClientValidation: true, whiteLabel: false, autoReports: true },
  });

  // 2 client workspaces linked to the agency.
  const clients = [
    {
      name: "Maison Diallo",
      slug: "maison-diallo",
      sector: "Mode",
      country: "Sénégal",
      objective: "sales",
    },
    {
      name: "Café Baobab",
      slug: "cafe-baobab",
      sector: "Restauration",
      country: "Côte d'Ivoire",
      objective: "engagement",
    },
  ];
  for (const c of clients) {
    const ws = await db.workspace.upsert({
      where: { slug: c.slug },
      update: {},
      create: { name: c.name, slug: c.slug, ownerId: user.id, plan: "starter" },
    });
    await db.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: ws.id, userId: user.id } },
      update: {},
      create: { workspaceId: ws.id, userId: user.id, role: "manager" },
    });
    await db.creditWallet.upsert({
      where: { workspaceId: ws.id },
      update: {},
      create: { workspaceId: ws.id, subscriptionCredits: 0, purchasedCredits: 0 },
    });
    await db.brandProfile.upsert({
      where: { workspaceId: ws.id },
      update: {},
      create: {
        workspaceId: ws.id,
        businessName: c.name,
        industry: c.sector,
        country: c.country,
        objectives: JSON.stringify([c.objective]),
      },
    });
    const agencyClient = await db.agencyClient.upsert({
      where: { workspaceId: ws.id },
      update: {},
      create: { agencyId: agency.id, workspaceId: ws.id, status: "active" },
    });
    await db.agencyClientAccess.upsert({
      where: { agencyClientId_userId: { agencyClientId: agencyClient.id, userId: user.id } },
      update: {},
      create: { agencyClientId: agencyClient.id, userId: user.id, role: "manager", assignedById: user.id },
    });

    // Seed a content + a validation row so the Planning badge shows up.
    const content = await db.content.create({
      data: {
        workspaceId: ws.id,
        type: "reel",
        title: `${c.name} — Reel de lancement`,
        status: "draft",
        aiGenerated: false,
      },
    });
    await db.contentValidation.create({
      data: {
        workspaceId: ws.id,
        contentId: content.id,
        stage: "pending_cdp",
        requireClient: true,
      },
    });
  }

  // Also seed a ContentValidation row for the main Atelier Lumière workspace,
  // so the Planning badge shows on the existing demo content.
  const mainWs = await db.workspace.findUnique({
    where: { slug: "atelier-lumiere" },
    select: { id: true },
  });
  if (mainWs) {
    const existing = await db.content.findFirst({
      where: { workspaceId: mainWs.id },
      orderBy: { createdAt: "asc" },
    });
    if (existing) {
      await db.contentValidation.upsert({
        where: { contentId: existing.id },
        update: {},
        create: {
          workspaceId: mainWs.id,
          contentId: existing.id,
          stage: "validated",
          requireClient: false,
        },
      });
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
