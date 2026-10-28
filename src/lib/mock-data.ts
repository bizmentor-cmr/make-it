// Make It — Mock data layer. Realistic marketing data for the frontend.
// All data is illustrative; no live integrations are implied.

export type Platform =
  | "instagram"
  | "facebook"
  | "tiktok"
  | "linkedin"
  | "youtube"
  | "whatsapp"
  | "google";

export type ContentFormat = "Post" | "Reel" | "Story" | "Carousel" | "Video" | "Article" | "Ad";
export type ContentStatus = "Draft" | "Scheduled" | "Published" | "Idea";

export const PLATFORM_META: Record<
  Platform,
  { label: string; color: string; bg: string; initials: string }
> = {
  instagram: { label: "Instagram", color: "oklch(0.62 0.2 350)", bg: "oklch(0.95 0.06 350)", initials: "IG" },
  facebook: { label: "Facebook", color: "oklch(0.55 0.16 250)", bg: "oklch(0.94 0.05 250)", initials: "FB" },
  tiktok: { label: "TikTok", color: "oklch(0.3 0.02 240)", bg: "oklch(0.95 0.01 240)", initials: "TT" },
  linkedin: { label: "LinkedIn", color: "oklch(0.5 0.12 250)", bg: "oklch(0.94 0.04 250)", initials: "LI" },
  youtube: { label: "YouTube", color: "oklch(0.58 0.22 25)", bg: "oklch(0.94 0.06 25)", initials: "YT" },
  whatsapp: { label: "WhatsApp", color: "oklch(0.6 0.15 165)", bg: "oklch(0.94 0.06 165)", initials: "WA" },
  google: { label: "Google", color: "oklch(0.55 0.14 250)", bg: "oklch(0.94 0.04 250)", initials: "GG" },
};

export const makeItScore = {
  total: 78,
  delta: 6,
  subscores: [
    { key: "visibility", label: "Visibilité", icon: "👁️", value: 82, delta: 8, note: "Votre portée a progressé de 18% ce mois." },
    { key: "engagement", label: "Engagement", icon: "❤️", value: 71, delta: -3, note: "L'engagement recule légèrement sur les posts statiques." },
    { key: "conversion", label: "Conversion", icon: "🎯", value: 68, delta: 5, note: "Les boutons WhatsApp génèrent 23% de leads en plus." },
    { key: "regularity", label: "Régularité", icon: "🔥", value: 84, delta: 4, note: "5 publications / semaine, très régulier." },
    { key: "brand", label: "Cohérence de marque", icon: "🧬", value: 76, delta: 2, note: "Palette et ton bien respectés sur 4 réseaux." },
  ],
};

export const weeklyPriority = {
  title: "Vos vidéos éducatives obtiennent de meilleurs résultats que vos publications statiques",
  recommendation: "Nous recommandons d'augmenter leur fréquence cette semaine.",
  cta: "Créer une vidéo",
  metrics: { lift: "+34%", format: "Reel", reason: "Meilleur taux de rétention" },
};

export const quickActions = [
  { icon: "✨", label: "Créer du contenu", section: "create", tone: "primary" },
  { icon: "🎨", label: "Créer une image", section: "create", tone: "soft" },
  { icon: "🎬", label: "Créer une vidéo", section: "create", tone: "soft" },
  { icon: "📅", label: "Planifier", section: "planning", tone: "soft" },
  { icon: "📣", label: "Créer une campagne", section: "campaigns", tone: "soft" },
  { icon: "🔍", label: "Analyser mes performances", section: "performance", tone: "soft" },
] as const;

export const nlPrompts = [
  "Je veux annoncer une nouvelle promotion.",
  "Je veux attirer plus de clients.",
  "Je veux faire connaître ma marque.",
  "Je veux fidéliser mes abonnés.",
];

// ---- Strategy ----
export const strategyDiagnostic = [
  { key: "visibility", label: "Visibilité", value: 82, delta: 8, insight: "Bonne portée sur Instagram et TikTok." },
  { key: "engagement", label: "Engagement", value: 71, delta: -3, insight: "En baisse sur les carrousels longs." },
  { key: "growth", label: "Croissance", value: 64, delta: 12, insight: "+128 abonnés cette semaine." },
  { key: "content", label: "Contenu", value: 77, delta: 5, insight: "Régularité solide, formats à diversifier." },
  { key: "conversion", label: "Conversion", value: 68, delta: 5, insight: "Le call-to-action WhatsApp convertit le mieux." },
];

