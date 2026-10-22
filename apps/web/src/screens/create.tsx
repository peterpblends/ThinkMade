import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { BRAND } from '@thinkmade/shared';
import { api, type PublicSettings } from '../lib/api';
import { useSession } from '../lib/auth-client';
import { InstallCard } from '../components/install';
import { Notice } from '../components/ui';
import { CreateForm, type CreateRequest } from './create-form';

const DRAFT_KEY = 'tm-draft-topic';

function readDraft(): string {
  try {
    return sessionStorage.getItem(DRAFT_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveDraft(topic: string) {
  try {
    sessionStorage.setItem(DRAFT_KEY, topic);
  } catch {
    /* ignore */
  }
}

export function CreateScreen() {
  const { user, isPending } = useSession();
  const navigate = useNavigate();
  const [notice, setNotice] = useState<string | null>(null);
  const settings = useQuery({ queryKey: ['settings', 'public'], queryFn: () => api<PublicSettings>('/api/settings/public') });

  const onCreate = (req: CreateRequest) => {
    saveDraft(req.topic);
    if (!user) {
      navigate('/sign-up?next=/');
      return;
    }
    // Phase 1 is honest: generation is not built yet. Nothing is submitted and nothing pretends to be.
    setNotice("Podcast generation arrives in the next release. We've kept your question here so nothing is lost.");
  };

  return (
    <div className="flex flex-col gap-6">
      {!isPending && !user && (
        <section aria-labelledby="intro" className="flex flex-col gap-2">
          <p id="intro" className="font-serif text-[1.15rem] italic text-accent-ink">
            {BRAND.tagline}
          </p>
          <p className="text-muted">{BRAND.shortDescription}</p>
        </section>
      )}

      {settings.data ? (
        <CreateForm defaults={settings.data.podcast} onCreate={onCreate} initialTopic={readDraft()} />
      ) : settings.isError ? (
        <Notice tone="error" role="alert">
          ThinkMade can't reach its server right now. Check your connection and try again.
        </Notice>
      ) : (
        <p role="status" className="text-muted">
          Loading…
        </p>
      )}

      {notice && <Notice>{notice}</Notice>}

      {!isPending && !user && (
        <section aria-labelledby="how" className="mt-2 flex flex-col gap-4 rounded-[var(--radius-card)] bg-surface-2 p-5">
          <h2 id="how" className="text-xl">
            How ThinkMade works
          </h2>
          <p className="text-[0.98rem] text-ink">
            Tell us what you're trying to learn or solve. ThinkMade finds the <strong>mental models</strong> that help, which are
            proven ways of thinking such as <em>opportunity cost</em> or <em>second-order thinking</em>. It then draws on credible
            books and turns them into short podcasts made for you.
          </p>
          <ul className="flex flex-col gap-3 text-[0.98rem]">
            <li>
              <strong className="text-accent-ink">Thinking.</strong> Understand the idea and why it works.
            </li>
            <li>
              <strong className="text-accent-ink">Seeing.</strong> Learn to spot when it applies.
            </li>
            <li>
              <strong className="text-accent-ink">Doing.</strong> Walk through putting it into practice.
            </li>
          </ul>
          <p className="text-sm text-muted">{BRAND.promise}</p>
        </section>
      )}

      <InstallCard />
    </div>
  );
}
