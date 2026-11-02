import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { BRAND } from '@thinkmade/shared';
import { api, ApiError, type PublicSettings } from '../lib/api';
import { useSession } from '../lib/auth-client';
import { InstallCard } from '../components/install';
import { Button, Notice } from '../components/ui';
import { Sheet } from '../components/sheet';
import { Link } from 'react-router';
import type { DiscoverResult } from './discover';
import { CreateForm, type Attachment, type CreateRequest } from './create-form';

/** Uploads one attachment: straight to storage when the server offers a presigned URL, else through the API. */
async function uploadAttachment(a: Attachment): Promise<string> {
  try {
    const presigned = await api<{ id: string; url: string; headers: Record<string, string> }>('/api/uploads/presign', {
      method: 'POST',
      body: JSON.stringify({ kind: a.kind, contentType: a.file.type, size: a.file.size }),
    });
    const put = await fetch(presigned.url, { method: 'PUT', headers: presigned.headers, body: a.file });
    if (!put.ok) throw new Error('Upload failed');
    await api(`/api/uploads/${presigned.id}/complete`, { method: 'POST', body: '{}' });
    return presigned.id;
  } catch (err) {
    if (!(err instanceof ApiError && err.code === 'use_direct_upload')) throw err;
  }
  const form = new FormData();
  form.set('file', a.file);
  const res = await fetch('/api/uploads', { method: 'POST', body: form, credentials: 'same-origin' });
  const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string; error?: string };
  if (!res.ok || !body.id) throw new ApiError(res.status, body.error ?? 'upload_failed', body);
  return body.id;
}

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
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<{ req: CreateRequest; items: Array<Pick<DiscoverResult, 'id' | 'title' | 'description' | 'publicSlug' | 'models'>> } | null>(null);
  const settings = useQuery({ queryKey: ['settings', 'public'], queryFn: () => api<PublicSettings>('/api/settings/public') });

  /** Before creating, offer strong public matches (reuse), without adding a step when there are none. */
  const onCreate = async (req: CreateRequest, skipSuggest = false) => {
    if (!skipSuggest && user?.emailVerified && req.topic.length >= 3 && req.attachments.length === 0) {
      const found = await api<{ suggestions: Array<Pick<DiscoverResult, 'id' | 'title' | 'description' | 'publicSlug' | 'models'>> }>('/api/discover/suggest', {
        method: 'POST',
        body: JSON.stringify({ topic: req.topic }),
      }).catch(() => ({ suggestions: [] }));
      if (found.suggestions.length) {
        setSuggestions({ req, items: found.suggestions });
        return;
      }
    }
    return createNow(req);
  };

  const createNow = async (req: CreateRequest) => {
    saveDraft(req.topic);
    if (!user) {
      navigate('/sign-up?next=/');
      return;
    }
    if (!user.emailVerified) {
      navigate(`/verify-email?email=${encodeURIComponent(user.email)}`);
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const mediaUploadIds: string[] = [];
      for (let i = 0; i < req.attachments.length; i++) {
        setStatus(`Uploading ${req.attachments[i]!.kind === 'video' ? 'video' : 'photo'} ${i + 1} of ${req.attachments.length}…`);
        mediaUploadIds.push(await uploadAttachment(req.attachments[i]!));
      }
      setStatus(null);
      const { id } = await api<{ id: string }>('/api/generations', {
        method: 'POST',
        body: JSON.stringify({ topic: req.topic, customization: req.customization, mediaUploadIds, ...(req.voices ? { voices: req.voices } : req.voiceGender ? { voiceGender: req.voiceGender } : {}) }),
      });
      saveDraft('');
      navigate(`/generations/${id}`);
    } catch (err) {
      const body = err instanceof ApiError ? (err.body as { message?: string } | null) : null;
      setNotice(
        body?.message ??
          (err instanceof ApiError
            ? err.status === 415
              ? 'That file is not a photo or video we can read. Please choose a JPEG, PNG, HEIC, MP4 or MOV file.'
              : 'We could not start your podcasts. Please try again.'
            : 'You seem to be offline. Please try again when connected.'),
      );
    } finally {
      setBusy(false);
      setStatus(null);
    }
  };

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <section aria-label={`About ${BRAND.name}`} className="flex flex-col gap-1 sm:gap-1.5">
        <p className="font-serif text-[1.08rem] italic leading-snug text-accent-ink sm:text-[1.2rem]">{BRAND.tagline}</p>
        <p className="text-[0.875rem] leading-snug text-muted sm:text-[0.95rem] sm:leading-relaxed">{BRAND.purpose}</p>
      </section>

      {settings.data ? (
        <CreateForm defaults={settings.data.podcast} media={settings.data.media} voices={settings.data.voices ?? []} onCreate={(r) => void onCreate(r)} initialTopic={readDraft()} busy={busy} status={status} />
      ) : settings.isError ? (
        <Notice tone="error" role="alert">
          ThinkMade can't reach its server right now. Check your connection and try again.
        </Notice>
      ) : (
        <p role="status" className="text-muted">
          Loading…
        </p>
      )}

      {notice && (
        <Notice tone="error" role="alert">
          {notice}
        </Notice>
      )}

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

      <Sheet open={!!suggestions} onClose={() => setSuggestions(null)} title="Others have explored this">
        <p className="mb-3 text-[0.95rem] text-muted">You can listen now, or create your own personalized version.</p>
        <ul className="mb-4 flex flex-col gap-2">
          {suggestions?.items.map((s) => (
            <li key={s.id}>
              <Link to={`/p/${s.publicSlug}`} className="flex flex-col rounded-xl border border-line p-3 hover:bg-surface-2">
                <span className="font-semibold">{s.title}</span>
                {s.models.length > 0 && <span className="text-sm text-muted">{s.models.join(' · ')}</span>}
              </Link>
            </li>
          ))}
        </ul>
        <Button
          block
          onClick={() => {
            const req = suggestions!.req;
            setSuggestions(null);
            void createNow(req);
          }}
        >
          Create my own version
        </Button>
      </Sheet>

      <InstallCard />
    </div>
  );
}