export const strategyTop = {
  contents: [
    { title: "3 erreurs qui tuent votre stratégie Instagram", platform: "instagram", format: "Reel", metric: "42 800 vues", lift: "+128%" },
    { title: "Notre nouveau produit arrive", platform: "instagram", format: "Carousel", metric: "8 200 likes", lift: "+64%" },
    { title: "Tutoriel : préparer sa semaine", platform: "tiktok", format: "Video", metric: "31 200 vues", lift: "+96%" },
  ],
  formats: [
    { name: "Reel éducatif", score: 92, note: "Rétention moyenne 68%" },
    { name: "Carrousel storytelling", score: 81, note: "Partages élevés" },
    { name: "Tutoriel vertical", score: 78, note: "Sauvegardes fortes" },
    { name: "Post statique", score: 54, note: "Engagement en baisse" },
  ],
  themes: ["Éducation", "Coulisses", "Preuve sociale", "Promotion", "Tendances"],
  timeSlots: ["Mar 18h", "Jeu 12h", "Dim 19h", "Lun 08h"],
  channels: [
    { name: "Instagram", share: 38, trend: "up" },
    { name: "TikTok", share: 27, trend: "up" },
    { name: "LinkedIn", share: 19, trend: "flat" },
    { name: "Facebook", share: 11, trend: "down" },
    { name: "YouTube", share: 5, trend: "up" },
  ],
};

export const strategyFlops = [
  { title: "Post statique ' Nouvelle collection '", platform: "instagram", format: "Post", reason: "Hook trop faible et CTA absent.", metric: "1 200 vues", drop: "-42%" },
  { title: "Carrousel 10 slides sur la marque", platform: "linkedin", format: "Carousel", reason: "Trop long, décrochage à la slide 3.", metric: "320 vues", drop: "-61%" },
  { title: "Story promotion sans urgence", platform: "instagram", format: "Story", reason: "Pas de bénéfice clair ni de deadline.", metric: "680 vues", drop: "-28%" },
];

export const strategyOpportunities = [
  { title: "Doubler les Reels éducatifs", impact: "Élevé", effort: "Moyen", why: "Votre rétention sur ce format dépasse 68%. En augmenter la fréquence pourrait ajouter +12% de portée." },
  { title: "Activer WhatsApp Business", impact: "Élevé", effort: "Faible", why: "23% de leads en plus observés sur les posts avec CTA WhatsApp." },
  { title: "Réutiliser vos meilleurs contenus en Shorts", impact: "Moyen", effort: "Faible", why: "Vos Reels Instagram fonctionnent ; YouTube Shorts est inexploité." },
  { title: "Publier le dimanche soir", impact: "Moyen", effort: "Faible", why: "Créneau 19h le dimanche a un engagement +18% vs moyenne." },
];

// ---- Calendar ----
export type CalendarItem = {
  id: string;
  day: number; // day index in week/month
  platform: Platform;
  format: ContentFormat;
  title: string;
  goal: string;
  status: ContentStatus;
  time: string;
};

export const calendarItems: CalendarItem[] = [
  { id: "c1", day: 0, platform: "instagram", format: "Reel", title: "3 erreurs Instagram", goal: "Notoriété", status: "Scheduled", time: "18:00" },
  { id: "c2", day: 0, platform: "tiktok", format: "Video", title: "Tuto prépa semaine", goal: "Engagement", status: "Scheduled", time: "12:30" },
  { id: "c3", day: 1, platform: "linkedin", format: "Article", title: "Leçon marketing #4", goal: "Autorité", status: "Draft", time: "09:00" },
  { id: "c4", day: 2, platform: "instagram", format: "Carousel", title: "Notre nouveau produit", goal: "Ventes", status: "Idea", time: "18:00" },
  { id: "c5", day: 3, platform: "facebook", format: "Post", title: "Promo week-end", goal: "Trafic", status: "Scheduled", time: "11:00" },
  { id: "c6", day: 3, platform: "youtube", format: "Video", title: "Short : coulisses", goal: "Notoriété", status: "Idea", time: "17:00" },
  { id: "c7", day: 4, platform: "instagram", format: "Story", title: "Sondage audience", goal: "Engagement", status: "Draft", time: "20:00" },
  { id: "c8", day: 5, platform: "whatsapp", format: "Post", title: "Message VIP", goal: "Fidélisation", status: "Scheduled", time: "10:00" },
  { id: "c9", day: 6, platform: "tiktok", format: "Reel", title: "Top produit du moment", goal: "Ventes", status: "Idea", time: "19:00" },
];

