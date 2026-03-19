export type WorkclawTeamOverlay = {
  id: string;
  name: string;
  workspaceDir: string;
  packs?: string[];
  metadata?: Record<string, string>;
  toolPolicy?: {
    allow?: string[];
    deny?: string[];
  };
};
