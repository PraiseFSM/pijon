import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import App from '../ui/App';

describe('App (smoke test)', () => {
  it('renders the editor shell with the Furniture/Students lever in Furniture mode', () => {
    render(<App />);
    // The editor switcher is now a ToggleLever, not a tablist
    const lever = screen.getByTestId('editor-mode-lever');
    expect(lever).toBeInTheDocument();
    // On initial load (Furniture mode), lever is in the OFF / left position
    expect(lever.getAttribute('aria-pressed')).toBe('false');
  });
});
