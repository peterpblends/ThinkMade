import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { CoachView, PRACTICE } from './coach';

const idle = { supported: true, state: 'idle' as const, start: vi.fn(), stop: vi.fn(), cancel: vi.fn(), error: null, transcript: null, onDevice: false };

describe('CoachView', () => {
  it('shows the conversation and sends a question', async () => {
    const onSend = vi.fn();
    render(<CoachView episodeTitle="Opportunity cost" messages={[{ id: '1', role: 'user', content: 'Q1' }, { id: '2', role: 'coach', content: 'A1' }]} onSend={onSend} onCreatePodcast={vi.fn()} sending={false} voice={idle} />);
    expect(screen.getByRole('log')).toHaveTextContent('Q1');
    expect(screen.getByRole('log')).toHaveTextContent('A1');
    await userEvent.type(screen.getByRole('textbox', { name: /your question/i }), 'How do I apply it?');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith('How do I apply it?');
  });

  it('offers to make a podcast only once there is a conversation', () => {
    const { rerender } = render(<CoachView episodeTitle="T" messages={[]} onSend={vi.fn()} onCreatePodcast={vi.fn()} sending={false} voice={idle} />);
    expect(screen.queryByRole('button', { name: 'Create a Podcast About This' })).toBeNull();
    rerender(<CoachView episodeTitle="T" messages={[{ id: '1', role: 'user', content: 'Q' }, { id: '2', role: 'coach', content: 'A' }]} onSend={vi.fn()} onCreatePodcast={vi.fn()} sending={false} voice={idle} />);
    expect(screen.getByRole('button', { name: 'Create a Podcast About This' })).toBeEnabled();
  });

  it('fills the question box from a spoken question', () => {
    render(<CoachView episodeTitle="T" messages={[]} onSend={vi.fn()} onCreatePodcast={vi.fn()} sending={false} voice={{ ...idle, transcript: 'Spoken question' }} />);
    expect(screen.getByRole('textbox', { name: /your question/i })).toHaveValue('Spoken question');
  });

  it('starts a practice exercise in one tap, and leads back to the podcast', async () => {
    const onSend = vi.fn();
    render(
      <MemoryRouter>
        <CoachView episodeTitle="T" series={{ id: 's1', title: 'Better decisions' }} messages={[]} onSend={onSend} onCreatePodcast={vi.fn()} sending={false} voice={idle} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Back to the podcast: Better decisions' })).toHaveAttribute('href', '/series/s1');
    const practice = screen.getByRole('group', { name: 'Practise' });
    expect(practice).toHaveTextContent('Role-play');
    await userEvent.click(screen.getByRole('button', { name: 'Role-play' }));
    expect(onSend).toHaveBeenCalledWith(PRACTICE[0].prompt);
  });

  it('shows a reply as it streams in and holds the next question until it is done', () => {
    render(<CoachView episodeTitle="T" messages={[{ id: '1', role: 'user', content: 'Quiz me' }, { id: 'streaming', role: 'coach', content: 'First question:' }]} onSend={vi.fn()} onCreatePodcast={vi.fn()} sending={false} busy voice={idle} />);
    expect(screen.getByRole('log')).toHaveTextContent('First question:');
    expect(screen.getByRole('button', { name: 'Quiz me' })).toBeDisabled();
  });
});