// ---- Library ----
export type LibraryAsset = {
  id: string;
  kind: "image" | "video" | "text" | "carousel" | "campaign" | "template";
  title: string;
  platform: Platform | "all";
  updated: string;
  thumb: string; // gradient class
};

export const libraryAssets: LibraryAsset[] = [
  { id: "l1", kind: "image", title: "Visuel collection Hiver", platform: "instagram", updated: "Il y a 2 j", thumb: "from-rose-100 to-amber-100" },
  { id: "l2", kind: "video", title: "Reel : 3 erreurs Instagram", platform: "instagram", updated: "Il y a 4 j", thumb: "from-emerald-100 to-teal-100" },
  { id: "l3", kind: "carousel", title: "Carousel nouveau produit", platform: "instagram", updated: "Hier", thumb: "from-amber-100 to-rose-100" },
  { id: "l4", kind: "text", title: "Script Reel promotion", platform: "tiktok", updated: "Aujourd'hui", thumb: "from-violet-100 to-rose-100" },
  { id: "l5", kind: "campaign", title: "Campagne Soldes Hiver", platform: "all", updated: "Il y a 3 j", thumb: "from-teal-100 to-emerald-100" },
  { id: "l6", kind: "template", title: "Template Story promo", platform: "instagram", updated: "Il y a 1 sem", thumb: "from-rose-100 to-violet-100" },
  { id: "l7", kind: "image", title: "Logo pack Noël", platform: "all", updated: "Il y a 2 sem", thumb: "from-emerald-100 to-amber-100" },
  { id: "l8", kind: "video", title: "Short coulisses atelier", platform: "youtube", updated: "Il y a 5 j", thumb: "from-teal-100 to-amber-100" },
];

// ---- Campaigns ----
export type Campaign = {
  id: string;
  name: string;
  objective: string;
  status: "Active" | "Paused" | "Draft";
  spend: number;
  results: number;
  cpa: number;
  platforms: Platform[];
  trend: number[];
};

export const campaigns: Campaign[] = [
  {
    id: "cmp1",
    name: "Soldes Hiver — Notoriété",
    objective: "Plus de visibilité",
    status: "Active",
    spend: 420,
    results: 18420,
    cpa: 0.023,
    platforms: ["instagram", "facebook"],
    trend: [12, 18, 22, 19, 28, 34, 41],
  },
  {
    id: "cmp2",
    name: "Leads Coaching — Prospects",
    objective: "Plus de prospects",
    status: "Active",
    spend: 680,
    results: 96,
    cpa: 7.08,
    platforms: ["instagram", "linkedin"],
    trend: [3, 5, 4, 7, 9, 8, 11],
  },
  {
    id: "cmp3",
    name: "Promo Week-end — Ventes",
    objective: "Plus de ventes",
    status: "Paused",
    spend: 220,
    results: 31,
    cpa: 7.1,
    platforms: ["facebook", "whatsapp"],
    trend: [2, 3, 3, 4, 5, 4, 6],
  },
  {
    id: "cmp4",
    name: "Lancement Produit",
    objective: "Plus de messages",
    status: "Draft",
    spend: 0,
    results: 0,
    cpa: 0,
    platforms: ["instagram", "tiktok", "youtube"],
    trend: [0, 0, 0, 0, 0, 0, 0],
  },
];

// ---- Messages ----
export type MessageThread = {
  id: string;
  name: string;
  handle: string;
  platform: Platform;
  preview: string;
  time: string;
  unread: boolean;
  intent: "question" | "purchase" | "support" | "spam" | "praise";
  avatarColor: string;
};

export const messageThreads: MessageThread[] = [
  { id: "t1", name: "Sophie Martin", handle: "@sophie", platform: "instagram", preview: "Bonjour, est-ce que la promo est valable en boutique ?", time: "Il y a 4 min", unread: true, intent: "purchase", avatarColor: "from-rose-300 to-amber-300" },
  { id: "t2", name: "Karim B.", handle: "Karim Benali", platform: "whatsapp", preview: "Je veux commander le pack premium", time: "Il y a 18 min", unread: true, intent: "purchase", avatarColor: "from-emerald-300 to-teal-300" },
  { id: "t3", name: "Léa Durand", handle: "@lea.creates", platform: "tiktok", preview: "Votre tuto est génial, je l'ai partagé !", time: "Il y a 1 h", unread: false, intent: "praise", avatarColor: "from-violet-300 to-rose-300" },
  { id: "t4", name: "Commentaire Instagram", handle: "post #482", platform: "instagram", preview: "Le prix indiqué est-il à jour ?", time: "Il y a 2 h", unread: false, intent: "question", avatarColor: "from-amber-300 to-rose-300" },
  { id: "t5", name: "Maxime P.", handle: "Maxime", platform: "facebook", preview: "Je n'arrive pas à finaliser ma commande", time: "Il y a 3 h", unread: false, intent: "support", avatarColor: "from-teal-300 to-emerald-300" },
  { id: "t6", name: "Promo DM", handle: "@xpromo", platform: "instagram", preview: "Boost your account with us 🔥", time: "Hier", unread: false, intent: "spam", avatarColor: "from-zinc-300 to-zinc-400" },
];

