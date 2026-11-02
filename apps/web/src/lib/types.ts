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
  /** The language the audio is in (the original until a new language's audio is ready). */
  audioLanguage?: string;
  /** In a language the series was switched to: whether this episode's audio in it is ready yet. */
  languageStatus?: 'ready' | 'voicing' | 'failed';
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
  /** Owner only: episodes a reviewer removed, which can be replaced. */
  removedEpisodes?: Array<{ id: string; number: number }>;
  /** Owner only: the job adding or replacing episodes, while it runs. */
  activeGenerationId?: string | null;
  /** Owner only: the most episodes a series may have. */
  maxEpisodes?: number;
  /** The language it is shown in, the one it was made in, and every language it has. */
  language?: string;
  originalLanguage?: string;
  languages?: string[];
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
