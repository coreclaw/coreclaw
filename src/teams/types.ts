export type WorkclawTeamOverlayToolPolicy = {
  allow?: string[];
  deny?: string[];
};

export type WorkclawTeamOverlay = {
  id: string;
  name: string;
  workspace?: string;
  workspaceDir?: string;
  profiles?: string[];
  packs?: string[];
  metadata?: Record<string, string>;
  toolPolicy?: WorkclawTeamOverlayToolPolicy;
};

export type WorkclawTeamsConfig = {
  list?: WorkclawTeamOverlay[];
};

export type ResolvedWorkclawTeamOverlay = {
  id: string;
  name: string;
  workspaceDir: string;
  profiles: string[];
  packs: string[];
  metadata: Record<string, string>;
  toolPolicy: WorkclawTeamOverlayToolPolicy;
};
