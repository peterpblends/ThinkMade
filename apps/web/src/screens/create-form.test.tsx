import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CreateForm } from './create-form';

const media = { maxImages: 2, maxImageBytes: 10_000_000, maxVideoSeconds: 120, maxVideoBytes: 100_000_000 };
const defaults = {
  defaultLengthMinutes: 15,
  defaultEpisodes: 3,
  maxEpisodeMinutes: 60,
  maxEpisodesPerSeries: 10,
  speakerFormat: 'mixed' as const,
  learningMode: 'explore' as const,
  visibility: 'private' as const,
  lengthChoices: [5, 10, 15, 20, 30, 45, 60],
  episodeChoices: [1, 3, 5, 10],
};

describe('CreateForm', () => {
  it('asks the core question and offers one primary action plus Customize', () => {
    render(<CreateForm defaults={defaults} onCreate={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'What would you like to think through today?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create My Podcasts' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Customize' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('does not submit an empty topic', async () => {
    const onCreate = vi.fn();
    render(<CreateForm defaults={defaults} onCreate={onCreate} />);
    await userEvent.click(screen.getByRole('button', { name: 'Create My Podcasts' }));
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/tell us what you'd like to think through/i);
  });

  it('submits the topic with admin defaults when Customize is untouched', async () => {
    const onCreate = vi.fn();
    render(<CreateForm defaults={defaults} onCreate={onCreate} />);
    await userEvent.type(screen.getByRole('textbox', { name: /your topic/i }), 'How can I become a better leader?');
    await userEvent.click(screen.getByRole('button', { name: 'Create My Podcasts' }));
    expect(onCreate).toHaveBeenCalledWith({
      topic: 'How can I become a better leader?',
      customization: null,
      attachments: [],
    });
  });

  it('Customize shows choices prefilled from defaults and submits the changes', async () => {
    const onCreate = vi.fn();
    render(<CreateForm defaults={defaults} onCreate={onCreate} />);
    await userEvent.click(screen.getByRole('button', { name: 'Customize' }));
    expect(screen.getByRole('radio', { name: '15 min' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '3 episodes' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Mixed' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Explore' })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: '30 min' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Two Hosts' }));
    await userEvent.type(screen.getByRole('textbox', { name: /your topic/i }), 'Why do people resist change?');
    await userEvent.click(screen.getByRole('button', { name: 'Create My Podcasts' }));
    expect(onCreate).toHaveBeenCalledWith({
      topic: 'Why do people resist change?',
      customization: { lengthMinutes: 30, episodes: 3, speakerFormat: 'two_hosts', learningMode: 'explore' },
      attachments: [],
    });
  });

  it('accepts a photo, shows it, and lets the photo stand in for typed text', async () => {
    const onCreate = vi.fn();
    render(<CreateForm defaults={defaults} media={media} onCreate={onCreate} />);
    const photo = new File([new Uint8Array(100)], 'line.jpg', { type: 'image/jpeg' });
    await userEvent.upload(screen.getByLabelText('Add a photo'), photo);
    expect(screen.getByRole('img', { name: /line\.jpg/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Create My Podcasts' }));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ topic: '', attachments: [expect.objectContaining({ kind: 'image', file: photo })] }));
  });

  it('removes an attachment', async () => {
    render(<CreateForm defaults={defaults} media={media} onCreate={vi.fn()} />);
    await userEvent.upload(screen.getByLabelText('Add a photo'), new File([new Uint8Array(10)], 'a.png', { type: 'image/png' }));
    await userEvent.click(screen.getByRole('button', { name: /remove a\.png/i }));
    expect(screen.queryByRole('img', { name: /a\.png/ })).toBeNull();
  });

  it('enforces the photo limit and size limit before uploading', async () => {
    render(<CreateForm defaults={defaults} media={{ ...media, maxImageBytes: 50 }} onCreate={vi.fn()} />);
    await userEvent.upload(screen.getByLabelText('Add a photo'), new File([new Uint8Array(100)], 'big.png', { type: 'image/png' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/larger than/i);
    render(<CreateForm defaults={defaults} media={media} onCreate={vi.fn()} />);
    const inputs = screen.getAllByLabelText('Add a photo');
    await userEvent.upload(inputs[1]!, [1, 2, 3].map((i) => new File([new Uint8Array(10)], `p${i}.png`, { type: 'image/png' })));
    expect(screen.getAllByRole('alert').at(-1)).toHaveTextContent(/up to 2 photos/i);
  });

  it('explains when this browser cannot record voice', () => {
    render(<CreateForm defaults={defaults} onCreate={vi.fn()} />);
    const mic = screen.getByRole('button', { name: /speak/i });
    expect(mic).toBeDisabled();
    expect(mic).toHaveAccessibleDescription(/not supported in this browser/i);
  });

  it('puts a voice transcript into the editable topic box', async () => {
    render(<CreateForm defaults={defaults} onCreate={vi.fn()} voice={{ supported: true, state: 'idle', start: vi.fn(), stop: vi.fn(), cancel: vi.fn(), error: null, transcript: 'Help me understand bottlenecks' }} />);
    expect(screen.getByRole('textbox', { name: /your topic/i })).toHaveValue('Help me understand bottlenecks');
  });

  it('shows that recording is active and offers stop and cancel', () => {
    render(<CreateForm defaults={defaults} onCreate={vi.fn()} voice={{ supported: true, state: 'recording', start: vi.fn(), stop: vi.fn(), cancel: vi.fn(), error: null, transcript: null }} />);
    expect(screen.getByRole('status')).toHaveTextContent(/recording/i);
    expect(screen.getByRole('button', { name: /stop recording/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /cancel recording/i })).toBeEnabled();
  });
});
