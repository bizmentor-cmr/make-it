"use client";

import { useAppStore } from "@/store/app-store";
import { AppShell } from "@/components/layout/AppShell";
import { HomeSection } from "@/components/sections/HomeSection";
import { StrategySection } from "@/components/sections/StrategySection";
import { CreateSection } from "@/components/sections/CreateSection";
import { PlanningSection } from "@/components/sections/PlanningSection";
import { CampaignsSection } from "@/components/sections/CampaignsSection";
import { MessagesSection } from "@/components/sections/MessagesSection";
import { PerformanceSection } from "@/components/sections/PerformanceSection";
import { BrandSection } from "@/components/sections/BrandSection";
import { LibrarySection } from "@/components/sections/LibrarySection";
import { SettingsSection } from "@/components/sections/SettingsSection";
import { AgencyPortfolioSection } from "@/components/sections/AgencyPortfolioSection";
import { AgencyCreditsSection } from "@/components/sections/AgencyCreditsSection";
import { AgencyTeamSection } from "@/components/sections/AgencyTeamSection";
import { AgencyLibrarySection } from "@/components/sections/AgencyLibrarySection";
import { InternalMessagesSection } from "@/components/sections/InternalMessagesSection";
import { StudioSection } from "@/components/sections/StudioSection";

export default function Home() {
  const { activeSection } = useAppStore();

  return (
    <AppShell>
      {activeSection === "home" && <HomeSection />}
      {activeSection === "strategy" && <StrategySection />}
      {activeSection === "create" && <CreateSection />}
      {activeSection === "planning" && <PlanningSection />}
      {activeSection === "campaigns" && <CampaignsSection />}
      {activeSection === "messages" && <MessagesSection />}
      {activeSection === "internal-messages" && <InternalMessagesSection />}
      {activeSection === "performance" && <PerformanceSection />}
      {activeSection === "brand" && <BrandSection />}
      {activeSection === "library" && <LibrarySection />}
      {activeSection === "settings" && <SettingsSection />}
      {activeSection === "agency-portfolio" && <AgencyPortfolioSection />}
      {activeSection === "agency-library" && <AgencyLibrarySection />}
      {activeSection === "agency-credits" && <AgencyCreditsSection />}
      {activeSection === "agency-team" && <AgencyTeamSection />}
      {activeSection === "studio" && <StudioSection />}
    </AppShell>
  );
}