// ---- Performance ----
export const performanceMetrics = [
  { key: "reach", label: "Portée", value: "184 200", delta: 18, hint: "Personnes qui ont vu votre contenu." },
  { key: "views", label: "Vues", value: "242 800", delta: 22, hint: "Nombre de lectures de vidéos." },
  { key: "engagement", label: "Engagement", value: "4,2%", delta: -3, hint: "Interactions rapportées à la portée." },
  { key: "followers", label: "Abonnés", value: "+1 240", delta: 12, hint: "Nouveaux abonnés ce mois." },
  { key: "clicks", label: "Clics", value: "8 940", delta: 9, hint: "Clics sur vos liens." },
  { key: "messages", label: "Messages", value: "312", delta: 24, hint: "Conversations démarrées." },
  { key: "leads", label: "Leads", value: "96", delta: 15, hint: "Prospects qualifiés reçus." },
  { key: "cpa", label: "Coût / résultat", value: "7,08 €", delta: -8, hint: "Dépense moyenne par résultat." },
  { key: "revenue", label: "CA attribué", value: "12 480 €", delta: 27, hint: "Ventes liées à votre marketing." },
];

export const performanceSeries = {
  reach: [
    { day: "L", v: 12000 }, { day: "M", v: 18000 }, { day: "M", v: 14000 }, { day: "J", v: 22000 },
    { day: "V", v: 26000 }, { day: "S", v: 31000 }, { day: "D", v: 28000 },
  ],
  engagement: [
    { day: "L", v: 3.8 }, { day: "M", v: 4.1 }, { day: "M", v: 3.9 }, { day: "J", v: 4.6 },
    { day: "V", v: 4.4 }, { day: "S", v: 4.8 }, { day: "D", v: 4.2 },
  ],
};

export const monthlyReport = {
  working: ["Vos Reels éducatifs (+128% de vues)", "Le CTA WhatsApp (+23% de leads)", "La régularité du dimanche soir"],
  declining: ["Posts statiques (-12%)", "Carrousels longs sur LinkedIn (-22%)"],
  growing: ["Abonnés Instagram (+640)", "Portée TikTok (+34%)", "Conversions promo (+18%)"],
  toChange: ["Diversifier les formats sur LinkedIn", "Ajouter un hook plus fort sur 3 contenus", "Tester YouTube Shorts"],
  actions: [
    { title: "Créer 2 Reels éducatifs cette semaine", cta: "Créer" },
    { title: "Activer WhatsApp Business sur 3 contenus", cta: "Appliquer" },
    { title: "Transformer 1 Reel en Short YouTube", cta: "Transformer" },
  ],
};

// ---- Brand ----
export const brandProfile = {
  name: "Atelier Lumière",
  sector: "Mode & Lifestyle",
  country: "France",
  website: "atelier-lumiere.fr",
  colors: ["#1F2937", "#0F766E", "#F59E0B", "#F5F1EA", "#111827"],
  fonts: ["Geist Sans", "Playfair Display"],
  voice: "Premium, accessible, inspirant",
  audiences: ["Femmes 25-40 ans urbaines", "Créateurs de contenu", "E-commerçants"],
  guidelines: [
    "Toujours valoriser le savoir-faire artisanal",
    "Palette limitée à 5 couleurs",
    "Ton direct, jamais commercial agressif",
    "Préserver l'espace blanc dans les visuels",
  ],
};

// ---- Notifications ----
export const notifications = [
  { id: "n1", type: "success", title: "Publication réussie", body: "Votre Reel Instagram a été publié.", time: "Il y a 2 min", icon: "✅" },
  { id: "n2", type: "warning", title: "Crédits faibles", body: "Il vous reste 3 240 crédits sur 5 000.", time: "Il y a 1 h", icon: "⚡" },
  { id: "n3", type: "info", title: "Rapport disponible", body: "Votre résumé mensuel est prêt.", time: "Il y a 3 h", icon: "📊" },
  { id: "n4", type: "danger", title: "Publication échouée", body: "TikTok a renvoyé une erreur. Réessayez.", time: "Il y a 5 h", icon: "⚠️" },
  { id: "n5", type: "info", title: "Compte déconnecté", body: "Reconnectez Facebook pour continuer.", time: "Hier", icon: "🔗" },
  { id: "n6", type: "warning", title: "Campagne sous-performante", body: "« Promo week-end » convertit en dessous de l'objectif.", time: "Hier", icon: "📉" },
];

