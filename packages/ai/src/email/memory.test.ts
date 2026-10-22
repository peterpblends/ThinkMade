import { describe, expect, it } from 'vitest';
import { memoryEmailSender } from './memory';

describe('memoryEmailSender', () => {
  it('records sent messages and reports success with an id', async () => {
    const sender = memoryEmailSender();
    const result = await sender.send({ to: 'a@example.com', subject: 'Hi', text: 'Hello' });
    expect(result.ok).toBe(true);
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]?.to).toBe('a@example.com');
  });
});
