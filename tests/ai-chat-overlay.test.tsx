import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AIChatOverlay } from '../src/features/overlay/AIChatOverlay';

describe('AIChatOverlay', () => {
  it('renders conversation UI and sends prompts', async () => {
    const onSend = vi.fn().mockResolvedValue('Use the enterprise pricing matrix.');

    render(<AIChatOverlay onSend={onSend} />);

    fireEvent.change(screen.getByLabelText('Chat message'), {
      target: { value: '#kb product pricing strategy' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith(
        '#kb product pricing strategy',
        expect.objectContaining({ onChunk: expect.any(Function) }),
      );
    });
    expect(await screen.findByText('Use the enterprise pricing matrix.')).toBeInTheDocument();
  });
});