// ---- AI Advisor sample conversation ----
export const advisorStarter = [
  {
    role: "assistant" as const,
    content: "Bonjour Camille 👋 Je suis votre conseiller Make It. Posez-moi une question sur votre marketing, ou choisissez une suggestion.",
  },
];

export const advisorSuggestions = [
  "Pourquoi mes publications fonctionnent-elles moins bien ?",
  "Que dois-je publier cette semaine ?",
  "Quelle plateforme devrais-je privilégier ?",
  "Pourquoi cette campagne coûte-t-elle plus cher ?",
];

export const advisorResponse = `**Constat**
Votre engagement a reculé de 3 points ce mois, surtout sur les posts statiques Instagram.

**Explication**
3 publications sur 5 utilisaient le format statique avec un hook faible et aucun appel à l'action clair. Vos Reels éducatifs, à l'inverse, conservent 68% de rétention.

**Recommandation**
Rééquilibrer le planning : 2 Reels éducatifs / semaine et 1 carousel storytelling. Ajouter un CTA WhatsApp sur 3 contenus.

**Action**
Je peux préparer 2 idées de Reels pour cette semaine.`;

// ---- Style DNA ----
export const styleDNA = {
  mood: "Minimaliste · Premium · Contraste élevé",
  palette: ["#111827", "#F5F1EA", "#C2410C", "#0F766E", "#F59E0B"],
  composition: "Cadrage centré, beaucoup d'espace négatif",
  typography: "Sans-serif forte, hiérarchie marquée",
  rhythm: "Rythme rapide, coupes nettes toutes les 1,2 s",
  tags: ["Premium", "Minimaliste", "Contraste élevé", "Typographie forte", "Rythme rapide"],
};

// ---- Atomizer example ----
export const atomizerExample = {
  idea: "Je veux annoncer mon nouveau produit.",
  variants: [
    { platform: "instagram", format: "Post", hook: "Le voilà enfin ✨", tone: "Premium & visuel", length: "Court" },
    { platform: "facebook", format: "Publication", hook: "On l'a gardé secret...", tone: "Conversationnel", length: "Moyen" },
    { platform: "linkedin", format: "Post pro", hook: "9 mois de R&D, voici le résultat.", tone: "Expert", length: "Long" },
    { platform: "tiktok", format: "Script vidéo", hook: "POV : tu découvres notre nouveau produit", tone: "Hook + punchy", length: "30s" },
    { platform: "youtube", format: "Short", hook: "Nouveau produit → démo en 20s", tone: "Démo", length: "60s" },
    { platform: "whatsapp", format: "Message", hook: "Notre nouveau produit est dispo 👀", tone: "Direct & conversion", length: "2 lignes" },
  ],
};

// ---- Image editor mock ----
export const imageEditorTools = [
  { group: "Contenu", items: ["Texte", "Image", "Logo", "Forme"] },
  { group: "Style", items: ["Couleurs", "Filttres", "Arrière-plan"] },
  { group: "Retouche", items: ["Détourage", "Suppression objet", "Remplacement objet", "Recadrage"] },
  { group: "Calques", items: ["Calques", "Redimensionner"] },
];

// ---- Video editor mock ----
export const videoTimeline = {
  video: [
    { id: "v1", label: "Intro", start: 0, duration: 3 },
    { id: "v2", label: "Produit", start: 3, duration: 5 },
    { id: "v3", label: "Démo", start: 8, duration: 6 },
    { id: "v4", label: "CTA", start: 14, duration: 3 },
  ],
  audio: [{ id: "a1", label: "Musique : Lofi Premium", start: 0, duration: 17 }],
  text: [
    { id: "t1", label: "Titre : Nouveau produit", start: 0, duration: 3 },
    { id: "t2", label: "Sous-titre démo", start: 8, duration: 6 },
  ],
  captions: [{ id: "cap1", label: "Sous-titres auto", start: 0, duration: 17 }],
  transitions: [
    { id: "tr1", at: 3, kind: "Fondu" },
    { id: "tr2", at: 8, kind: "Coupe nette" },
    { id: "tr3", at: 14, kind: "Zoom" },
  ],
};
