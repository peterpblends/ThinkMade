export interface EpisodeSummary {
  id: string;
  seriesId: string;
  number: number;
  title: string;
  description: string;
  status: string;
  learningObjective: string | null;
  speakerFormat: string;
  hosts: Array<{ name: string }>;
  plannedMinutes: number | null;
  durationSeconds: number | null;
  outcomes: { thinking: string; seeing: string; doing: string } | null;
  keyTakeaways: string[];
  examples: Array<{ title: string; kind: 'real' | 'hypothetical'; summary: string }>;
  primaryModel: { slug: string; name: string; summary: string } | null;
  supportingModels: Array<{ slug: string; name: string }>;
  sources: Array<{ title: string; url: string | null; kind: string; verifiedVia: string | null }>;
  audioUrl: string | null;
  transcript?: string | null;
}

export interface SeriesDetail {
  id: string;
  title: string;
  description: string;
  status: string;
  visibility: 'private' | 'public';
  publicSlug: string | null;
  isOwner: boolean;
  createdAt: string;
  episodes: EpisodeSummary[];
}

export interface SeriesListItem {
  id: string;
  title: string;
  description: string;
  status: string;
  visibility: 'private' | 'public';
  createdAt: string;
  episodeCount: number;
  readyCount: number;
  totalSeconds: number;
}
